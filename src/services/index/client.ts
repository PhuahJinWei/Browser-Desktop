import { useEffect, useState } from 'react';
import IndexWorker from './index.worker?worker';
import { createRpcClient, type RpcClient } from '../../kernel/rpc';
import { PRIORITY, schedule } from '../../kernel/jobs';
import { notify, notifyError } from '../../kernel/notifications';
import { createStore, useStoreSelector } from '../../kernel/store';
import { settingsStore } from '../../kernel/settings';
import { vfs } from '../../kernel/vfs/client';
import { categoryOf, isIndexable, type VfsNode } from '../../kernel/vfs/types';
import { ensureModel, getModel, isDownloaded } from '../../kernel/models';
import { putThumbnail, deleteThumbnail, clearThumbnails } from './thumbnails';
import type { ImageHit } from './images';
import type { IndexMethods, IndexStats, SearchHit } from './index.worker';

/**
 * Main-thread side of search.
 *
 * Its real job is orchestration: watch the file system, queue indexing as background work so it
 * cannot delay anything the user is doing, run queries at interactive priority, and persist the
 * index so the next visit starts warm.
 */

const client: RpcClient<IndexMethods> = createRpcClient<IndexMethods>(new IndexWorker());

interface IndexerState {
  stats: IndexStats | null;
  /** Files known to need indexing but not yet done. */
  pending: number;
  modelLoading: boolean;
  modelProgress: string | null;
  /** Photos waiting on the vision model. */
  pendingImages: number;
  visionEnabled: boolean;
  visionLoading: boolean;
}

const store = createStore<IndexerState>({
  stats: null,
  pending: 0,
  modelLoading: false,
  modelProgress: null,
  pendingImages: 0,
  visionEnabled: false,
  visionLoading: false,
});

/** The default image model. See ADR 10 for why the smaller MobileCLIP option was rejected. */
export const DEFAULT_VISION_MODEL = 'image-text-clip-vit-b32';

let started = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const queued = new Set<string>();

async function refreshStats(): Promise<void> {
  try {
    const stats = await client.call('stats', []);
    store.set((state) => ({ ...state, stats }));
  } catch {
    /* The worker reports its own failures; stale stats are harmless. */
  }
}

/** Writing the index after every file would thrash IndexedDB; a quiet moment is enough. */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void client.call('save', []).catch(() => undefined);
    saveTimer = null;
  }, 1500);
}

/** Queues one file for indexing at background priority. */
function queueFile(node: VfsNode): void {
  if (!isIndexable(node) || node.trashed || queued.has(node.id)) return;
  queued.add(node.id);
  store.set((state) => ({ ...state, pending: state.pending + 1 }));

  schedule(
    { label: `Index ${node.name}`, kind: 'index', priority: PRIORITY.background },
    async (context) => {
      context.throwIfCancelled();
      await vfs.setIndexState(node.id, 'indexing');

      const { data } = await vfs.read(node.id);
      context.throwIfCancelled();
      context.setProgress(null, node.name);

      const result = await client.call(
        'indexDocument',
        [{ id: node.id, name: node.name, mime: node.mime, data }],
        { transfer: [data] },
      );

      await vfs.setIndexState(node.id, result.skipped ? 'skipped' : 'indexed', 'minilm-l6-v2');
      return result;
    },
  )
    .promise.then(() => {
      scheduleSave();
      void refreshStats();
    })
    .catch(async (error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        await vfs.setIndexState(node.id, 'pending');
        return;
      }
      await vfs.setIndexState(node.id, 'failed');
      // One notification per failure would be noise during a large import; the Task Manager
      // lists them all, and only the first is surfaced.
      if (store.get().pending <= 1) notifyError(`Could not index ${node.name}`, error);
    })
    .finally(() => {
      queued.delete(node.id);
      store.set((state) => ({ ...state, pending: Math.max(0, state.pending - 1) }));
    });
}

/**
 * Finds everything that still needs indexing and queues it.
 *
 * A file's `indexState` is the file system's *belief* about the index, and the two can diverge:
 * the snapshot may fail to restore, be cleared, or have been written by a different model. So the
 * index is asked what it actually holds, and anything it does not have is re-queued regardless of
 * what the file system claims. Without this, a lost snapshot means search quietly returns nothing
 * forever — the worst kind of failure, because it looks like an empty library.
 */
export async function indexPending(): Promise<number> {
  const nodes = await vfs.allNodes();
  const indexed = new Set(await client.call('indexedDocumentIds', []).catch(() => []));

  const candidates = nodes.filter((node) => {
    if (node.kind !== 'file' || node.trashed || !isIndexable(node)) return false;
    if (indexed.has(node.id)) return false;
    // "skipped" is a real conclusion (no extractable text), not a missing entry — respect it.
    return node.indexState !== 'skipped';
  });

  for (const node of candidates) queueFile(node);
  return candidates.length;
}

/** Boots the search service: configure, restore, then catch up on anything unindexed. */
export async function startIndexer(backend: 'webgpu' | 'wasm'): Promise<void> {
  if (started) return;
  started = true;

  await client.call('configure', [{ backend }]);
  const restored = await client.call('restoreIndex', []).catch(() => false);
  await refreshStats();

  if (!settingsStore.get().autoIndex) return;
  const queuedCount = await indexPending();

  if (queuedCount > 0 && !restored) {
    notify({
      title: `Indexing ${queuedCount} file${queuedCount === 1 ? '' : 's'}`,
      body: 'Search improves as this finishes. It runs in the background.',
      level: 'info',
    });
  }

  // A model already on disk needs no second conversation: consent covered the download, not
  // every use of it. Loading it here is what makes photo search survive a reload.
  if (await isDownloaded(DEFAULT_VISION_MODEL).catch(() => false)) {
    void enableVision(DEFAULT_VISION_MODEL);
  }

  // New and changed files get queued as they appear.
  vfs.onChange((change) => {
    if (!settingsStore.get().autoIndex) return;
    if (change.reason === 'index') return;

    void (async () => {
      if (change.reason === 'delete' || change.reason === 'trash') {
        for (const id of change.nodes) {
          await client.call('removeDocument', [id]).catch(() => false);
          await forgetImage(id).catch(() => undefined);
        }
        scheduleSave();
        void refreshStats();
        return;
      }
      const nodes = await vfs.statMany(change.nodes);
      for (const node of nodes) {
        if (node.kind !== 'file') continue;
        // Text and images take different routes: different model, different index.
        if (categoryOf(node) === 'image') queueImage(node);
        else if (node.indexState !== 'indexed') queueFile(node);
      }
    })();
  });
}

/** Loads the model up front, so the first search is not also the first download. */
export async function warmUpModel(): Promise<void> {
  store.set((state) => ({ ...state, modelLoading: true }));
  try {
    await schedule(
      { label: 'Load embedding model', kind: 'model', priority: PRIORITY.userBatch },
      async () => {
        await client.call('warmUp', [], {
          onProgress: (payload) => {
            const progress = payload as { status?: string; file?: string; progress?: number };
            if (progress.status === 'progress' && progress.file) {
              store.set((state) => ({
                ...state,
                modelProgress: `${progress.file} ${Math.round(progress.progress ?? 0)}%`,
              }));
            }
          },
        });
      },
    ).promise;
    await refreshStats();
  } catch (error) {
    notifyError('The embedding model could not be loaded', error);
  } finally {
    store.set((state) => ({ ...state, modelLoading: false, modelProgress: null }));
  }
}

export async function search(query: string, limit = 20): Promise<SearchHit[]> {
  // Interactive priority: a query the user just typed jumps ahead of the indexing queue.
  return schedule(
    { label: `Search “${query}”`, kind: 'search', priority: PRIORITY.interactive },
    () => client.call('search', [{ query, limit }]),
  ).promise;
}

export async function reindexEverything(): Promise<void> {
  await client.call('clear', []);
  const nodes = await vfs.allNodes();
  for (const node of nodes) {
    if (node.kind === 'file' && isIndexable(node)) await vfs.setIndexState(node.id, 'pending');
  }
  const count = await indexPending();
  notify({
    title: count > 0 ? `Rebuilding the index for ${count} files` : 'Nothing to index',
    level: 'info',
  });
  await refreshStats();
}

export async function clearIndex(): Promise<void> {
  await client.call('clear', []);
  await refreshStats();
}

export function useIndexerState(): IndexerState {
  return useStoreSelector(store, (state) => state);
}

export function useIndexStats(): IndexStats | null {
  const [stats, setStats] = useState<IndexStats | null>(store.get().stats);
  useEffect(() => {
    setStats(store.get().stats);
    return store.subscribe(() => setStats(store.get().stats));
  }, []);
  return stats;
}

export type { SearchHit, IndexStats };

/* -------------------------------------------------------------------------------------------- */
/* Photos                                                                                         */
/* -------------------------------------------------------------------------------------------- */

const queuedImages = new Set<string>();

/**
 * Turns on photo search.
 *
 * Split from the rest of the indexer because it costs a download the user has to agree to. Until
 * they do, Photos still lists and opens pictures — it just cannot search them, and says so.
 */
export async function enableVision(
  modelId = DEFAULT_VISION_MODEL,
  backendHint?: 'webgpu' | 'wasm',
): Promise<boolean> {
  const model = getModel(modelId);
  if (!model) return false;
  if (store.get().visionEnabled) return true;

  const agreed = await ensureModel(
    modelId,
    'Photo search needs an image model. It runs on your device; your pictures are not uploaded.',
  );
  if (!agreed) return false;

  store.set((state) => ({ ...state, visionLoading: true }));
  try {
    // Vision is the heavier model, and M0 measured the GPU winning on larger networks — so unlike
    // text embeddings this one prefers WebGPU when it is available.
    const backend = backendHint ?? 'webgpu';
    await schedule(
      { label: 'Load image model', kind: 'model', priority: PRIORITY.userBatch },
      async () => {
        await client.call('loadVisionModel', [{ model: model.source.repo, backend }], {
          onProgress: (payload) => {
            const progress = payload as { status?: string; file?: string; progress?: number };
            if (progress.status === 'progress' && progress.file) {
              store.set((state) => ({
                ...state,
                modelProgress: `${progress.file} ${Math.round(progress.progress ?? 0)}%`,
              }));
            }
          },
        });
      },
    ).promise;

    store.set((state) => ({ ...state, visionEnabled: true, modelProgress: null }));
    await refreshStats();
    await indexPendingImages();
    return true;
  } catch (error) {
    notifyError('The image model could not be loaded', error);
    return false;
  } finally {
    store.set((state) => ({ ...state, visionLoading: false }));
  }
}

export async function disableVision(): Promise<void> {
  await client.call('unloadVisionModel', []).catch(() => undefined);
  store.set((state) => ({ ...state, visionEnabled: false }));
  await refreshStats();
}

function queueImage(node: VfsNode): void {
  if (node.trashed || queuedImages.has(node.id)) return;
  if (categoryOf(node) !== 'image') return;

  queuedImages.add(node.id);
  store.set((state) => ({ ...state, pendingImages: state.pendingImages + 1 }));

  schedule(
    { label: `Index ${node.name}`, kind: 'index-image', priority: PRIORITY.background },
    async (context) => {
      context.throwIfCancelled();
      const { data } = await vfs.read(node.id);
      context.throwIfCancelled();
      context.setProgress(null, node.name);

      const result = await client.call(
        'indexImage',
        [{ id: node.id, name: node.name, mime: node.mime, data }],
        { transfer: [data] },
      );
      if (result.thumbnail) {
        await putThumbnail(node.id, result.thumbnail, result.width, result.height);
      }
      await vfs.setIndexState(node.id, result.indexed ? 'indexed' : 'skipped', 'clip');
      return result;
    },
  )
    .promise.then(() => {
      scheduleSave();
      void refreshStats();
    })
    .catch(async (error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      await vfs.setIndexState(node.id, 'failed');
      if (store.get().pendingImages <= 1) notifyError(`Could not index ${node.name}`, error);
    })
    .finally(() => {
      queuedImages.delete(node.id);
      store.set((state) => ({ ...state, pendingImages: Math.max(0, state.pendingImages - 1) }));
    });
}

/** Queues every image the model has not seen yet. */
export async function indexPendingImages(): Promise<number> {
  if (!store.get().visionEnabled) return 0;

  const nodes = await vfs.allNodes();
  const known = new Set(await client.call('indexedImageIds', []).catch(() => []));
  const candidates = nodes.filter(
    (node) =>
      node.kind === 'file' && !node.trashed && categoryOf(node) === 'image' && !known.has(node.id),
  );
  for (const node of candidates) queueImage(node);
  return candidates.length;
}

export async function searchPhotos(query: string, limit = 60): Promise<ImageHit[]> {
  if (!store.get().visionEnabled) return [];
  return schedule(
    { label: `Photo search “${query}”`, kind: 'search', priority: PRIORITY.interactive },
    () => client.call('searchImages', [{ query, limit }]),
  ).promise;
}

export async function similarPhotos(id: string, limit = 24): Promise<ImageHit[]> {
  return client.call('similarImages', [{ id, limit }]).catch(() => []);
}

export async function forgetImage(id: string): Promise<void> {
  await client.call('removeImage', [id]).catch(() => false);
  await deleteThumbnail(id);
}

export async function clearImageIndex(): Promise<void> {
  await clearThumbnails();
  await refreshStats();
}

export type { ImageHit };

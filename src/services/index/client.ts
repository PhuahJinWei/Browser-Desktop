import { useEffect, useState } from 'react';
import IndexWorker from './index.worker?worker';
import { createRpcClient, type RpcClient } from '../../kernel/rpc';
import { PRIORITY, schedule } from '../../kernel/jobs';
import { notify, notifyError } from '../../kernel/notifications';
import { createStore, useStoreSelector } from '../../kernel/store';
import { settingsStore } from '../../kernel/settings';
import { vfs } from '../../kernel/vfs/client';
import { categoryOf, isIndexable, type VfsNode } from '../../kernel/vfs/types';
import { putThumbnail, deleteThumbnail, hasThumbnail } from './thumbnails';
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
}

const store = createStore<IndexerState>({
  stats: null,
  pending: 0,
  modelLoading: false,
  modelProgress: null,
});

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

  void makePendingThumbnails();

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
        // A picture has no text to index; it gets a thumbnail instead.
        if (categoryOf(node) === 'image') queueThumbnail(node);
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

/** Embeds text on behalf of an app, at interactive priority so it does not queue behind indexing. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const vectors = await schedule(
    {
      label: `Embed ${texts.length} text${texts.length === 1 ? '' : 's'}`,
      kind: 'embed',
      priority: PRIORITY.interactive,
    },
    () => client.call('embedTexts', [texts]),
  ).promise;
  return vectors.map((vector) => Float32Array.from(vector));
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

const queuedThumbnails = new Set<string>();

/**
 * Makes a thumbnail for a picture, once.
 *
 * All that remains of what used to be image indexing. The embedding model is gone, so there is
 * nothing to search pictures by any more — but a grid that decodes 4000-pixel originals to draw
 * them at 160 is still the thing that makes a file manager stutter, so the thumbnail stays.
 */
function queueThumbnail(node: VfsNode): void {
  if (node.trashed || queuedThumbnails.has(node.id)) return;
  if (categoryOf(node) !== 'image') return;

  queuedThumbnails.add(node.id);
  schedule(
    { label: `Thumbnail ${node.name}`, kind: 'thumbnail', priority: PRIORITY.background },
    async (context) => {
      context.throwIfCancelled();
      const { data } = await vfs.read(node.id);
      context.throwIfCancelled();
      const result = await client.call('thumbnail', [{ mime: node.mime, data }], {
        transfer: [data],
      });
      if (result.blob) await putThumbnail(node.id, result.blob, result.width, result.height);
      return result;
    },
  )
    .promise.catch(() => {
      /* An undecodable picture simply has no thumbnail; the grid falls back to the original. */
    })
    .finally(() => queuedThumbnails.delete(node.id));
}

/** Thumbnails every picture that does not have one yet. */
export async function makePendingThumbnails(): Promise<number> {
  const nodes = await vfs.allNodes();
  const candidates = nodes.filter(
    (node) => node.kind === 'file' && !node.trashed && categoryOf(node) === 'image',
  );
  let queued = 0;
  for (const node of candidates) {
    if (await hasThumbnail(node.id)) continue;
    queueThumbnail(node);
    queued += 1;
  }
  return queued;
}

export async function forgetImage(id: string): Promise<void> {
  await deleteThumbnail(id);
}

export type { SearchHit as DocumentHit };

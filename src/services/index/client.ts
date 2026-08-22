import { useEffect, useState } from 'react';
import IndexWorker from './index.worker?worker';
import { createRpcClient, type RpcClient } from '../../kernel/rpc';
import { PRIORITY, schedule } from '../../kernel/jobs';
import { notify, notifyError } from '../../kernel/notifications';
import { createStore, useStoreSelector } from '../../kernel/store';
import { settingsStore } from '../../kernel/settings';
import { vfs } from '../../kernel/vfs/client';
import { isIndexable, type VfsNode } from '../../kernel/vfs/types';
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

/** Finds everything that still needs indexing and queues it. */
export async function indexPending(): Promise<number> {
  const nodes = await vfs.allNodes();
  const candidates = nodes.filter(
    (node) =>
      node.kind === 'file' &&
      !node.trashed &&
      isIndexable(node) &&
      node.indexState !== 'indexed' &&
      node.indexState !== 'skipped',
  );
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

  // New and changed files get queued as they appear.
  vfs.onChange((change) => {
    if (!settingsStore.get().autoIndex) return;
    if (change.reason === 'index') return;

    void (async () => {
      if (change.reason === 'delete' || change.reason === 'trash') {
        for (const id of change.nodes) await client.call('removeDocument', [id]).catch(() => false);
        scheduleSave();
        void refreshStats();
        return;
      }
      const nodes = await vfs.statMany(change.nodes);
      for (const node of nodes) {
        if (node.kind === 'file' && node.indexState !== 'indexed') queueFile(node);
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

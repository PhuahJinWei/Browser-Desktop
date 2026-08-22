import registry from '../../models.json';
import { createStore, useStoreSelector } from './store';
import { PRIORITY, schedule } from './jobs';
import { notify, notifyError } from './notifications';
import { formatBytes } from './vfs/types';

/**
 * The model manager.
 *
 * Model weights are the one thing this app fetches from anywhere but its own origin, so the rules
 * around them are explicit: nothing downloads without the user agreeing to that specific model at
 * that specific size, every file is verified against a digest pinned in `models.json` before it is
 * used, and the whole operation appears in the Task Manager like any other job.
 *
 * The download writes into `transformers-cache` — the same Cache API store the ML library reads
 * from — keyed by the URL the library would have requested. So the library finds everything
 * already present and never issues a request of its own. That is what makes consent meaningful:
 * without it, the library would quietly fetch on first use and the dialog would be theatre.
 */

export type ModelTier = 'bundled' | 'on-demand';
export type ModelTask = 'text-embedding' | 'image-text-embedding' | 'speech-recognition' | 'ocr';

export interface ModelFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ModelDescriptor {
  id: string;
  task: ModelTask;
  label: string;
  tier: ModelTier;
  minHardwareTier: 'A' | 'B' | 'C';
  milestone: string;
  source: { host: string; repo: string; revision: string };
  dtype: string;
  license: { name: string; url: string };
  totalBytes: number;
  files: ModelFile[];
  meta?: { dimensions?: number; imageSize?: number; languages?: string; chunkSeconds?: number };
  notes: string;
}

export const MODELS: ModelDescriptor[] = (registry as { models: ModelDescriptor[] }).models;

export function getModel(id: string): ModelDescriptor | undefined {
  return MODELS.find((model) => model.id === id);
}

export function modelsForTask(task: ModelTask): ModelDescriptor[] {
  return MODELS.filter((model) => model.task === task);
}

/** The URL the ML library would construct for a file, and therefore the cache key to use. */
export function fileUrl(model: ModelDescriptor, path: string): string {
  return `https://${model.source.host}/${model.source.repo}/resolve/${model.source.revision}/${path}`;
}

const CACHE_NAME = 'transformers-cache';

/* -------------------------------------------------------------------------------------------- */
/* State                                                                                          */
/* -------------------------------------------------------------------------------------------- */

export type ModelStatus = 'unknown' | 'absent' | 'downloading' | 'ready' | 'failed';

export interface ModelState {
  status: ModelStatus;
  /** 0..1 while downloading. */
  progress: number;
  bytesDone: number;
  currentFile?: string;
  error?: string;
}

interface ManagerState {
  models: Record<string, ModelState>;
  /** The consent request currently awaiting an answer, if any. */
  pending: ConsentRequest | null;
}

export interface ConsentRequest {
  model: ModelDescriptor;
  reason: string;
  resolve: (agreed: boolean) => void;
}

const store = createStore<ManagerState>({ models: {}, pending: null });

function patch(id: string, next: Partial<ModelState>): void {
  store.set((state) => ({
    ...state,
    models: {
      ...state.models,
      [id]: { status: 'unknown', progress: 0, bytesDone: 0, ...state.models[id], ...next },
    },
  }));
}

export function useModelStates(): Record<string, ModelState> {
  return useStoreSelector(store, (state) => state.models);
}

export function useModelState(id: string): ModelState {
  return useStoreSelector(
    store,
    (state) => state.models[id] ?? { status: 'unknown', progress: 0, bytesDone: 0 },
  );
}

export function usePendingConsent(): ConsentRequest | null {
  return useStoreSelector(store, (state) => state.pending);
}

/* -------------------------------------------------------------------------------------------- */
/* Cache inspection                                                                               */
/* -------------------------------------------------------------------------------------------- */

async function cacheStore(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** True when every file of a model is already cached. */
export async function isDownloaded(id: string): Promise<boolean> {
  const model = getModel(id);
  const cache = await cacheStore();
  if (!model || !cache) return false;

  for (const file of model.files) {
    const hit = await cache.match(fileUrl(model, file.path));
    if (!hit) return false;
  }
  return true;
}

/** Refreshes what is on disk, so Settings and the Task Manager show the truth. */
export async function refreshModelStates(): Promise<void> {
  for (const model of MODELS) {
    const present = await isDownloaded(model.id);
    // Do not overwrite an in-flight download with a stale "absent".
    if (store.get().models[model.id]?.status === 'downloading') continue;
    patch(model.id, { status: present ? 'ready' : 'absent', progress: present ? 1 : 0 });
  }
}

export async function deleteModel(id: string): Promise<void> {
  const model = getModel(id);
  const cache = await cacheStore();
  if (!model || !cache) return;
  for (const file of model.files) await cache.delete(fileUrl(model, file.path));
  patch(id, { status: 'absent', progress: 0, bytesDone: 0 });
  notify({
    title: `Removed ${model.label}`,
    body: formatBytes(model.totalBytes) + ' freed',
    level: 'info',
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Download                                                                                       */
/* -------------------------------------------------------------------------------------------- */

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Streams one file, reporting bytes as they arrive so a 40 MB download is not a silent wait. */
async function fetchWithProgress(
  url: string,
  signal: AbortSignal,
  onChunk: (bytes: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);

  const body = response.body;
  if (!body) return response.arrayBuffer();

  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    onChunk(value.byteLength);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

/**
 * Downloads a model into the library's cache, verifying every file.
 *
 * A digest mismatch aborts the whole model rather than caching a bad file: the alternative is an
 * inference failure much later, somewhere far away from the cause.
 */
export function downloadModel(id: string): { promise: Promise<boolean>; cancel: () => void } {
  const model = getModel(id);
  if (!model) return { promise: Promise.resolve(false), cancel: () => undefined };

  const job = schedule(
    { label: `Download ${model.label}`, kind: 'model', priority: PRIORITY.userBatch },
    async (context) => {
      const cache = await cacheStore();
      if (!cache) throw new Error('The browser cache is unavailable, so models cannot be stored');

      patch(id, { status: 'downloading', progress: 0, bytesDone: 0 });
      let done = 0;

      for (const file of model.files) {
        context.throwIfCancelled();
        patch(id, { currentFile: file.path });

        const url = fileUrl(model, file.path);
        // Skip anything already present and verified by a previous, interrupted run.
        if (await cache.match(url)) {
          done += file.bytes;
          patch(id, { bytesDone: done, progress: done / model.totalBytes });
          context.setProgress(done / model.totalBytes, file.path);
          continue;
        }

        const bytes = await fetchWithProgress(url, context.signal, (delta) => {
          done += delta;
          const progress = Math.min(1, done / model.totalBytes);
          patch(id, { bytesDone: done, progress });
          context.setProgress(progress, `${file.path} — ${formatBytes(done)}`);
        });

        const digest = await sha256Hex(bytes);
        if (digest !== file.sha256) {
          throw new Error(
            `Integrity check failed for ${file.path}: expected ${file.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…`,
          );
        }

        await cache.put(
          url,
          new Response(bytes, {
            headers: {
              'Content-Type': file.path.endsWith('.json')
                ? 'application/json'
                : 'application/octet-stream',
              'Content-Length': String(bytes.byteLength),
            },
          }),
        );
      }

      patch(id, { status: 'ready', progress: 1, bytesDone: model.totalBytes });
      return true;
    },
  );

  const promise = job.promise
    .then(() => {
      notify({
        title: `${model.label} is ready`,
        body: `${formatBytes(model.totalBytes)} downloaded and verified`,
        level: 'success',
      });
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        patch(id, { status: 'absent', progress: 0, bytesDone: 0 });
        return false;
      }
      patch(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      notifyError(`Could not download ${model.label}`, error);
      return false;
    });

  return { promise, cancel: job.cancel };
}

/* -------------------------------------------------------------------------------------------- */
/* Consent                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/** Asks the user about one model. Resolves false if they decline. */
export function requestConsent(model: ModelDescriptor, reason: string): Promise<boolean> {
  // One dialog at a time: a queue of modal prompts is worse than making the second caller wait.
  const existing = store.get().pending;
  if (existing) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    store.set((state) => ({
      ...state,
      pending: {
        model,
        reason,
        resolve: (agreed) => {
          store.set((current) => ({ ...current, pending: null }));
          resolve(agreed);
        },
      },
    }));
  });
}

/**
 * The entry point every feature uses: make sure a model is available, asking first if it is not.
 * Returns false when the user declines, which callers must treat as a normal outcome rather than
 * an error — declining a download is a legitimate choice, not a failure.
 */
export async function ensureModel(id: string, reason: string): Promise<boolean> {
  const model = getModel(id);
  if (!model) return false;

  if (await isDownloaded(id)) {
    patch(id, { status: 'ready', progress: 1 });
    return true;
  }

  const agreed = await requestConsent(model, reason);
  if (!agreed) {
    patch(id, { status: 'absent' });
    return false;
  }

  return downloadModel(id).promise;
}

/** Total bytes of every model currently cached. */
export async function cachedModelBytes(): Promise<number> {
  let total = 0;
  for (const model of MODELS) {
    if (await isDownloaded(model.id)) total += model.totalBytes;
  }
  return total;
}

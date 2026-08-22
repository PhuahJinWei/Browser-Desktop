import OcrWorker from './ocr.worker?worker';
import { createRpcClient, type RpcClient } from '../../kernel/rpc';
import { PRIORITY, schedule } from '../../kernel/jobs';
import { notify, notifyError } from '../../kernel/notifications';
import { createStore, useStoreSelector } from '../../kernel/store';
import { vfs } from '../../kernel/vfs/client';
import { categoryOf, type VfsNode } from '../../kernel/vfs/types';
import { ensureModel, getModel, isDownloaded } from '../../kernel/models';
import { preferredBackend, probeCapabilities } from '../../kernel/capabilities';
import { indexWorker } from '../index/client';
import type { OcrMethods, OcrResult } from './ocr.worker';

/**
 * Main-thread side of reading text out of pictures.
 *
 * Recognised text is not kept in a private store: it goes straight into the same document index
 * that holds every other file's words. That is the whole point of the feature — a scanned page
 * should turn up in Search with a snippet, next to the notes and the PDFs, rather than in a
 * separate list of "OCR results" nobody would think to look in.
 */

export const DEFAULT_OCR_MODEL = 'ocr-trocr-small-printed';

const client: RpcClient<OcrMethods> = createRpcClient<OcrMethods>(new OcrWorker());

interface OcrState {
  ready: boolean;
  loading: boolean;
  progress: string | null;
  /** File ids currently being read. */
  working: string[];
}

const store = createStore<OcrState>({ ready: false, loading: false, progress: null, working: [] });

export function useOcrState(): OcrState {
  return useStoreSelector(store, (state) => state);
}

/** Whether the model is on disk, so the UI can offer to read without promising a free download. */
export async function ocrModelDownloaded(): Promise<boolean> {
  return isDownloaded(DEFAULT_OCR_MODEL).catch(() => false);
}

/**
 * Downloads the model if needed, with consent, and loads it.
 *
 * Returns false when the user declines, which is a normal outcome and not an error.
 */
export async function enableOcr(backendHint?: 'webgpu' | 'wasm'): Promise<boolean> {
  if (store.get().ready) return true;
  const model = getModel(DEFAULT_OCR_MODEL);
  if (!model) return false;

  const agreed = await ensureModel(
    DEFAULT_OCR_MODEL,
    'Reading text from pictures needs a recognition model. It runs on your device; the pages are not uploaded.',
  );
  if (!agreed) return false;

  store.set((state) => ({ ...state, loading: true }));
  try {
    await schedule(
      { label: 'Load text-recognition model', kind: 'model', priority: PRIORITY.userBatch },
      async () => {
        // Asked rather than assumed, and the answer was a surprise: see preferredBackend.
        const backend =
          backendHint ?? preferredBackend(await probeCapabilities(), 'text-recognition');
        await client.call(
          'load',
          [{ model: model.source.repo, backend }],
          {
            onProgress: (payload) => {
              const progress = payload as { status?: string; file?: string; progress?: number };
              if (progress.status === 'progress' && progress.file) {
                store.set((state) => ({
                  ...state,
                  progress: `${progress.file} ${Math.round(progress.progress ?? 0)}%`,
                }));
              }
            },
          },
        );
      },
    ).promise;

    store.set((state) => ({ ...state, ready: true, progress: null }));
    return true;
  } catch (error) {
    notifyError('The text-recognition model could not be loaded', error);
    return false;
  } finally {
    store.set((state) => ({ ...state, loading: false }));
  }
}

export async function disableOcr(): Promise<void> {
  await client.call('unload', []).catch(() => undefined);
  store.set((state) => ({ ...state, ready: false }));
}

/** Loads the model without asking again, if it is already on disk. */
export async function resumeOcr(): Promise<void> {
  if (store.get().ready || store.get().loading) return;
  if (await ocrModelDownloaded()) await enableOcr();
}

export interface ReadOptions {
  /** Read the page even if it does not look like a page of text. */
  force?: boolean;
  /** Put the recognised words into the search index. Default true. */
  index?: boolean;
}

/**
 * Reads a picture and, unless told otherwise, makes it searchable.
 *
 * User-batch priority: this is asked for explicitly and a page takes seconds, so it should have
 * the machine — but not ahead of a search the user is waiting on.
 */
export async function readImage(
  node: VfsNode,
  options: ReadOptions = {},
): Promise<OcrResult | null> {
  if (!store.get().ready) {
    const enabled = await enableOcr();
    if (!enabled) return null;
  }
  if (store.get().working.includes(node.id)) return null;

  store.set((state) => ({ ...state, working: [...state.working, node.id] }));
  try {
    const result = await schedule(
      { label: `Read ${node.name}`, kind: 'ocr', priority: PRIORITY.userBatch },
      async (context) => {
        context.throwIfCancelled();
        const { data } = await vfs.read(node.id);
        context.setProgress(null, 'Finding lines');

        return client.call(
          'read',
          [{ data, mime: node.mime, ...(options.force ? { force: true } : {}) }],
          {
            transfer: [data],
            onProgress: (payload) => {
              const { done, total } = payload as { done: number; total: number };
              context.setProgress(total > 0 ? done / total : null, `Line ${done} of ${total}`);
            },
          },
        );
      },
    ).promise;

    if (result.attempted && result.text && options.index !== false) {
      await indexWorker
        .call('indexText', [{ id: node.id, name: node.name, mime: node.mime, text: result.text }])
        .catch(() => undefined);
      await vfs.setIndexState(node.id, 'indexed', 'trocr').catch(() => undefined);
      await indexWorker.call('save', []).catch(() => undefined);

      notify({
        title: `Read ${result.lines.length} line${result.lines.length === 1 ? '' : 's'} from ${node.name}`,
        body: 'The words are in Search now.',
        level: 'success',
      });
    }

    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    notifyError(`Could not read ${node.name}`, error);
    return null;
  } finally {
    store.set((state) => ({
      ...state,
      working: state.working.filter((id) => id !== node.id),
    }));
  }
}

/** Pictures and scanned pages the model has not read yet. */
export async function readableFiles(): Promise<VfsNode[]> {
  const nodes = await vfs.allNodes();
  return nodes
    .filter((node) => node.kind === 'file' && !node.trashed && categoryOf(node) === 'image')
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export type { OcrResult };

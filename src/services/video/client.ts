import { PRIORITY, schedule } from '../../kernel/jobs';
import { notifyError } from '../../kernel/notifications';
import { createStore, useStoreSelector } from '../../kernel/store';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, categoryOf, type VfsNode } from '../../kernel/vfs/types';
import { indexWorker, isVisionEnabled } from '../index/client';
import { momentId, type Moment } from '../index/moments';
import { putThumbnail, deleteThumbnail } from '../index/thumbnails';
import { sampleFrames, frameAt, exportClip, canExportClips } from './frames';

/**
 * Main-thread side of video search.
 *
 * Split across the boundary the platform forces: `<video>` is a DOM element, so decoding happens
 * here, while the model stays in the index worker. Frames cross as small WebP buffers — a few
 * kilobytes each rather than megabytes of raw pixels — and are transferred, not copied.
 *
 * Videos are indexed on request rather than automatically. A photo costs one model pass; a
 * five-minute video costs 150, and spending that on every video someone happens to import,
 * without being asked, would be the kind of thing an OS should not do.
 */

export interface VideoIndexState {
  /** File ids currently being sampled and embedded. */
  working: string[];
  /** File id → 0..1, while it is being indexed. */
  progress: Record<string, number>;
  /** File ids with moments in the index. */
  indexed: string[];
}

const store = createStore<VideoIndexState>({ working: [], progress: {}, indexed: [] });

export function useVideoIndexState(): VideoIndexState {
  return useStoreSelector(store, (state) => state);
}

export async function refreshIndexedVideos(): Promise<void> {
  const indexed = await indexWorker.call('indexedVideoIds', []).catch(() => []);
  store.set((state) => ({ ...state, indexed }));
}

/** Seconds between sampled frames. Also the resolution of every answer this gives. */
export const SAMPLE_INTERVAL = 2;

/**
 * Samples a video and adds its moments to the image index.
 *
 * Returns the number of frames indexed. Safe to call again: the worker drops the video's existing
 * moments first, so re-indexing after changing the interval replaces the old ones.
 */
export async function indexVideo(node: VfsNode): Promise<number> {
  if (!isVisionEnabled()) {
    notifyError(
      'Video search needs the image model',
      new Error('Turn on photo search in Settings first — video moments use the same model.'),
    );
    return 0;
  }
  if (store.get().working.includes(node.id)) return 0;

  store.set((state) => ({
    ...state,
    working: [...state.working, node.id],
    progress: { ...state.progress, [node.id]: 0 },
  }));

  const setProgress = (value: number) =>
    store.set((state) => ({ ...state, progress: { ...state.progress, [node.id]: value } }));

  try {
    return await schedule(
      { label: `Index ${node.name}`, kind: 'index-video', priority: PRIORITY.userBatch },
      async (context) => {
        context.throwIfCancelled();
        const { data } = await vfs.read(node.id);
        context.setProgress(0, 'Decoding');

        // Sampling is half the work and reports its own share of the progress bar.
        const { frames } = await sampleFrames(data, node.mime, {
          interval: SAMPLE_INTERVAL,
          maxEdge: 336,
          signal: context.signal,
          onProgress: (done, total) => {
            const fraction = total > 0 ? (done / total) * 0.5 : 0;
            setProgress(fraction);
            context.setProgress(fraction, `Sampling frame ${done} of ${total}`);
          },
        });
        context.throwIfCancelled();
        if (frames.length === 0) return 0;

        // Each frame is kept as its own thumbnail, keyed by moment id, so a search result can be
        // shown instantly instead of re-opening and re-seeking the video to draw one row.
        const payload: { time: number; data: ArrayBuffer }[] = [];
        for (const frame of frames) {
          const bytes = await frame.blob.arrayBuffer();
          await putThumbnail(momentId(node.id, frame.time), bytes, frame.width, frame.height);
          payload.push({ time: frame.time, data: bytes });
        }

        context.setProgress(0.5, `Embedding ${frames.length} frames`);
        const result = await indexWorker.call(
          'indexMoments',
          [
            {
              sourceId: node.id,
              name: node.name,
              mime: node.mime,
              duration: frames[frames.length - 1]?.time ?? 0,
              frames: payload,
            },
          ],
          {
            transfer: payload.map((frame) => frame.data),
            onProgress: (payloadValue) => {
              const { done, total } = payloadValue as { done: number; total: number };
              const fraction = total > 0 ? 0.5 + (done / total) * 0.5 : 0.5;
              setProgress(fraction);
              context.setProgress(fraction, `Embedding frame ${done} of ${total}`);
            },
          },
        );

        await vfs.setIndexState(node.id, result.indexed > 0 ? 'indexed' : 'skipped', 'clip');
        await indexWorker.call('save', []).catch(() => undefined);
        await refreshIndexedVideos();
        return result.indexed;
      },
    ).promise;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 0;
    notifyError(`Could not index ${node.name}`, error);
    await vfs.setIndexState(node.id, 'failed');
    return 0;
  } finally {
    store.set((state) => {
      const progress = { ...state.progress };
      delete progress[node.id];
      return { ...state, working: state.working.filter((id) => id !== node.id), progress };
    });
  }
}

/** Searches every indexed video, or one of them, and returns moments best-first. */
export async function searchMoments(
  query: string,
  limit = 12,
  sourceId?: string,
): Promise<Moment[]> {
  if (!query.trim() || !isVisionEnabled()) return [];
  return schedule(
    { label: `Video search “${query}”`, kind: 'search', priority: PRIORITY.interactive },
    () => indexWorker.call('searchMoments', [{ query, limit, ...(sourceId ? { sourceId } : {}) }]),
  ).promise;
}

/** Drops a video's moments and their thumbnails. */
export async function forgetVideo(sourceId: string): Promise<void> {
  const times = await indexWorker.call('momentTimes', [sourceId]).catch(() => []);
  await indexWorker.call('forgetVideo', [sourceId]).catch(() => 0);
  for (const time of times) await deleteThumbnail(momentId(sourceId, time));
  await vfs.setIndexState(sourceId, 'pending').catch(() => undefined);
  await refreshIndexedVideos();
}

/** Every video in the file system, newest first. */
export async function listVideos(): Promise<VfsNode[]> {
  const nodes = await vfs.allNodes();
  return nodes
    .filter((node) => node.kind === 'file' && !node.trashed && categoryOf(node) === 'video')
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** A full-resolution still from a moment, saved beside the video. */
export async function saveFrame(node: VfsNode, time: number): Promise<VfsNode | null> {
  const { data } = await vfs.read(node.id);
  const blob = await frameAt(data, node.mime, time);
  if (!blob) return null;

  const base = node.name.replace(/\.[^.]+$/, '');
  return vfs.writeFile({
    parentId: node.parentId ?? ROOT_ID,
    name: `${base} at ${Math.round(time)}s.png`,
    data: await blob.arrayBuffer(),
    mime: 'image/png',
    overwrite: true,
  });
}

export { canExportClips };

/**
 * Saves a moment as its own video file, beside the original.
 *
 * Real-time: the section is played back and re-recorded, so a ten-second clip takes ten seconds.
 * That is stated in the UI rather than hidden behind a spinner.
 */
export async function saveClip(
  node: VfsNode,
  start: number,
  end: number,
  onProgress?: (fraction: number) => void,
): Promise<VfsNode | null> {
  const { data } = await vfs.read(node.id);
  const result = await schedule(
    { label: `Export clip from ${node.name}`, kind: 'export', priority: PRIORITY.userBatch },
    async (context) => {
      const clip = await exportClip(data, node.mime, start, end, {
        signal: context.signal,
        onProgress: (fraction) => {
          onProgress?.(fraction);
          context.setProgress(fraction, `${Math.round(fraction * 100)}%`);
        },
      });
      return clip;
    },
  ).promise;

  if (!result) return null;

  const base = node.name.replace(/\.[^.]+$/, '');
  return vfs.writeFile({
    parentId: node.parentId ?? ROOT_ID,
    name: `${base} ${Math.round(start)}-${Math.round(end)}s.webm`,
    data: await result.blob.arrayBuffer(),
    mime: result.blob.type || 'video/webm',
    overwrite: true,
  });
}

export type { Moment };

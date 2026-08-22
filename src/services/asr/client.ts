import AsrWorker from './asr.worker?worker';
import { createRpcClient, type RpcClient } from '../../kernel/rpc';
import { PRIORITY, schedule } from '../../kernel/jobs';
import { notify, notifyError } from '../../kernel/notifications';
import { createStore, useStoreSelector } from '../../kernel/store';
import { ensureModel, getModel } from '../../kernel/models';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, type VfsNode } from '../../kernel/vfs/types';
import { decodeToMono16k, formatTimestamp } from './decode';
import { detectChapters, type Chapter, type TranscriptSegment } from './chapters';
import type { AsrMethods, TranscriptResult } from './asr.worker';

/**
 * Transcription, from the main thread's point of view.
 *
 * Decodes on this thread (Web Audio is not available in workers), hands the samples over, and
 * writes the finished transcript into the file system as an ordinary Markdown file. That last
 * part matters: it means a transcript is searchable, viewable, editable and deletable through
 * the machinery that already exists, instead of being a special case that only the Audio app
 * understands.
 */

export const ASR_MODEL_ID = 'asr-whisper-tiny';
const TRANSCRIPT_FOLDER = 'Transcripts';

const client: RpcClient<AsrMethods> = createRpcClient<AsrMethods>(new AsrWorker());

interface AsrState {
  ready: boolean;
  loading: boolean;
  progress: string | null;
  /** File id currently being transcribed. */
  active: string | null;
}

const store = createStore<AsrState>({ ready: false, loading: false, progress: null, active: null });

export function useAsrState(): AsrState {
  return useStoreSelector(store, (state) => state);
}

/** Downloads and loads Whisper, asking first. Returns false if the user declines. */
export async function enableTranscription(backend: 'webgpu' | 'wasm' = 'wasm'): Promise<boolean> {
  if (store.get().ready) return true;

  const model = getModel(ASR_MODEL_ID);
  if (!model) return false;

  const agreed = await ensureModel(
    ASR_MODEL_ID,
    'Transcription needs a speech model. It runs on your device; your recordings are not uploaded.',
  );
  if (!agreed) return false;

  store.set((state) => ({ ...state, loading: true }));
  try {
    await schedule(
      { label: 'Load speech model', kind: 'model', priority: PRIORITY.userBatch },
      async () => {
        await client.call('load', [{ model: model.source.repo, backend }], {
          onProgress: (payload) => {
            const progress = payload as { status?: string; file?: string; progress?: number };
            if (progress.status === 'progress' && progress.file) {
              store.set((state) => ({
                ...state,
                progress: `${progress.file} ${Math.round(progress.progress ?? 0)}%`,
              }));
            }
          },
        });
      },
    ).promise;

    store.set((state) => ({ ...state, ready: true, progress: null }));
    return true;
  } catch (error) {
    notifyError('The speech model could not be loaded', error);
    return false;
  } finally {
    store.set((state) => ({ ...state, loading: false }));
  }
}

export interface TranscriptionOutcome extends TranscriptResult {
  chapters: Chapter[];
  /** The Markdown transcript written into the file system. */
  transcriptFileId: string | null;
  durationSeconds: number;
}

/**
 * Transcribes one audio file end to end: decode, recognise, chapter, and file the result.
 */
export async function transcribeFile(node: VfsNode): Promise<TranscriptionOutcome | null> {
  if (!store.get().ready && !(await enableTranscription())) return null;

  store.set((state) => ({ ...state, active: node.id }));
  const job = schedule(
    { label: `Transcribe ${node.name}`, kind: 'transcribe', priority: PRIORITY.userBatch },
    async (context) => {
      context.setProgress(null, 'decoding audio');
      const { data } = await vfs.read(node.id);
      const decoded = await decodeToMono16k(data);
      context.throwIfCancelled();

      context.setProgress(null, `${formatTimestamp(decoded.duration)} of audio`);
      const samples = decoded.samples;
      const result = await client.call('transcribe', [{ samples }], {
        transfer: [samples.buffer as ArrayBuffer],
        onProgress: () => context.setProgress(null, 'recognising speech'),
      });

      context.throwIfCancelled();
      const chapters = detectChapters(result.segments);
      const transcriptFileId = await writeTranscript(
        node,
        result.segments,
        chapters,
        decoded.duration,
      );

      return { ...result, chapters, transcriptFileId, durationSeconds: decoded.duration };
    },
  );

  try {
    const outcome = await job.promise;
    notify({
      title: `Transcribed ${node.name}`,
      body: `${outcome.segments.length} segments · ${outcome.realtimeFactor.toFixed(1)}× real time · saved to ${TRANSCRIPT_FOLDER}`,
      level: 'success',
    });
    return outcome;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      notifyError(`Could not transcribe ${node.name}`, error);
    }
    return null;
  } finally {
    store.set((state) => ({ ...state, active: null }));
  }
}

/**
 * Writes the transcript as Markdown into a Transcripts folder.
 *
 * Timestamps are included as plain text so the file remains readable on its own, and the whole
 * thing is picked up by the ordinary document indexer — which is how spoken words become
 * searchable without the search service knowing anything about audio.
 */
async function writeTranscript(
  node: VfsNode,
  segments: TranscriptSegment[],
  chapters: Chapter[],
  duration: number,
): Promise<string | null> {
  try {
    const children = await vfs.list(ROOT_ID);
    const existing = children.find(
      (child) => child.kind === 'directory' && child.name === TRANSCRIPT_FOLDER,
    );
    const folder = existing ?? (await vfs.createDirectory(ROOT_ID, TRANSCRIPT_FOLDER));

    const lines: string[] = [
      `# Transcript — ${node.name}`,
      '',
      `Duration ${formatTimestamp(duration)} · ${segments.length} segments · transcribed on this device.`,
      '',
    ];

    if (chapters.length > 1) {
      lines.push('## Chapters', '');
      for (const chapter of chapters) {
        lines.push(`- ${formatTimestamp(chapter.start)} — ${chapter.title}`);
      }
      lines.push('');
    }

    lines.push('## Transcript', '');
    for (const segment of segments) {
      lines.push(`**${formatTimestamp(segment.start)}** ${segment.text}`);
      lines.push('');
    }

    const file = await vfs.writeText(
      folder.id,
      `${node.name.replace(/\.[^.]+$/, '')} transcript.md`,
      lines.join('\n'),
      { mime: 'text/markdown', overwrite: true },
    );
    return file.id;
  } catch (error) {
    notifyError('The transcript could not be saved', error);
    return null;
  }
}

export async function unloadTranscription(): Promise<void> {
  await client.call('unload', []).catch(() => false);
  store.set((state) => ({ ...state, ready: false }));
}

export type { Chapter, TranscriptSegment, TranscriptResult };

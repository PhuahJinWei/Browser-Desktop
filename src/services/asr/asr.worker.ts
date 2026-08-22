import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { exposeRpc } from '../../kernel/rpc';
import { configureRuntime } from '../ai/runtime';
import type { TranscriptSegment } from './chapters';

/**
 * Speech recognition.
 *
 * Its own worker rather than sharing the index worker's: transcribing a long recording takes
 * minutes, and it must not sit in front of the queue that answers searches and indexes documents.
 *
 * Audio arrives already decoded to mono 16 kHz float samples — the Web Audio API is not available
 * in workers, so that happens on the main thread and only the samples cross over.
 */

export interface TranscribeOptions {
  samples: Float32Array;
  /** ISO language code, or omitted to let the model decide. */
  language?: string;
  /** Whisper processes 30-second windows; the stride overlaps them so words are not cut. */
  chunkLengthSeconds?: number;
  strideSeconds?: number;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  model: string;
  backend: string;
  /** Seconds of audio processed per second of wall clock. */
  realtimeFactor: number;
  processingMs: number;
}

export type AsrMethods = {
  load: (options: { model: string; backend: 'webgpu' | 'wasm' }) => { ready: boolean };
  transcribe: (options: TranscribeOptions) => TranscriptResult;
  unload: () => boolean;
  isReady: () => boolean;
};

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let modelId = '';
let backend: 'webgpu' | 'wasm' = 'wasm';

async function getTranscriber(
  report?: (payload: unknown) => void,
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriber) return transcriber;
  loading ??= (async () => {
    configureRuntime();
    const pipe = (await pipeline('automatic-speech-recognition', modelId, {
      device: backend,
      // The encoder and the merged decoder are quantised separately in these repositories.
      // The decoder uses the int8 export rather than the "quantized" one: the latter fails to
      // build a session on this runtime with "Missing required scale ... MatMulNBits", which is a
      // mismatch between that older QDQ export and current ONNX Runtime.
      dtype: { encoder_model: 'q8', decoder_model_merged: 'fp16' },
      ...(report ? { progress_callback: (progress: unknown) => report(progress) } : {}),
    })) as AutomaticSpeechRecognitionPipeline;
    transcriber = pipe;
    return pipe;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

interface WhisperChunk {
  timestamp: [number, number | null];
  text: string;
}

exposeRpc<AsrMethods>({
  load: async ([options], report) => {
    if (modelId !== options.model || backend !== options.backend) {
      transcriber = null;
      loading = null;
      modelId = options.model;
      backend = options.backend;
    }
    await getTranscriber(report);
    return { ready: true };
  },

  isReady: async () => transcriber !== null,

  unload: async () => {
    const current = transcriber;
    transcriber = null;
    loading = null;
    await current?.dispose?.();
    return true;
  },

  transcribe: async ([options], report) => {
    const pipe = await getTranscriber(report);
    const started = performance.now();
    const audioSeconds = options.samples.length / 16_000;

    const output = (await pipe(options.samples, {
      return_timestamps: true,
      chunk_length_s: options.chunkLengthSeconds ?? 30,
      stride_length_s: options.strideSeconds ?? 5,
      ...(options.language ? { language: options.language } : {}),
      // Progress arrives per decoded chunk, which is the only granularity Whisper offers.
      callback_function: (beams: unknown) => report({ status: 'decoding', beams }),
    })) as { text: string; chunks?: WhisperChunk[] };

    const processingMs = performance.now() - started;

    const segments: TranscriptSegment[] = (output.chunks ?? [])
      .map((chunk) => ({
        start: chunk.timestamp[0] ?? 0,
        // A trailing chunk can have a null end; fall back to the clip length.
        end: chunk.timestamp[1] ?? audioSeconds,
        text: chunk.text.trim(),
      }))
      .filter((segment) => segment.text.length > 0);

    return {
      text: output.text.trim(),
      segments:
        segments.length > 0
          ? segments
          : // No timestamps came back: still return the text as one segment rather than nothing.
            [{ start: 0, end: audioSeconds, text: output.text.trim() }],
      model: modelId,
      backend,
      realtimeFactor: audioSeconds / (processingMs / 1000),
      processingMs: Math.round(processingMs),
    };
  },
});

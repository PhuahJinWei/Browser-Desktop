import { pipeline, RawImage, type ImageToTextPipeline } from '@huggingface/transformers';
import { exposeRpc } from '../../kernel/rpc';
import { configureRuntime } from '../ai/runtime';
import { findLines, looksLikeText, type LineBox } from './segment';

/**
 * Reading text out of pictures.
 *
 * Its own worker, for the same reason speech recognition has one: a page is dozens of model
 * passes, and a queue that also answers searches would stop answering them.
 *
 * TrOCR is a line recogniser, not a page reader — it has no layout model at all. So this worker
 * does the layout itself (`segment.ts`), cuts the page into line images, and runs the model once
 * per line. That is the whole reason the code here is longer than "call the pipeline".
 *
 * The page arrives as raw greyscale bytes plus the original RGBA, both prepared on the main thread
 * or by the caller, because decoding an arbitrary image format still needs `createImageBitmap` and
 * a canvas — available here through OffscreenCanvas, which is what this uses.
 */

export interface OcrLine {
  text: string;
  box: LineBox;
  /** Milliseconds the model spent on this line. */
  ms: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  /** False when the page was rejected as not looking like text at all. */
  attempted: boolean;
  /** Present when the page was rejected, saying why. */
  skipped?: string;
  model: string;
  backend: string;
  processingMs: number;
}

export type OcrMethods = {
  load: (options: { model: string; backend: 'webgpu' | 'wasm' }) => { ready: boolean };
  read: (options: {
    data: ArrayBuffer;
    mime: string;
    /** Longest edge the page is scaled to before segmentation. */
    maxEdge?: number;
    maxLines?: number;
    /** Read even if the page does not look like a page of text. */
    force?: boolean;
  }) => OcrResult;
  unload: () => boolean;
  isReady: () => boolean;
};

let reader: ImageToTextPipeline | null = null;
let loading: Promise<ImageToTextPipeline> | null = null;
let modelId = '';
let backend: 'webgpu' | 'wasm' = 'wasm';

async function getReader(report?: (payload: unknown) => void): Promise<ImageToTextPipeline> {
  if (reader) return reader;
  loading ??= (async () => {
    configureRuntime();
    const pipe = (await pipeline('image-to-text', modelId, {
      device: backend,
      // Both halves quantised. Unlike Whisper, whose q8 decoder fails to build a session on this
      // runtime, TrOCR's exports load — verified before this was written, not assumed.
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      ...(report ? { progress_callback: (progress: unknown) => report(progress) } : {}),
    })) as ImageToTextPipeline;
    reader = pipe;
    return pipe;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

/** Decodes the page and scales it so the longest edge is `maxEdge`. */
async function decodePage(
  data: ArrayBuffer,
  mime: string,
  maxEdge: number,
): Promise<{ image: ImageData; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([data], { type: mime }));
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No 2D canvas context is available');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return { image: context.getImageData(0, 0, width, height), width, height };
}

/** Rec. 709 luma. Perceptual weighting matters here: pure blue text is not faint. */
function toGreyscale(image: ImageData): Uint8Array {
  const grey = new Uint8Array(image.width * image.height);
  const rgba = image.data;
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    grey[i] = (rgba[p]! * 0.2126 + rgba[p + 1]! * 0.7152 + rgba[p + 2]! * 0.0722) | 0;
  }
  return grey;
}

/**
 * Cuts one line out of the page as an image the model can take.
 *
 * Given to the model as RGB rather than greyscale because TrOCR's processor expects three
 * channels, and upscaled if the line is short: the processor resizes everything to 384×384, so a
 * 12-pixel-tall line would be blown up by the resizer with no filtering worth the name. Doing it
 * here with the canvas's own smoothing measurably helps on small text.
 */
function cutLine(image: ImageData, box: LineBox): RawImage {
  const targetHeight = Math.max(box.height, 64);
  const scale = targetHeight / box.height;
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));

  const source = new OffscreenCanvas(box.width, box.height);
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('No 2D canvas context is available');
  sourceContext.putImageData(image, -box.x, -box.y);

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No 2D canvas context is available');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const rgb = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 4, q += 3) {
    rgb[q] = data[p]!;
    rgb[q + 1] = data[p + 1]!;
    rgb[q + 2] = data[p + 2]!;
  }
  return new RawImage(rgb, width, height, 3);
}

exposeRpc<OcrMethods>({
  load: async ([options], report) => {
    if (modelId && modelId !== options.model) {
      await unload();
    }
    modelId = options.model;
    backend = options.backend;
    await getReader(report);
    return { ready: reader !== null };
  },

  read: async ([options], report) => {
    const startedAt = performance.now();
    const maxEdge = options.maxEdge ?? 1600;

    const { image, width, height } = await decodePage(options.data, options.mime, maxEdge);
    const grey = toGreyscale(image);
    const analysis = findLines(grey, width, height, { maxLines: options.maxLines ?? 60 });

    if (!options.force && !looksLikeText(analysis)) {
      return {
        text: '',
        lines: [],
        attempted: false,
        skipped:
          analysis.lines.length === 0
            ? 'No lines of text were found on this page'
            : 'This looks like a picture rather than a page of text',
        model: modelId,
        backend,
        processingMs: Math.round(performance.now() - startedAt),
      };
    }

    const recogniser = await getReader();
    const lines: OcrLine[] = [];

    for (const [index, box] of analysis.lines.entries()) {
      const lineStarted = performance.now();
      try {
        const output = (await recogniser(cutLine(image, box), {
          max_new_tokens: 128,
        })) as { generated_text?: string }[] | { generated_text?: string };

        const text = (Array.isArray(output) ? output[0]?.generated_text : output.generated_text)
          ?.trim()
          .replace(/\s+/g, ' ');

        if (text) lines.push({ text, box, ms: Math.round(performance.now() - lineStarted) });
      } catch {
        // One unreadable line does not abandon the page.
      }
      report({ done: index + 1, total: analysis.lines.length });
    }

    return {
      text: lines.map((line) => line.text).join('\n'),
      lines,
      attempted: true,
      model: modelId,
      backend,
      processingMs: Math.round(performance.now() - startedAt),
    };
  },

  unload: async () => unload(),

  isReady: async () => reader !== null,
});

async function unload(): Promise<boolean> {
  if (!reader) return false;
  await reader.dispose?.().catch(() => undefined);
  reader = null;
  loading = null;
  return true;
}

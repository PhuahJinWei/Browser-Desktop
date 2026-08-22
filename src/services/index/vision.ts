import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';
import { configureRuntime } from '../ai/runtime';

/**
 * Image understanding, via a CLIP-family model.
 *
 * CLIP puts pictures and sentences in the *same* vector space, which is the entire trick: a photo
 * of a sunset and the words "sunset over water" land near each other, so searching images by
 * description is an ordinary nearest-neighbour lookup. No tags, no captions, no filenames.
 *
 * The vectors are 512-dimensional and are **not** comparable with the 384-dimensional text
 * embeddings used for documents — different model, different space. They live in a separate index
 * and are only ever compared with CLIP text vectors. Mixing them would silently return nonsense.
 */

export interface VisionRuntime {
  modelId: string;
  dimensions: number;
  ready: boolean;
}

type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type VisionModel = Awaited<ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>>;
type TextModel = Awaited<ReturnType<typeof CLIPTextModelWithProjection.from_pretrained>>;

interface Loaded {
  modelId: string;
  processor: Processor;
  tokenizer: Tokenizer;
  visionModel: VisionModel;
  textModel: TextModel;
  dimensions: number;
}

let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;
let lastUsed = 0;

export function visionRuntime(): VisionRuntime {
  return {
    modelId: loaded?.modelId ?? '',
    dimensions: loaded?.dimensions ?? 512,
    ready: loaded !== null,
  };
}

export function visionLastUsed(): number {
  return lastUsed;
}

/**
 * Loads the four pieces a CLIP model needs.
 *
 * They are loaded together rather than lazily because searching needs the text tower and indexing
 * needs the vision tower, and a session does both within seconds of each other.
 */
export async function loadVision(
  modelId: string,
  backend: 'webgpu' | 'wasm',
  report?: (payload: unknown) => void,
): Promise<Loaded> {
  if (loaded?.modelId === modelId) return loaded;
  if (loading) return loading;

  loading = (async () => {
    configureRuntime();
    const options = {
      dtype: 'q8' as const,
      device: backend,
      ...(report ? { progress_callback: (progress: unknown) => report(progress) } : {}),
    };

    const [processor, tokenizer, visionModel, textModel] = await Promise.all([
      AutoProcessor.from_pretrained(
        modelId,
        report ? { progress_callback: (p: unknown) => report(p) } : {},
      ),
      AutoTokenizer.from_pretrained(
        modelId,
        report ? { progress_callback: (p: unknown) => report(p) } : {},
      ),
      CLIPVisionModelWithProjection.from_pretrained(modelId, options),
      CLIPTextModelWithProjection.from_pretrained(modelId, options),
    ]);

    loaded = { modelId, processor, tokenizer, visionModel, textModel, dimensions: 512 };
    loading = null;
    lastUsed = Date.now();
    return loaded;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

/** Frees both towers. Called by the model lifecycle when memory is tight. */
export async function unloadVision(): Promise<void> {
  const current = loaded;
  loaded = null;
  loading = null;
  if (!current) return;
  await Promise.allSettled([current.visionModel.dispose?.(), current.textModel.dispose?.()]);
}

function toFloat32(data: unknown, dimensions: number, row: number): Float32Array {
  const flat = data as Float32Array;
  return flat.slice(row * dimensions, (row + 1) * dimensions) as Float32Array;
}

/** Embeds one image. The bytes are whatever was stored — decoding is the processor's problem. */
export async function embedImage(data: ArrayBuffer, mime: string): Promise<Float32Array> {
  if (!loaded) throw new Error('The vision model is not loaded');
  lastUsed = Date.now();

  const image = await RawImage.fromBlob(new Blob([data], { type: mime }));
  const inputs = await loaded.processor(image);
  const output = await loaded.visionModel(inputs);

  const embeds = output.image_embeds;
  if (!embeds) throw new Error('The vision model returned no image embedding');
  const dimensions = embeds.dims.at(-1) ?? loaded.dimensions;
  loaded.dimensions = dimensions;
  return toFloat32(embeds.data, dimensions, 0);
}

/** Embeds search phrases into the same space as the images. */
export async function embedPhrases(texts: string[]): Promise<Float32Array[]> {
  if (!loaded) throw new Error('The vision model is not loaded');
  lastUsed = Date.now();

  /**
   * CLIP's text tower has a fixed 77-token context, and its positional embedding is shaped to
   * match. Padding to the longest string in the batch — the usual default — produces a tensor of
   * whatever length the query happened to be and the addition fails to broadcast:
   *
   *   /Add: left operand cannot broadcast on dim 1, LeftShape {1,5,512}, RightShape {1,77,512}
   *
   * So pad to the full 77 every time, regardless of how short the phrase is.
   */
  const inputs = loaded.tokenizer(texts, {
    padding: 'max_length',
    max_length: 77,
    truncation: true,
  });
  const output = await loaded.textModel(inputs);

  const embeds = output.text_embeds;
  if (!embeds) throw new Error('The text tower returned no embedding');
  const dimensions = embeds.dims.at(-1) ?? loaded.dimensions;
  loaded.dimensions = dimensions;
  return texts.map((_, row) => toFloat32(embeds.data, dimensions, row));
}

/**
 * A thumbnail for the Photos grid, stored alongside the embedding.
 *
 * Generated here because the full image is already decoded for the model, so a second decode on
 * the main thread would be pure waste — and a grid of full-size images is what makes photo
 * managers stutter.
 */
export async function makeThumbnail(
  data: ArrayBuffer,
  mime: string,
  maxEdge = 320,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function')
    return null;

  const bitmap = await createImageBitmap(new Blob([data], { type: mime }));
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  const original = { width: bitmap.width, height: bitmap.height };
  bitmap.close();

  // WebP at 0.8 is a good trade for thumbnails: roughly a tenth the size of PNG, no visible loss
  // at this scale.
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  return { blob, width: original.width, height: original.height };
}

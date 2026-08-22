import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { exposeRpc, type Handler } from '../../kernel/rpc';
import { configureRuntime } from '../ai/runtime';

/**
 * Benchmark worker.
 *
 * M0 exists to replace guesses with numbers: which backend is actually faster on this machine,
 * what a model costs to load, and whether OPFS is fast enough to be the file system. Everything
 * runs in a worker because that is where the real system will run it — measuring on the main
 * thread would measure something we will never ship.
 */

export interface EmbeddingBenchOptions {
  device: 'webgpu' | 'wasm';
  dtype: 'q8' | 'fp32' | 'fp16';
  model: string;
  batchSize: number;
  batches: number;
}

export interface EmbeddingBenchResult {
  ok: true;
  device: string;
  dtype: string;
  model: string;
  loadMs: number;
  warmupMs: number;
  batchSize: number;
  batches: number;
  totalChunks: number;
  totalMs: number;
  msPerChunk: number;
  chunksPerSecond: number;
  dimensions: number;
  /**
   * Bytes pulled over the network during load, from Resource Timing.
   *
   * Reads 0 for cross-origin weights: the model CDN does not send `Timing-Allow-Origin`, so the
   * browser hides the size. Treat it as a same-origin figure only; the authoritative per-model
   * byte counts live in models.json.
   */
  transferredBytes: number;
  numThreads: number;
}

export interface BenchFailure {
  ok: false;
  device: string;
  error: string;
}

export interface OpfsBenchResult {
  ok: true;
  fileSizeMb: number;
  writeMs: number;
  readMs: number;
  writeMbPerSecond: number;
  readMbPerSecond: number;
  usedSyncAccessHandle: boolean;
}

/** A fixed, deterministic corpus so runs are comparable across machines. */
const SENTENCES = [
  'The quarterly invoice for the 27-inch monitor was approved last Tuesday.',
  'Meeting notes: budget review, hiring plan, and the migration timeline.',
  'A tabby cat is asleep on the blue sofa near the window.',
  'Sunset over the ocean, photographed from the northern beach.',
  'The red mechanical keyboard arrived in the same shipment as the dock.',
  'Please find attached the signed contract and the revised statement of work.',
  'Backup completed successfully; 14,208 files were copied to the archive.',
  'Travel itinerary for Tokyo: arrival Monday, three nights, return Friday.',
];

function corpus(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const base = SENTENCES[i % SENTENCES.length] ?? SENTENCES[0]!;
    // Vary the text so no cache or shortcut can make later items artificially cheap.
    return `${base} (sample ${i})`;
  });
}

/** Total bytes fetched so far, from the Resource Timing buffer. */
function transferredBytes(): number {
  try {
    return performance
      .getEntriesByType('resource')
      .reduce((sum, entry) => sum + ((entry as PerformanceResourceTiming).transferSize || 0), 0);
  } catch {
    return 0;
  }
}

const benchEmbeddings: Handler<
  [EmbeddingBenchOptions],
  EmbeddingBenchResult | BenchFailure
> = async ([options], report) => {
  const runtime = configureRuntime();

  try {
    const bytesBefore = transferredBytes();
    const loadStart = performance.now();

    const extractor = (await pipeline('feature-extraction', options.model, {
      device: options.device,
      dtype: options.dtype,
      progress_callback: (progress: unknown) => report(progress),
    })) as FeatureExtractionPipeline;

    const loadMs = performance.now() - loadStart;
    const bytesAfter = transferredBytes();

    // One untimed pass: the first inference pays for shader compilation and buffer allocation.
    const warmupStart = performance.now();
    await extractor(corpus(options.batchSize), { pooling: 'mean', normalize: true });
    const warmupMs = performance.now() - warmupStart;

    let totalMs = 0;
    let dimensions = 0;
    for (let batch = 0; batch < options.batches; batch++) {
      const texts = corpus(options.batchSize).map((t) => `${t} [batch ${batch}]`);
      const start = performance.now();
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      totalMs += performance.now() - start;
      dimensions = output.dims.at(-1) ?? 0;
      report({ status: 'batch', batch: batch + 1, of: options.batches });
    }

    const totalChunks = options.batchSize * options.batches;
    await extractor.dispose();

    return {
      ok: true,
      device: options.device,
      dtype: options.dtype,
      model: options.model,
      loadMs: Math.round(loadMs),
      warmupMs: Math.round(warmupMs),
      batchSize: options.batchSize,
      batches: options.batches,
      totalChunks,
      totalMs: Math.round(totalMs),
      msPerChunk: Number((totalMs / totalChunks).toFixed(3)),
      chunksPerSecond: Number((totalChunks / (totalMs / 1000)).toFixed(1)),
      dimensions,
      transferredBytes: Math.max(0, bytesAfter - bytesBefore),
      numThreads: runtime.numThreads,
    };
  } catch (error) {
    return {
      ok: false,
      device: options.device,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const benchOpfs: Handler<[{ fileSizeMb: number }], OpfsBenchResult | BenchFailure> = async ([
  { fileSizeMb },
]) => {
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('.tabula-benchmark', { create: true });
    const payload = new Uint8Array(fileSizeMb * 1024 * 1024);
    // Fill with non-zero data: an all-zero buffer can be optimised by the storage layer.
    crypto.getRandomValues(payload.subarray(0, Math.min(payload.length, 65536)));

    const createSyncAccessHandle = handle.createSyncAccessHandle?.bind(handle);
    const supportsSync = createSyncAccessHandle !== undefined;
    let writeMs: number;
    let readMs: number;

    if (createSyncAccessHandle) {
      const access = await createSyncAccessHandle();
      const writeStart = performance.now();
      access.write(payload, { at: 0 });
      access.flush();
      writeMs = performance.now() - writeStart;

      const target = new Uint8Array(payload.length);
      const readStart = performance.now();
      access.read(target, { at: 0 });
      readMs = performance.now() - readStart;
      access.close();
    } else {
      const writable = await handle.createWritable();
      const writeStart = performance.now();
      await writable.write(payload);
      await writable.close();
      writeMs = performance.now() - writeStart;

      const readStart = performance.now();
      await (await handle.getFile()).arrayBuffer();
      readMs = performance.now() - readStart;
    }

    await root.removeEntry('.tabula-benchmark').catch(() => undefined);

    return {
      ok: true,
      fileSizeMb,
      writeMs: Math.round(writeMs),
      readMs: Math.round(readMs),
      writeMbPerSecond: Number((fileSizeMb / (writeMs / 1000)).toFixed(1)),
      readMbPerSecond: Number((fileSizeMb / (readMs / 1000)).toFixed(1)),
      usedSyncAccessHandle: supportsSync,
    };
  } catch (error) {
    return {
      ok: false,
      device: 'opfs',
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export type BenchMethods = {
  benchEmbeddings: (options: EmbeddingBenchOptions) => EmbeddingBenchResult | BenchFailure;
  benchOpfs: (options: { fileSizeMb: number }) => OpfsBenchResult | BenchFailure;
};

exposeRpc<BenchMethods>({ benchEmbeddings, benchOpfs });

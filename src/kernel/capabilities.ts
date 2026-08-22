/**
 * Capability probe.
 *
 * Runs once at boot and answers the only questions that matter before anything else loads:
 * can we use the GPU, can we store files, can we thread, and how much machine is under us.
 * Everything downstream — which models are offered, which backend runs them, whether folder
 * re-linking is possible — is a consequence of this result rather than a user-agent guess.
 *
 * Deliberately dependency-free and safe to call in Node (every probe degrades to `false`),
 * so it can be unit tested without a browser.
 */

export type HardwareTier = 'A' | 'B' | 'C';

export interface GpuCapability {
  available: boolean;
  /** True when the adapter is a software rasteriser: present, but not worth scheduling work on. */
  fallbackAdapter: boolean;
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  maxBufferBytes?: number;
  maxStorageBufferBindingBytes?: number;
  maxComputeInvocationsPerWorkgroup?: number;
  shaderF16: boolean;
  featureCount?: number;
  error?: string;
}

export interface Capabilities {
  gpu: GpuCapability;
  wasm: { simd: boolean; threads: boolean };
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  storage: {
    opfs: boolean;
    /**
     * `null` on the main thread: sync access handles are worker-only, so the main thread cannot
     * answer honestly. Fill this from `probeWorkerCapabilities()`.
     */
    syncAccessHandle: boolean | null;
    indexedDB: boolean;
    persisted: boolean;
    quotaBytes?: number;
    usageBytes?: number;
  };
  fileSystemAccess: { directoryPicker: boolean; filePicker: boolean; dragDropHandles: boolean };
  builtinAi: {
    promptApi: boolean;
    summarizer: boolean;
    translator: boolean;
    availability?: string;
  };
  webnn: boolean;
  media: { webCodecs: boolean; offscreenCanvas: boolean; imageBitmap: boolean };
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  serviceWorker: boolean;
  tier: HardwareTier;
  tierReason: string;
  probedAt: string;
}

/* -------------------------------------------------------------------------------------------- */
/* WebAssembly feature detection                                                                  */
/* -------------------------------------------------------------------------------------------- */

/**
 * Minimal modules that only validate when the feature is present. Byte sequences follow the
 * approach used by the `wasm-feature-detect` library; inlined here to avoid a dependency (P8).
 */
// prettier-ignore
const WASM_SIMD: Uint8Array<ArrayBuffer> = Uint8Array.of(
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
);
// prettier-ignore
const WASM_THREADS: Uint8Array<ArrayBuffer> = Uint8Array.of(
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65,
  0, 254, 16, 2, 0, 26, 11,
);

function validates(bytes: Uint8Array<ArrayBuffer>): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------------------------- */
/* Structural types for APIs that are not in every lib.dom yet                                    */
/* -------------------------------------------------------------------------------------------- */

interface AdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}
interface AdapterLike {
  info?: AdapterInfoLike;
  requestAdapterInfo?: () => Promise<AdapterInfoLike>;
  isFallbackAdapter?: boolean;
  features?: { size?: number; has?: (f: string) => boolean };
  limits?: Record<string, number>;
}
interface GpuLike {
  requestAdapter: (opts?: { powerPreference?: string }) => Promise<AdapterLike | null>;
}
interface AvailabilityLike {
  availability?: () => Promise<string>;
}

const g = globalThis as unknown as {
  navigator?: {
    gpu?: GpuLike;
    ml?: unknown;
    storage?: {
      getDirectory?: unknown;
      persisted?: () => Promise<boolean>;
      estimate?: () => Promise<{ quota?: number; usage?: number }>;
    };
    hardwareConcurrency?: number;
    deviceMemory?: number;
    serviceWorker?: unknown;
  };
  window?: unknown;
  indexedDB?: unknown;
  showDirectoryPicker?: unknown;
  showOpenFilePicker?: unknown;
  DataTransferItem?: { prototype?: Record<string, unknown> };
  FileSystemFileHandle?: { prototype?: Record<string, unknown> };
  LanguageModel?: AvailabilityLike;
  Summarizer?: unknown;
  Translator?: unknown;
  VideoDecoder?: unknown;
  OffscreenCanvas?: unknown;
  createImageBitmap?: unknown;
  crossOriginIsolated?: boolean;
  SharedArrayBuffer?: unknown;
};

/* -------------------------------------------------------------------------------------------- */
/* Probes                                                                                         */
/* -------------------------------------------------------------------------------------------- */

async function probeGpu(): Promise<GpuCapability> {
  const gpu = g.navigator?.gpu;
  if (!gpu) return { available: false, fallbackAdapter: false, shaderF16: false };

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return {
        available: false,
        fallbackAdapter: false,
        shaderF16: false,
        error: 'navigator.gpu exists but no adapter was returned (blocklisted driver or no GPU).',
      };
    }

    // `adapter.info` is the current shape; `requestAdapterInfo()` is the older one.
    const info: AdapterInfoLike =
      adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    const limits = adapter.limits ?? {};

    return {
      available: true,
      fallbackAdapter: adapter.isFallbackAdapter === true,
      ...(info.vendor ? { vendor: info.vendor } : {}),
      ...(info.architecture ? { architecture: info.architecture } : {}),
      ...(info.device ? { device: info.device } : {}),
      ...(info.description ? { description: info.description } : {}),
      ...(typeof limits['maxBufferSize'] === 'number'
        ? { maxBufferBytes: limits['maxBufferSize'] }
        : {}),
      ...(typeof limits['maxStorageBufferBindingSize'] === 'number'
        ? { maxStorageBufferBindingBytes: limits['maxStorageBufferBindingSize'] }
        : {}),
      ...(typeof limits['maxComputeInvocationsPerWorkgroup'] === 'number'
        ? { maxComputeInvocationsPerWorkgroup: limits['maxComputeInvocationsPerWorkgroup'] }
        : {}),
      shaderF16: adapter.features?.has?.('shader-f16') === true,
      ...(typeof adapter.features?.size === 'number'
        ? { featureCount: adapter.features.size }
        : {}),
    };
  } catch (error) {
    return {
      available: false,
      fallbackAdapter: false,
      shaderF16: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeStorage(): Promise<Capabilities['storage']> {
  const storage = g.navigator?.storage;
  const opfs = typeof storage?.getDirectory === 'function';

  // On the main thread the answer is unknowable rather than false — the API is worker-only.
  const onMainThread = typeof (g as { document?: unknown }).document !== 'undefined';
  const syncAccessHandle = onMainThread
    ? null
    : typeof g.FileSystemFileHandle?.prototype?.['createSyncAccessHandle'] === 'function';

  let persisted = false;
  let quotaBytes: number | undefined;
  let usageBytes: number | undefined;
  try {
    persisted = (await storage?.persisted?.()) ?? false;
    const estimate = await storage?.estimate?.();
    quotaBytes = estimate?.quota;
    usageBytes = estimate?.usage;
  } catch {
    /* estimate is unavailable in some privacy modes; absence is the answer. */
  }

  return {
    opfs,
    syncAccessHandle,
    indexedDB: typeof g.indexedDB !== 'undefined',
    persisted,
    ...(quotaBytes !== undefined ? { quotaBytes } : {}),
    ...(usageBytes !== undefined ? { usageBytes } : {}),
  };
}

async function probeBuiltinAi(): Promise<Capabilities['builtinAi']> {
  const promptApi = typeof g.LanguageModel !== 'undefined';
  let availability: string | undefined;
  try {
    availability = await g.LanguageModel?.availability?.();
  } catch {
    /* Present but gated (policy, hardware, or download required). */
  }
  return {
    promptApi,
    summarizer: typeof g.Summarizer !== 'undefined',
    translator: typeof g.Translator !== 'undefined',
    ...(availability !== undefined ? { availability } : {}),
  };
}

/**
 * Hardware tier. Deliberately conservative: a wrong "A" means a stalled tab on someone's laptop,
 * a wrong "B" only means a smaller model. Users can override this in Settings.
 */
export function classifyTier(
  gpu: GpuCapability,
  deviceMemoryGb: number | undefined,
  hardwareConcurrency: number,
): { tier: HardwareTier; reason: string } {
  if (!gpu.available || gpu.fallbackAdapter) {
    return {
      tier: 'C',
      reason: gpu.fallbackAdapter
        ? 'WebGPU reports a software fallback adapter — CPU (WASM) is the honest choice.'
        : 'No WebGPU adapter; models run on the CPU via WebAssembly.',
    };
  }

  // deviceMemory is Chromium-only, so core count stands in elsewhere.
  const memoryKnown = typeof deviceMemoryGb === 'number';
  const roomy = memoryKnown ? deviceMemoryGb >= 8 : hardwareConcurrency >= 8;
  const bigBuffers = (gpu.maxBufferBytes ?? 0) >= 2 ** 31;

  if (roomy && bigBuffers) {
    return {
      tier: 'A',
      reason: memoryKnown
        ? `WebGPU with ${deviceMemoryGb} GB reported memory and ≥2 GiB max buffer size.`
        : `WebGPU with ${hardwareConcurrency} cores and ≥2 GiB max buffer size (memory not reported).`,
    };
  }
  return {
    tier: 'B',
    reason: bigBuffers
      ? 'WebGPU available, but limited system memory — smaller model variants only.'
      : 'WebGPU available with a smaller max buffer size — smaller model variants only.',
  };
}

export async function probeCapabilities(): Promise<Capabilities> {
  const [gpu, storage, builtinAi] = await Promise.all([
    probeGpu(),
    probeStorage(),
    probeBuiltinAi(),
  ]);

  const hardwareConcurrency = g.navigator?.hardwareConcurrency ?? 1;
  const deviceMemoryGb = g.navigator?.deviceMemory;
  const { tier, reason } = classifyTier(gpu, deviceMemoryGb, hardwareConcurrency);

  return {
    gpu,
    wasm: { simd: validates(WASM_SIMD), threads: validates(WASM_THREADS) },
    crossOriginIsolated: g.crossOriginIsolated === true,
    sharedArrayBuffer: typeof g.SharedArrayBuffer !== 'undefined',
    storage,
    fileSystemAccess: {
      directoryPicker: typeof g.showDirectoryPicker === 'function',
      filePicker: typeof g.showOpenFilePicker === 'function',
      dragDropHandles:
        typeof g.DataTransferItem?.prototype?.['getAsFileSystemHandle'] === 'function',
    },
    builtinAi,
    webnn: typeof g.navigator?.ml !== 'undefined',
    media: {
      webCodecs: typeof g.VideoDecoder !== 'undefined',
      offscreenCanvas: typeof g.OffscreenCanvas !== 'undefined',
      imageBitmap: typeof g.createImageBitmap === 'function',
    },
    hardwareConcurrency,
    ...(deviceMemoryGb !== undefined ? { deviceMemoryGb } : {}),
    serviceWorker: typeof g.navigator?.serviceWorker !== 'undefined',
    tier,
    tierReason: reason,
    probedAt: new Date().toISOString(),
  };
}

export type InferenceTask =
  'text-embedding' | 'image-text-embedding' | 'speech-recognition' | 'generation';

/**
 * Which backend to schedule a task on.
 *
 * Not simply "WebGPU if present". M0 measured all-MiniLM-L6-v2 (int8, 128 sentences per run) on
 * a Ryzen/RDNA-3 machine and threaded WASM beat WebGPU by roughly 2.2x — 6.5 ms per chunk versus
 * 14.4 ms, reproducibly, with the GPU warm. For a 22 MB encoder over short sentences the per-
 * dispatch overhead dominates, and 4 SIMD threads simply win.
 *
 * So: small text embeddings prefer threaded WASM; the heavier models (vision towers, Whisper,
 * any generation) still prefer the GPU, and those numbers get measured in M2 rather than assumed.
 * See docs/benchmarks/.
 */
export function preferredBackend(
  caps: Capabilities,
  task: InferenceTask = 'text-embedding',
): 'webgpu' | 'wasm' {
  const gpu = caps.gpu.available && !caps.gpu.fallbackAdapter;
  const threadedWasm = caps.wasm.simd && caps.wasm.threads && caps.crossOriginIsolated;

  if (task === 'text-embedding' && threadedWasm) return 'wasm';
  return gpu ? 'webgpu' : 'wasm';
}

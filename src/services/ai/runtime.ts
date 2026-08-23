import { env } from '@huggingface/transformers';

/**
 * One place where the ML runtime is configured, imported by every inference worker.
 *
 * Two defaults have to be overridden, and both for the same reason: out of the box this library
 * fetches from other people's servers.
 *
 * `wasmPaths` — the ONNX runtime would come from a public CDN, which would break the CSP
 * (`script-src 'self'`) and stop the app working offline. `tools/sync-runtime.mjs` copies the
 * binaries into public/runtime/.
 *
 * `localModelPath` with `allowRemoteModels: false` — model weights would come from
 * huggingface.co on first use. `tools/sync-model.mjs` vendors them into public/models/ instead,
 * so the weights are served from the same origin as the code. Remote loading is not merely
 * unnecessary now, it is switched off: if a file is missing the failure should be a loud 404
 * against our own origin, not a silent 23 MB download from somewhere else.
 */

export interface RuntimeInfo {
  wasmPaths: string;
  numThreads: number;
  crossOriginIsolated: boolean;
  /** Where model weights are loaded from. Same origin, always. */
  modelPath: string;
}

let configured: RuntimeInfo | null = null;

export function configureRuntime(): RuntimeInfo {
  if (configured) return configured;

  const base = import.meta.env.BASE_URL;
  const isolated = globalThis.crossOriginIsolated === true;
  const wasmPaths = `${base}runtime/`;
  const modelPath = `${base}models/`;

  /**
   * Without cross-origin isolation there is no SharedArrayBuffer, and asking for more than one
   * thread throws rather than degrading. Cap at 4: past that, memory bandwidth dominates and the
   * extra workers mostly fight the UI for cores.
   */
  const numThreads = isolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 1)) : 1;

  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = wasmPaths;
    wasm.numThreads = numThreads;
  }

  // Weights come from this origin and nowhere else.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelPath;

  // Cache weights in the browser HTTP cache so a reload does not re-read them from disk. The
  // service worker also keeps a copy, which is what survives eviction and works offline.
  env.useBrowserCache = true;

  configured = {
    wasmPaths,
    numThreads,
    crossOriginIsolated: isolated,
    modelPath,
  };
  return configured;
}

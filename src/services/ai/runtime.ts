import { env } from '@huggingface/transformers';

/**
 * One place where the ML runtime is configured, imported by every inference worker.
 *
 * The important part is `wasmPaths`: by default the runtime is fetched from a public CDN, which
 * would violate the project's two-hosts promise, break the CSP (`script-src 'self'`), and stop
 * the app working offline. `tools/sync-runtime.mjs` copies the binaries into public/runtime/ and
 * this points the runtime at them.
 */

export interface RuntimeInfo {
  wasmPaths: string;
  numThreads: number;
  crossOriginIsolated: boolean;
  /** Where model weights are fetched from when they are not bundled. */
  remoteHost: string;
}

let configured: RuntimeInfo | null = null;

export function configureRuntime(): RuntimeInfo {
  if (configured) return configured;

  const base = import.meta.env.BASE_URL;
  const isolated = globalThis.crossOriginIsolated === true;
  const wasmPaths = `${base}runtime/`;

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

  // Cache weights in the browser HTTP cache so a reload does not re-download them.
  env.useBrowserCache = true;

  configured = {
    wasmPaths,
    numThreads,
    crossOriginIsolated: isolated,
    remoteHost: env.remoteHost ?? 'https://huggingface.co/',
  };
  return configured;
}

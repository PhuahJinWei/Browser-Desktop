import { exposeRpc } from './rpc';

/**
 * Worker-context capability probe.
 *
 * Some capabilities only exist inside a worker, so asking about them on the main thread returns a
 * confident, wrong answer. `createSyncAccessHandle` is the one that matters: it is the fast path
 * for OPFS (measured at ~511 MB/s write, ~915 MB/s read on the M0 reference machine) and the
 * whole reason file I/O gets its own worker, yet `FileSystemFileHandle.prototype` on the main
 * thread does not have it. This worker asks from the context that will actually use it.
 */

export interface WorkerCapabilities {
  syncAccessHandle: boolean;
  offscreenCanvas: boolean;
  webgpuInWorker: boolean;
  crossOriginIsolated: boolean;
}

export type ProbeMethods = {
  workerCapabilities: () => WorkerCapabilities;
};

exposeRpc<ProbeMethods>({
  workerCapabilities: () => ({
    syncAccessHandle:
      typeof (FileSystemFileHandle.prototype as { createSyncAccessHandle?: unknown })
        .createSyncAccessHandle === 'function',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    webgpuInWorker: typeof navigator !== 'undefined' && 'gpu' in navigator,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
  }),
});

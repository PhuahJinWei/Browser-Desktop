import ProbeWorker from './probe.worker?worker';
import { createRpcClient } from './rpc';
import type { ProbeMethods, WorkerCapabilities } from './probe.worker';

/**
 * Runs the worker-context capability probe.
 *
 * Kept out of capabilities.ts on purpose: that module must stay importable in Node for unit
 * tests, and a `new Worker(...)` import would break it there.
 */
export async function probeWorkerCapabilities(
  timeoutMs = 3000,
): Promise<WorkerCapabilities | null> {
  if (typeof Worker === 'undefined') return null;

  const client = createRpcClient<ProbeMethods>(new ProbeWorker());
  try {
    return await Promise.race([
      client.call('workerCapabilities', []),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    // A worker that fails to start is itself an answer: assume the capabilities are absent.
    return null;
  } finally {
    client.terminate();
  }
}

export type { WorkerCapabilities };

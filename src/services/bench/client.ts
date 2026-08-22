import BenchWorker from './bench.worker?worker';
import { createRpcClient, type RpcClient } from '../../kernel/rpc';
import type { BenchMethods } from './bench.worker';

/**
 * Main-thread handle to the benchmark worker.
 *
 * A fresh worker per run: model loading leaves large buffers and a WebGPU device behind, and the
 * point of a benchmark is that each run starts from the same place.
 */
export function createBenchClient(): RpcClient<BenchMethods> {
  return createRpcClient<BenchMethods>(new BenchWorker());
}

export type {
  EmbeddingBenchOptions,
  EmbeddingBenchResult,
  OpfsBenchResult,
  BenchFailure,
} from './bench.worker';

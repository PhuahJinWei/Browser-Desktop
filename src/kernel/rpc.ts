/**
 * Typed worker RPC.
 *
 * Every expensive thing in this system happens off the main thread, so the main thread talks to
 * workers constantly and needs that traffic to be typed, awaited, and able to report progress
 * (model downloads and indexing runs are long enough that silence is not an option).
 *
 * Hand-rolled rather than Comlink: this is ~90 lines, it keeps progress streaming as a
 * first-class concept rather than a callback proxy, and it leaves room for the cancellation
 * tokens the M1 scheduler needs.
 */

export type RpcMethods = Record<string, (...args: never[]) => unknown>;

type CallMessage = { id: number; kind: 'call'; method: string; args: unknown[] };
type ResultMessage = { id: number; kind: 'result'; value: unknown };
type ErrorMessage = { id: number; kind: 'error'; message: string; stack?: string };
type ProgressMessage = { id: number; kind: 'progress'; payload: unknown };
type ResponseMessage = ResultMessage | ErrorMessage | ProgressMessage;

export interface CallOptions<P = unknown> {
  /** Buffers to hand over rather than copy. */
  transfer?: Transferable[];
  onProgress?: (payload: P) => void;
}

export interface RpcClient<M extends RpcMethods> {
  call<K extends keyof M & string, P = unknown>(
    method: K,
    args: Parameters<M[K]>,
    options?: CallOptions<P>,
  ): Promise<Awaited<ReturnType<M[K]>>>;
  terminate(): void;
}

/** Main-thread side. */
export function createRpcClient<M extends RpcMethods>(worker: Worker): RpcClient<M> {
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      onProgress?: (payload: unknown) => void;
    }
  >();

  worker.addEventListener('message', (event: MessageEvent<ResponseMessage>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;

    if (message.kind === 'progress') {
      entry.onProgress?.(message.payload);
      return;
    }
    pending.delete(message.id);
    if (message.kind === 'result') {
      entry.resolve(message.value);
    } else {
      const error = new Error(message.message);
      if (message.stack) error.stack = message.stack;
      entry.reject(error);
    }
  });

  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Worker failed to start');
    for (const [id, entry] of pending) {
      pending.delete(id);
      entry.reject(error);
    }
  });

  return {
    call(method, args, options) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          ...(options?.onProgress
            ? { onProgress: options.onProgress as (payload: unknown) => void }
            : {}),
        });
        const message: CallMessage = { id, kind: 'call', method, args: args as unknown[] };
        worker.postMessage(message, options?.transfer ?? []);
      });
    },
    terminate() {
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error('Worker terminated'));
      }
      worker.terminate();
    },
  };
}

/** Worker side. Handlers receive a `report` function for streaming progress back. */
export type Handler<A extends unknown[], R> = (
  args: A,
  report: (payload: unknown) => void,
) => R | Promise<R>;

/** The handler map a worker must supply to satisfy the interface its client calls through. */
export type HandlerMap<M extends RpcMethods> = {
  [K in keyof M]: Handler<Parameters<M[K]>, Awaited<ReturnType<M[K]>>>;
};

const TRANSFER_MARKER = '__tabulaTransfer';

interface TransferEnvelope {
  [TRANSFER_MARKER]: true;
  value: unknown;
  transfer: Transferable[];
}

function isTransferEnvelope(value: unknown): value is TransferEnvelope {
  return typeof value === 'object' && value !== null && TRANSFER_MARKER in value;
}

/**
 * Hands buffers to the caller instead of copying them.
 *
 * File reads return whole files; structured-clone would duplicate every byte on the way out.
 * The returned value is unwrapped by the client, so callers see the plain result.
 */
export function transfer<T>(value: T, buffers: Transferable[]): T {
  return { [TRANSFER_MARKER]: true, value, transfer: buffers } as unknown as T;
}

export function exposeRpc<M extends RpcMethods>(handlers: HandlerMap<M>): void {
  const registry = handlers as Record<string, Handler<unknown[], unknown>>;
  const scope = self as unknown as {
    addEventListener: (
      type: 'message',
      listener: (event: MessageEvent<CallMessage>) => void,
    ) => void;
    postMessage: (message: ResponseMessage, transfer?: Transferable[]) => void;
  };

  scope.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.kind !== 'call') return;
    const { id, method, args } = message;

    void (async () => {
      const handler = registry[method];
      if (!handler) {
        scope.postMessage({ id, kind: 'error', message: `Unknown RPC method: ${method}` });
        return;
      }
      try {
        const report = (payload: unknown) => scope.postMessage({ id, kind: 'progress', payload });
        const value = await handler(args, report);
        if (isTransferEnvelope(value)) {
          scope.postMessage({ id, kind: 'result', value: value.value }, value.transfer);
        } else {
          scope.postMessage({ id, kind: 'result', value });
        }
      } catch (error) {
        scope.postMessage({
          id,
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        });
      }
    })();
  });
}

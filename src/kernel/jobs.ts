import { createStore, useStoreSelector } from './store';

/**
 * The job scheduler.
 *
 * Everything slow in this system is a job: indexing a file, loading a model, importing a folder.
 * They compete for the same worker pool, so three properties matter.
 *
 *  - **Priority.** A search the user just typed must not queue behind two thousand background
 *    index jobs. Interactive work jumps the queue.
 *  - **Cancellation.** Closing a window or clearing the sample data has to stop the work it
 *    started, not wait it out.
 *  - **Visibility.** Every job is listed in the Task Manager with progress, because work you
 *    cannot see is work you cannot trust.
 */

export type JobPriority = 0 | 1 | 2;
export const PRIORITY = { interactive: 0, userBatch: 1, background: 2 } as const;

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  label: string;
  kind: string;
  priority: JobPriority;
  status: JobStatus;
  progress: number | null;
  detail?: string;
  error?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
}

export interface JobContext {
  signal: AbortSignal;
  /** 0..1, or null for indeterminate. */
  setProgress: (value: number | null, detail?: string) => void;
  throwIfCancelled: () => void;
}

interface SchedulerState {
  jobs: Job[];
  running: number;
}

const store = createStore<SchedulerState>({ jobs: [], running: 0 });

/**
 * How many jobs may run at once.
 *
 * Two, not "hardware concurrency": the ML runtime already uses up to four threads internally, and
 * the point of a limit here is to leave the main thread enough room to stay at 60 fps.
 */
const MAX_CONCURRENT = 2;

/** Finished jobs are kept briefly so the Task Manager can show what just happened. */
const KEEP_FINISHED = 40;

interface QueueEntry {
  job: Job;
  run: (context: JobContext) => Promise<unknown>;
  controller: AbortController;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const queue: QueueEntry[] = [];
const active = new Map<string, QueueEntry>();
let counter = 0;

function patchJob(id: string, patch: Partial<Job>): void {
  store.set((state) => ({
    ...state,
    jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
  }));
}

function pump(): void {
  while (active.size < MAX_CONCURRENT && queue.length > 0) {
    // Stable priority order: lower number first, then FIFO within a priority.
    queue.sort((a, b) => a.job.priority - b.job.priority || a.job.queuedAt - b.job.queuedAt);
    const entry = queue.shift()!;
    if (entry.controller.signal.aborted) {
      patchJob(entry.job.id, { status: 'cancelled', endedAt: Date.now() });
      entry.reject(new DOMException('Cancelled', 'AbortError'));
      continue;
    }

    active.set(entry.job.id, entry);
    patchJob(entry.job.id, { status: 'running', startedAt: Date.now() });
    store.set((state) => ({ ...state, running: active.size }));

    const context: JobContext = {
      signal: entry.controller.signal,
      setProgress: (value, detail) =>
        patchJob(entry.job.id, {
          progress: value,
          ...(detail !== undefined ? { detail } : {}),
        }),
      throwIfCancelled: () => {
        if (entry.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      },
    };

    void entry
      .run(context)
      .then((value) => {
        patchJob(entry.job.id, { status: 'done', progress: 1, endedAt: Date.now() });
        entry.resolve(value);
      })
      .catch((error: unknown) => {
        const cancelled = error instanceof DOMException && error.name === 'AbortError';
        patchJob(entry.job.id, {
          status: cancelled ? 'cancelled' : 'failed',
          endedAt: Date.now(),
          ...(cancelled ? {} : { error: error instanceof Error ? error.message : String(error) }),
        });
        entry.reject(error);
      })
      .finally(() => {
        active.delete(entry.job.id);
        store.set((state) => {
          const finished = state.jobs.filter(
            (job) => job.status !== 'queued' && job.status !== 'running',
          );
          const excess = Math.max(0, finished.length - KEEP_FINISHED);
          const dropped = new Set(
            finished
              .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
              .slice(0, excess)
              .map((job) => job.id),
          );
          return {
            running: active.size,
            jobs: state.jobs.filter((job) => !dropped.has(job.id)),
          };
        });
        pump();
      });
  }
}

export interface ScheduleOptions {
  label: string;
  kind: string;
  priority?: JobPriority;
}

/** Queues work and resolves with its result. Rejects with an AbortError if cancelled. */
export function schedule<T>(
  options: ScheduleOptions,
  run: (context: JobContext) => Promise<T>,
): { id: string; promise: Promise<T>; cancel: () => void } {
  const id = `job-${++counter}`;
  const job: Job = {
    id,
    label: options.label,
    kind: options.kind,
    priority: options.priority ?? PRIORITY.userBatch,
    status: 'queued',
    progress: null,
    queuedAt: Date.now(),
  };

  const controller = new AbortController();
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res as (value: unknown) => void;
    reject = rej;
  });

  store.set((state) => ({ ...state, jobs: [job, ...state.jobs] }));
  queue.push({
    job,
    run: run as (context: JobContext) => Promise<unknown>,
    controller,
    resolve,
    reject,
  });
  pump();

  return { id, promise, cancel: () => cancelJob(id) };
}

export function cancelJob(id: string): void {
  const running = active.get(id);
  if (running) {
    running.controller.abort();
    return;
  }
  const index = queue.findIndex((entry) => entry.job.id === id);
  if (index >= 0) {
    const [entry] = queue.splice(index, 1);
    entry!.controller.abort();
    patchJob(id, { status: 'cancelled', endedAt: Date.now() });
    entry!.reject(new DOMException('Cancelled', 'AbortError'));
  }
}

/** Cancels every job of a kind — used when clearing data invalidates queued indexing. */
export function cancelKind(kind: string): number {
  const ids = store
    .get()
    .jobs.filter(
      (job) => job.kind === kind && (job.status === 'queued' || job.status === 'running'),
    )
    .map((job) => job.id);
  for (const id of ids) cancelJob(id);
  return ids.length;
}

export function clearFinishedJobs(): void {
  store.set((state) => ({
    ...state,
    jobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running'),
  }));
}

export function useJobs(): Job[] {
  return useStoreSelector(store, (state) => state.jobs);
}

export interface JobSummary {
  active: number;
  queued: number;
  failed: number;
  progress: number | null;
}

export function useJobSummary(): JobSummary {
  const jobs = useJobs();
  const running = jobs.filter((job) => job.status === 'running');
  const queued = jobs.filter((job) => job.status === 'queued');
  const determinate = running.filter((job) => typeof job.progress === 'number');
  return {
    active: running.length,
    queued: queued.length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    progress: determinate.length
      ? determinate.reduce((sum, job) => sum + (job.progress ?? 0), 0) / determinate.length
      : null,
  };
}

/** Test seam: drops all state between cases. */
export function resetScheduler(): void {
  for (const entry of active.values()) entry.controller.abort();
  queue.length = 0;
  active.clear();
  counter = 0;
  store.set({ jobs: [], running: 0 });
}

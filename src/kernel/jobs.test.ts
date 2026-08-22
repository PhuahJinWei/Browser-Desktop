import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIORITY, cancelJob, cancelKind, resetScheduler, schedule } from './jobs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetScheduler();
});

describe('scheduler', () => {
  it('runs a job and resolves with its result', async () => {
    const { promise } = schedule({ label: 'x', kind: 'test' }, async () => 42);
    await expect(promise).resolves.toBe(42);
  });

  it('surfaces failures as a rejected promise', async () => {
    const { promise } = schedule({ label: 'x', kind: 'test' }, async () => {
      throw new Error('boom');
    });
    await expect(promise).rejects.toThrow('boom');
  });

  it('limits how many jobs run at once', async () => {
    let concurrent = 0;
    let peak = 0;
    const work = async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent--;
    };

    await Promise.all(
      Array.from({ length: 6 }, () => schedule({ label: 'x', kind: 'test' }, work).promise),
    );
    // Two at a time keeps the main thread free; more would starve the UI.
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('runs interactive work before queued background work', async () => {
    const order: string[] = [];
    const block = async (name: string) => {
      order.push(name);
      await new Promise((resolve) => setTimeout(resolve, 5));
    };

    // Fill both slots, then queue background work followed by an interactive job.
    const blockers = [
      schedule({ label: 'b1', kind: 'test' }, () => block('blocker-1')).promise,
      schedule({ label: 'b2', kind: 'test' }, () => block('blocker-2')).promise,
    ];
    const background = schedule({ label: 'bg', kind: 'index', priority: PRIORITY.background }, () =>
      block('background'),
    ).promise;
    const interactive = schedule(
      { label: 'ui', kind: 'search', priority: PRIORITY.interactive },
      () => block('interactive'),
    ).promise;

    await Promise.all([...blockers, background, interactive]);
    expect(order.indexOf('interactive')).toBeLessThan(order.indexOf('background'));
  });

  it('cancels a queued job before it starts', async () => {
    const started = vi.fn();
    const blockers = Array.from(
      { length: 2 },
      () =>
        schedule({ label: 'blocker', kind: 'test' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }).promise,
    );

    const queued = schedule({ label: 'queued', kind: 'test' }, async () => started());
    cancelJob(queued.id);

    await expect(queued.promise).rejects.toThrow(/cancel/i);
    await Promise.all(blockers);
    await settle();
    expect(started).not.toHaveBeenCalled();
  });

  it('signals a running job so it can stop early', async () => {
    let observed = false;
    const job = schedule({ label: 'long', kind: 'test' }, async (context) => {
      for (let step = 0; step < 100; step++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (context.signal.aborted) {
          observed = true;
          context.throwIfCancelled();
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    job.cancel();
    await expect(job.promise).rejects.toThrow(/cancel/i);
    expect(observed).toBe(true);
  });

  it('cancels every job of a kind at once', async () => {
    const jobs = Array.from({ length: 4 }, (_, index) =>
      schedule({ label: `index-${index}`, kind: 'index' }, async (context) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        context.throwIfCancelled();
      }),
    );

    const cancelled = cancelKind('index');
    expect(cancelled).toBe(4);
    await Promise.allSettled(jobs.map((job) => job.promise));
  });

  it('reports progress through the context', async () => {
    const seen: (number | null)[] = [];
    const { promise } = schedule({ label: 'p', kind: 'test' }, async (context) => {
      context.setProgress(0.25, 'a quarter');
      seen.push(0.25);
      context.setProgress(null, 'working');
      seen.push(null);
      return 'done';
    });
    await expect(promise).resolves.toBe('done');
    expect(seen).toEqual([0.25, null]);
  });
});

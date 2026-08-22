import type { ImageHit } from './images';

/**
 * Turning frame hits into moments.
 *
 * Searching a video's frames directly gives a bad answer to a good question. Frames two seconds
 * apart in the same shot are nearly identical, so "my red keyboard" matches six of them and the
 * results are six rows of the same thing — while a different video that also shows it never makes
 * the cut.
 *
 * A moment is what the user actually meant: a run of consecutive matching frames, reported once,
 * with a start and an end. That is also what makes "extract that section" possible, because the
 * section has boundaries rather than being a single timestamp.
 */

export interface Moment {
  sourceId: string;
  name: string;
  /** Seconds. */
  start: number;
  end: number;
  /** The single best-matching frame inside the run — the one worth showing. */
  bestTime: number;
  score: number;
  /** How many sampled frames are in the run. Honest about how wide the evidence is. */
  frames: number;
}

export interface GroupOptions {
  /** Frames further apart than this start a new moment. */
  maxGap?: number;
  /** Half-interval padding so a moment covers the shot rather than just the sampled instants. */
  pad?: number;
  /** Longest a single moment may run; a matching frame beyond this splits it. */
  maxLength?: number;
}

/**
 * Groups frame hits into moments.
 *
 * The gap rule is deliberately generous relative to the sampling interval: at a 2-second interval,
 * a 5-second gap tolerates one or two frames in the middle of a shot that the model liked less —
 * a hand passing in front of the object should not cut the moment in half.
 */
export function groupMoments(hits: ImageHit[], options: GroupOptions = {}): Moment[] {
  const maxGap = options.maxGap ?? 5;
  const pad = options.pad ?? 1;
  const maxLength = options.maxLength ?? 30;

  const bySource = new Map<string, ImageHit[]>();
  for (const hit of hits) {
    if (hit.time === undefined || !hit.sourceId) continue;
    const list = bySource.get(hit.sourceId);
    if (list) list.push(hit);
    else bySource.set(hit.sourceId, [hit]);
  }

  const moments: Moment[] = [];

  for (const [sourceId, list] of bySource) {
    list.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

    let run: ImageHit[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const best = run.reduce((a, b) => (b.score > a.score ? b : a));
      moments.push({
        sourceId,
        name: first.name,
        start: Math.max(0, (first.time ?? 0) - pad),
        end: (last.time ?? 0) + pad,
        bestTime: best.time ?? 0,
        score: best.score,
        frames: run.length,
      });
      run = [];
    };

    for (const hit of list) {
      const previous = run[run.length - 1];
      const gap = previous ? (hit.time ?? 0) - (previous.time ?? 0) : 0;
      const length = run.length > 0 ? (hit.time ?? 0) - (run[0]!.time ?? 0) : 0;
      if (previous && (gap > maxGap || length > maxLength)) flush();
      run.push(hit);
    }
    flush();
  }

  // Best moment first, then earliest — so re-running the same search cannot reorder ties.
  return moments.sort((a, b) => b.score - a.score || a.start - b.start);
}

/** `1:04` / `1:02:03`, for labelling a moment. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** The id a frame is indexed under. One place, so the parser below cannot drift from it. */
export function momentId(sourceId: string, time: number): string {
  return `${sourceId}@${time.toFixed(2)}`;
}

export function parseMomentId(id: string): { sourceId: string; time: number } | null {
  const at = id.lastIndexOf('@');
  if (at < 1) return null;
  const time = Number(id.slice(at + 1));
  return Number.isFinite(time) ? { sourceId: id.slice(0, at), time } : null;
}

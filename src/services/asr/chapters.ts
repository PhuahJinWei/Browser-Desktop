import { tokenize } from '../index/bm25';

/**
 * Chapter detection over a transcript.
 *
 * Uses lexical cohesion — the TextTiling idea: compare the vocabulary of adjacent windows and cut
 * where the overlap dips. Where a speaker changes subject, the words change with it, and the dip
 * is visible without any model at all.
 *
 * That last part is the reason for choosing it: chaptering a recording should not require loading
 * a second neural network next to the one that just did the transcription. Embedding-based
 * segmentation would likely be a little better and is noted as a later upgrade; this is honest,
 * offline, and costs microseconds.
 */

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Chapter {
  start: number;
  end: number;
  title: string;
  segmentIndex: number;
}

/** Cosine similarity over token-count vectors for two windows of text. */
function similarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [term, count] of a) {
    normA += count * count;
    const other = b.get(term);
    if (other) dot += count * other;
  }
  for (const count of b.values()) normB += count * count;
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

function counts(segments: TranscriptSegment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const segment of segments) {
    for (const token of tokenize(segment.text)) map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

/**
 * The terms that distinguish a stretch of transcript from the recording as a whole.
 *
 * A plain frequency count would title every chapter with the recording's main subject, since that
 * is what is said most often everywhere. Comparing local frequency against global frequency finds
 * what is unusual *here*, which is what a title should say.
 */
function keyphrase(
  segments: TranscriptSegment[],
  globalCounts: Map<string, number>,
  totalTokens: number,
): string {
  const local = counts(segments);
  let localTotal = 0;
  for (const count of local.values()) localTotal += count;
  if (localTotal === 0) return 'Untitled section';

  const scored = [...local.entries()]
    .filter(([term]) => term.length > 3)
    .map(([term, count]) => {
      const localRate = count / localTotal;
      const globalRate = (globalCounts.get(term) ?? 1) / Math.max(1, totalTokens);
      return { term, score: localRate * Math.log(localRate / globalRate + 1) * Math.sqrt(count) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.term);

  if (scored.length === 0) return 'Untitled section';
  return scored.map((term) => term[0]!.toUpperCase() + term.slice(1)).join(', ');
}

export interface ChapterOptions {
  /** Segments per comparison window. Larger is smoother and less sensitive. */
  windowSize?: number;
  /** Never cut more often than this, so a chapter list stays useful. */
  minChapterSeconds?: number;
  maxChapters?: number;
}

export function detectChapters(
  segments: TranscriptSegment[],
  options: ChapterOptions = {},
): Chapter[] {
  const windowSize = options.windowSize ?? 3;
  const minChapterSeconds = options.minChapterSeconds ?? 45;
  const maxChapters = options.maxChapters ?? 12;

  if (segments.length === 0) return [];

  const globalCounts = counts(segments);
  let totalTokens = 0;
  for (const count of globalCounts.values()) totalTokens += count;

  // Too short to divide meaningfully: one chapter is the honest answer.
  const duration = (segments.at(-1)?.end ?? 0) - (segments[0]?.start ?? 0);
  if (segments.length < windowSize * 2 || duration < minChapterSeconds * 2) {
    return [
      {
        start: segments[0]?.start ?? 0,
        end: segments.at(-1)?.end ?? 0,
        title: keyphrase(segments, globalCounts, totalTokens),
        segmentIndex: 0,
      },
    ];
  }

  // Cohesion at each possible boundary: how similar the window before is to the window after.
  const scores: { index: number; dip: number }[] = [];
  for (let i = windowSize; i <= segments.length - windowSize; i++) {
    const before = counts(segments.slice(i - windowSize, i));
    const after = counts(segments.slice(i, i + windowSize));
    scores.push({ index: i, dip: 1 - similarity(before, after) });
  }

  const mean = scores.reduce((sum, entry) => sum + entry.dip, 0) / scores.length;
  const variance = scores.reduce((sum, entry) => sum + (entry.dip - mean) ** 2, 0) / scores.length;
  const threshold = mean + Math.sqrt(variance) * 0.5;

  const boundaries: number[] = [0];
  for (const entry of scores.sort((a, b) => b.dip - a.dip)) {
    if (entry.dip < threshold) break;
    if (boundaries.length >= maxChapters) break;
    const time = segments[entry.index]?.start ?? 0;
    // Reject a cut that would sit too close to one already accepted.
    if (
      boundaries.some((index) => Math.abs((segments[index]?.start ?? 0) - time) < minChapterSeconds)
    ) {
      continue;
    }
    boundaries.push(entry.index);
  }
  boundaries.sort((a, b) => a - b);

  return boundaries.map((startIndex, position) => {
    const endIndex = position + 1 < boundaries.length ? boundaries[position + 1]! : segments.length;
    const slice = segments.slice(startIndex, endIndex);
    return {
      start: slice[0]?.start ?? 0,
      end: slice.at(-1)?.end ?? 0,
      title: keyphrase(slice, globalCounts, totalTokens),
      segmentIndex: startIndex,
    };
  });
}

/** SubRip export, so a transcript can leave the app in a format other tools already read. */
export function toSrt(
  segments: TranscriptSegment[],
  formatTime: (seconds: number) => string,
): string {
  return segments
    .map(
      (segment, index) =>
        `${index + 1}\n${formatTime(segment.start)} --> ${formatTime(segment.end)}\n${segment.text.trim()}\n`,
    )
    .join('\n');
}

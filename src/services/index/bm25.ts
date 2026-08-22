/**
 * BM25 keyword ranking.
 *
 * Semantic search alone fails on exactly the queries people trust least when it does: a part
 * number, a surname, "Samsung". Embeddings put those near everything else in the same topic;
 * BM25 puts the document that literally contains the word first. Running both and fusing the
 * rankings (see the indexer) is what makes the result feel correct rather than merely plausible.
 *
 * Hand-written rather than a search library: it is ~120 lines, and the alternative ships a
 * general-purpose engine to do one job (ADR 7).
 */

export interface Bm25Options {
  /** Term-frequency saturation. 1.2 is the standard starting point. */
  k1?: number;
  /** Length normalisation, 0..1. 0.75 is standard. */
  b?: number;
}

export interface Bm25Hit {
  id: string;
  score: number;
  /** Which query terms actually matched, for highlighting. */
  terms: string[];
}

/**
 * Very common English words carry no discriminating signal, and letting them match makes every
 * document a weak hit for every query.
 */
const STOP_WORDS = new Set(
  'a an and are as at be but by for if in into is it no not of on or such that the their then there these they this to was will with from your you we our i'.split(
    ' ',
  ),
);

/**
 * Lowercase, split on non-alphanumerics, keep digits (part numbers and dates matter), drop stop
 * words and single characters.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2) continue;
    if (STOP_WORDS.has(raw)) continue;
    tokens.push(raw);
  }
  return tokens;
}

interface Posting {
  id: string;
  frequency: number;
}

export class Bm25Index {
  private postings = new Map<string, Posting[]>();
  private lengths = new Map<string, number>();
  private totalLength = 0;
  private readonly k1: number;
  private readonly b: number;

  constructor(options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
  }

  get size(): number {
    return this.lengths.size;
  }

  get terms(): number {
    return this.postings.size;
  }

  add(id: string, tokens: string[]): void {
    this.remove(id);

    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

    for (const [term, frequency] of counts) {
      const list = this.postings.get(term);
      if (list) list.push({ id, frequency });
      else this.postings.set(term, [{ id, frequency }]);
    }

    this.lengths.set(id, tokens.length);
    this.totalLength += tokens.length;
  }

  remove(id: string): void {
    const length = this.lengths.get(id);
    if (length === undefined) return;

    this.lengths.delete(id);
    this.totalLength -= length;

    for (const [term, list] of this.postings) {
      const index = list.findIndex((posting) => posting.id === id);
      if (index === -1) continue;
      list.splice(index, 1);
      if (list.length === 0) this.postings.delete(term);
    }
  }

  clear(): void {
    this.postings.clear();
    this.lengths.clear();
    this.totalLength = 0;
  }

  search(query: string, limit = 50): Bm25Hit[] {
    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0 || this.lengths.size === 0) return [];

    const documentCount = this.lengths.size;
    const averageLength = this.totalLength / documentCount;
    const scores = new Map<string, { score: number; terms: Set<string> }>();

    for (const term of queryTerms) {
      const list = this.postings.get(term);
      if (!list || list.length === 0) continue;

      // Probabilistic IDF, floored at zero: a term in nearly every document should not push
      // scores negative, it should simply stop contributing.
      const idf = Math.max(
        0,
        Math.log(1 + (documentCount - list.length + 0.5) / (list.length + 0.5)),
      );
      if (idf === 0) continue;

      for (const posting of list) {
        const length = this.lengths.get(posting.id) ?? averageLength;
        const numerator = posting.frequency * (this.k1 + 1);
        const denominator =
          posting.frequency + this.k1 * (1 - this.b + (this.b * length) / averageLength);
        const contribution = idf * (numerator / denominator);

        const entry = scores.get(posting.id);
        if (entry) {
          entry.score += contribution;
          entry.terms.add(term);
        } else {
          scores.set(posting.id, { score: contribution, terms: new Set([term]) });
        }
      }
    }

    return [...scores.entries()]
      .map(([id, entry]) => ({ id, score: entry.score, terms: [...entry.terms] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/**
 * Reciprocal rank fusion.
 *
 * Combines rankings by position rather than by score, which is the point: a cosine similarity and
 * a BM25 score are not on the same scale and normalising them invents a comparison that does not
 * exist. Ranks are comparable. k=60 is the value from the original paper.
 */
export function fuseRankings(
  rankings: { id: string; score: number }[][],
  weights: number[] = [],
  k = 60,
): { id: string; score: number }[] {
  const fused = new Map<string, number>();

  rankings.forEach((ranking, listIndex) => {
    const weight = weights[listIndex] ?? 1;
    ranking.forEach((entry, rank) => {
      fused.set(entry.id, (fused.get(entry.id) ?? 0) + weight / (k + rank + 1));
    });
  });

  return [...fused.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

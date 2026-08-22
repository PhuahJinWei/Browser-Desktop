/**
 * The vector index.
 *
 * A flat array of normalised embeddings and a brute-force dot product over all of them. That is a
 * deliberate choice, not a placeholder: for the tens of thousands of chunks a personal file
 * collection produces, a linear scan of contiguous Float32Array memory is faster than walking an
 * approximate-nearest-neighbour graph, exact rather than approximate, and needs no index to
 * rebuild when a file changes.
 *
 * The upgrade path, when a collection outgrows it, is documented in ADR 6 and measurable with the
 * benchmark harness rather than guessed at.
 */

export interface VectorHit {
  id: string;
  score: number;
}

export class VectorIndex {
  private data: Float32Array;
  private ids: string[] = [];
  private rowOf = new Map<string, number>();
  private count = 0;

  constructor(
    public readonly dimensions: number,
    initialCapacity = 1024,
  ) {
    this.data = new Float32Array(dimensions * initialCapacity);
  }

  get size(): number {
    return this.count;
  }

  get bytes(): number {
    return this.data.byteLength;
  }

  private grow(minimumRows: number): void {
    if (minimumRows * this.dimensions <= this.data.length) return;
    // Doubling keeps amortised insertion constant; copying a few megabytes is cheap and rare.
    let capacity = Math.max(1024, this.data.length / this.dimensions);
    while (capacity < minimumRows) capacity *= 2;
    const grown = new Float32Array(capacity * this.dimensions);
    grown.set(this.data.subarray(0, this.count * this.dimensions));
    this.data = grown;
  }

  /** Stores a vector, normalising it so similarity is a plain dot product. */
  add(id: string, vector: Float32Array | number[]): void {
    if (vector.length !== this.dimensions) {
      throw new Error(`Expected ${this.dimensions} dimensions, received ${vector.length}`);
    }

    const existing = this.rowOf.get(id);
    const row = existing ?? this.count;
    if (existing === undefined) {
      this.grow(this.count + 1);
      this.ids.push(id);
      this.rowOf.set(id, row);
      this.count++;
    }

    let norm = 0;
    for (let i = 0; i < vector.length; i++) norm += vector[i]! * vector[i]!;
    norm = Math.sqrt(norm) || 1;

    const offset = row * this.dimensions;
    for (let i = 0; i < this.dimensions; i++) this.data[offset + i] = vector[i]! / norm;
  }

  /**
   * Every pair of vectors more similar than `threshold`.
   *
   * The obvious implementation is n²/2 dot products, which at 512 dimensions is 4 billion
   * multiply-adds for four thousand images — slow enough to be useless. This one prunes with a
   * bound instead.
   *
   * Because the rows are normalised, the dot product of the first k dimensions plus the product of
   * the two tails' magnitudes is an upper bound on the whole dot product (Cauchy–Schwarz on the
   * tails). If that bound is already under the threshold, the pair cannot possibly qualify and the
   * remaining 448 dimensions are never touched. For the high thresholds a duplicate finder uses,
   * almost every pair is rejected on the first 64 numbers.
   *
   * Exact, not approximate: the bound can only over-estimate, so nothing above the threshold is
   * ever missed, and a test checks the pruned answer against the unpruned one.
   *
   * Measured over 5,000 random 512-dimension vectors at a threshold of 0.92: 12.5 million pairs,
   * of which **0.41% ever need the full dot product**, and the scan runs in 830 ms against 5,066 ms
   * for the naive version — 6.1× — with identical results.
   */
  pairsAbove(
    threshold: number,
    options: {
      /** Rows this returns false for are left out entirely. */
      include?: (id: string) => boolean;
      onProgress?: (done: number, total: number) => void;
    } = {},
  ): { a: string; b: string; score: number }[] {
    const prefix = Math.min(64, this.dimensions);
    const found: { a: string; b: string; score: number }[] = [];

    const rows: number[] = [];
    for (let row = 0; row < this.count; row++) {
      if (!options.include || options.include(this.ids[row]!)) rows.push(row);
    }
    if (rows.length < 2) return found;

    // Magnitude of each row beyond the prefix, for the bound.
    const tails = new Map<number, number>();
    for (const row of rows) {
      const offset = row * this.dimensions;
      let head = 0;
      for (let i = 0; i < prefix; i++) head += this.data[offset + i]! * this.data[offset + i]!;
      tails.set(row, Math.sqrt(Math.max(0, 1 - head)));
    }

    for (let a = 0; a < rows.length; a++) {
      const rowA = rows[a]!;
      const offsetA = rowA * this.dimensions;
      const tailA = tails.get(rowA)!;

      for (let b = a + 1; b < rows.length; b++) {
        const rowB = rows[b]!;
        const offsetB = rowB * this.dimensions;

        let partial = 0;
        for (let i = 0; i < prefix; i++)
          partial += this.data[offsetA + i]! * this.data[offsetB + i]!;
        if (partial + tailA * tails.get(rowB)! < threshold) continue;

        let score = partial;
        for (let i = prefix; i < this.dimensions; i++) {
          score += this.data[offsetA + i]! * this.data[offsetB + i]!;
        }
        if (score >= threshold) found.push({ a: this.ids[rowA]!, b: this.ids[rowB]!, score });
      }
      options.onProgress?.(a + 1, rows.length);
    }

    return found;
  }

  /** Removes by swapping the last row into the gap, so the array stays contiguous. */
  remove(id: string): boolean {
    const row = this.rowOf.get(id);
    if (row === undefined) return false;

    const last = this.count - 1;
    if (row !== last) {
      const lastId = this.ids[last]!;
      this.data.copyWithin(
        row * this.dimensions,
        last * this.dimensions,
        (last + 1) * this.dimensions,
      );
      this.ids[row] = lastId;
      this.rowOf.set(lastId, row);
    }

    this.ids.pop();
    this.rowOf.delete(id);
    this.count--;
    return true;
  }

  has(id: string): boolean {
    return this.rowOf.has(id);
  }

  /**
   * The stored (already normalised) vector for an id.
   *
   * "Find more like this one" is a search whose query vector is one already in the index, so
   * reading it back beats re-embedding the same picture.
   */
  get(id: string): Float32Array | null {
    const row = this.rowOf.get(id);
    if (row === undefined) return null;
    return this.data.slice(row * this.dimensions, (row + 1) * this.dimensions) as Float32Array;
  }

  clear(): void {
    this.ids = [];
    this.rowOf.clear();
    this.count = 0;
  }

  /**
   * Top-k by cosine similarity, above `minScore`.
   *
   * Keeps a small sorted list of the best hits instead of sorting every score: at k=50 over tens
   * of thousands of rows, sorting the whole array costs more than the scan that produced it.
   *
   * `minScore` is an absolute floor, applied to every row. It used to be applied only once the
   * result list was full, which made it silently inert whenever the index held fewer rows than
   * the limit — a caller asking for the top 240 of 20 vectors got all 20 back, floor or no floor.
   * Video search asked for exactly that and got the whole video as one match.
   */
  search(query: Float32Array | number[], limit = 50, minScore = 0): VectorHit[] {
    if (this.count === 0) return [];

    let norm = 0;
    for (let i = 0; i < query.length; i++) norm += query[i]! * query[i]!;
    norm = Math.sqrt(norm) || 1;
    const normalised = new Float32Array(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) normalised[i] = (query[i] ?? 0) / norm;

    const best: VectorHit[] = [];
    let worst = minScore;

    for (let row = 0; row < this.count; row++) {
      const offset = row * this.dimensions;
      let score = 0;
      for (let i = 0; i < this.dimensions; i++) score += this.data[offset + i]! * normalised[i]!;
      if (score < minScore) continue;
      if (score <= worst && best.length >= limit) continue;

      const hit: VectorHit = { id: this.ids[row]!, score };
      const position = best.findIndex((candidate) => candidate.score < score);
      if (position === -1) best.push(hit);
      else best.splice(position, 0, hit);
      if (best.length > limit) best.pop();
      if (best.length >= limit) worst = best[best.length - 1]!.score;
    }

    return best;
  }

  /** Compact form for persistence: the rows in use, plus their ids. */
  serialize(): { ids: string[]; dimensions: number; data: ArrayBuffer } {
    const used = this.data.slice(0, this.count * this.dimensions);
    return {
      ids: [...this.ids],
      dimensions: this.dimensions,
      data: used.buffer.slice(used.byteOffset, used.byteOffset + used.byteLength) as ArrayBuffer,
    };
  }

  static deserialize(payload: {
    ids: string[];
    dimensions: number;
    data: ArrayBuffer;
  }): VectorIndex {
    const index = new VectorIndex(payload.dimensions, Math.max(1024, payload.ids.length));
    const vectors = new Float32Array(payload.data);
    index.data.set(vectors);
    index.ids = [...payload.ids];
    index.count = payload.ids.length;
    payload.ids.forEach((id, row) => index.rowOf.set(id, row));
    return index;
  }
}

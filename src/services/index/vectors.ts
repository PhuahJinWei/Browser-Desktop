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

  clear(): void {
    this.ids = [];
    this.rowOf.clear();
    this.count = 0;
  }

  /**
   * Top-k by cosine similarity.
   *
   * Keeps a small sorted list of the best hits instead of sorting every score: at k=50 over tens
   * of thousands of rows, sorting the whole array costs more than the scan that produced it.
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

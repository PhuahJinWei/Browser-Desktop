import { VectorIndex } from './vectors';

/**
 * The image index.
 *
 * Separate from the document index on purpose: these vectors come from a different model and live
 * in a different space. Keeping them apart makes it impossible to compare a CLIP image vector with
 * a MiniLM sentence vector by accident, which would return confident nonsense rather than an
 * error.
 */

export interface ImageRecord {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  indexedAt: number;
}

export interface ImageHit {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  score: number;
}

let vectors = new VectorIndex(512);
const records = new Map<string, ImageRecord>();

export function imageCount(): number {
  return records.size;
}

export function imageBytes(): number {
  return vectors.bytes;
}

export function imageDimensions(): number {
  return vectors.dimensions;
}

export function hasImage(id: string): boolean {
  return records.has(id);
}

export function getImage(id: string): ImageRecord | undefined {
  return records.get(id);
}

export function allImages(): ImageRecord[] {
  return [...records.values()].sort((a, b) => b.indexedAt - a.indexedAt);
}

export function addImage(record: ImageRecord, vector: Float32Array): void {
  // A model change alters the dimensionality; rebuild rather than mixing widths in one array.
  if (vector.length !== vectors.dimensions) {
    vectors = new VectorIndex(vector.length);
    records.clear();
  }
  vectors.add(record.id, vector);
  records.set(record.id, record);
}

export function removeImage(id: string): boolean {
  if (!records.has(id)) return false;
  vectors.remove(id);
  records.delete(id);
  return true;
}

export function clearImages(): void {
  vectors.clear();
  records.clear();
}

/** Nearest images to a vector, optionally excluding one (so "similar to this" omits itself). */
export function searchImages(
  vector: Float32Array,
  limit = 40,
  exclude?: string,
  minScore = 0.05,
): ImageHit[] {
  return vectors
    .search(vector, exclude ? limit + 1 : limit, minScore)
    .filter((hit) => hit.id !== exclude)
    .slice(0, limit)
    .flatMap((hit) => {
      const record = records.get(hit.id);
      return record
        ? [
            {
              id: record.id,
              name: record.name,
              mime: record.mime,
              width: record.width,
              height: record.height,
              score: hit.score,
            },
          ]
        : [];
    });
}

/** Images nearest to one already indexed — "more like this", using its own stored vector. */
export function similarTo(id: string, limit = 24): ImageHit[] {
  const vector = vectors.get(id);
  if (!vector) return [];
  return searchImages(vector, limit, id);
}

export interface ImageSnapshot {
  records: ImageRecord[];
  ids: string[];
  dimensions: number;
  data: ArrayBuffer;
}

export function serializeImages(): ImageSnapshot {
  const serialized = vectors.serialize();
  return {
    records: [...records.values()],
    ids: serialized.ids,
    dimensions: serialized.dimensions,
    data: serialized.data,
  };
}

export function restoreImages(snapshot: ImageSnapshot): void {
  records.clear();
  for (const record of snapshot.records) records.set(record.id, record);
  vectors = VectorIndex.deserialize({
    ids: snapshot.ids,
    dimensions: snapshot.dimensions,
    data: snapshot.data,
  });
}

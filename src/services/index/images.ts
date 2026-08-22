import { VectorIndex } from './vectors';
import { groupDuplicates, type DuplicateGroup } from './duplicates';

/**
 * The image index.
 *
 * Separate from the document index on purpose: these vectors come from a different model and live
 * in a different space. Keeping them apart makes it impossible to compare a CLIP image vector with
 * a MiniLM sentence vector by accident, which would return confident nonsense rather than an
 * error.
 *
 * Video moments live here too. A sampled frame is an image as far as CLIP is concerned, so giving
 * moments their own index would have duplicated the search, the persistence and the lifecycle to
 * express a distinction the model does not make. A moment simply carries the time it was taken
 * from and the id of the video it belongs to.
 */

export interface ImageRecord {
  /** A picture's file id, or `${fileId}@${seconds}` for a video moment. */
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  indexedAt: number;
  /** Seconds into the video this frame came from. Absent for ordinary pictures. */
  time?: number;
  /** The video's file id, when this is a moment. */
  sourceId?: string;
}

export interface ImageHit {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  score: number;
  time?: number;
  sourceId?: string;
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

/** Just the still pictures — what Photos shows. */
export function stillImages(): ImageRecord[] {
  return allImages().filter((record) => record.time === undefined);
}

/** Every sampled moment of one video, in order. */
export function momentsOf(sourceId: string): ImageRecord[] {
  return [...records.values()]
    .filter((record) => record.sourceId === sourceId)
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

/** Removes every moment belonging to a video — used when it is re-indexed or deleted. */
export function removeMomentsOf(sourceId: string): number {
  const doomed = [...records.values()].filter((record) => record.sourceId === sourceId);
  for (const record of doomed) removeImage(record.id);
  return doomed.length;
}

/** How many videos have moments indexed. */
export function indexedVideoIds(): string[] {
  return [
    ...new Set(
      [...records.values()].flatMap((record) => (record.sourceId ? [record.sourceId] : [])),
    ),
  ];
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
              ...(record.time !== undefined ? { time: record.time } : {}),
              ...(record.sourceId ? { sourceId: record.sourceId } : {}),
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

/**
 * Pictures that are the same picture.
 *
 * Video moments are excluded rather than filtered afterwards: frames two seconds apart in one shot
 * are near-duplicates by any measure, so including them would bury the real answer under every
 * video in the library and pay for the comparisons as well.
 */
export function findDuplicates(
  threshold: number,
  onProgress?: (done: number, total: number) => void,
): DuplicateGroup[] {
  const pairs = vectors.pairsAbove(threshold, {
    include: (id) => records.get(id)?.time === undefined,
    ...(onProgress ? { onProgress } : {}),
  });
  // Biggest first, so the first member of each group is the one the UI offers to keep. Size is a
  // rough proxy for "least damaged": the original rather than the re-save, the whole picture
  // rather than the crop. Newest-first was tried and picks the crop, which is backwards — a
  // duplicate is usually made *from* the one worth keeping.
  return groupDuplicates(
    pairs,
    [...records.values()]
      .filter((record) => record.time === undefined)
      .sort((a, b) => b.bytes - a.bytes)
      .map((record) => record.id),
  );
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

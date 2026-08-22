import { idb, openDatabase, transact } from '../../kernel/idb';

/**
 * Thumbnail store.
 *
 * A photo grid that renders full-size originals is the classic way to make a file manager stutter:
 * decoding a dozen 4000-pixel JPEGs to draw them at 160 pixels wastes both memory and time. The
 * index worker already decodes each image to embed it, so it emits a WebP thumbnail at the same
 * time and that is what the grid draws.
 *
 * Kept out of the index snapshot deliberately — binary blobs would bloat a record that is
 * rewritten every time indexing settles.
 */

const DB_NAME = 'tabula-thumbnails';
const DB_VERSION = 1;
const STORE = 'thumbnails';

interface ThumbnailRecord {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

let database: IDBDatabase | null = null;

async function db(): Promise<IDBDatabase> {
  database ??= await openDatabase(DB_NAME, DB_VERSION, [{ name: STORE, keyPath: 'id' }]);
  return database;
}

export async function putThumbnail(
  id: string,
  data: ArrayBuffer,
  width: number,
  height: number,
): Promise<void> {
  // A replaced thumbnail must not keep its old object URL. Overwriting a picture — re-exporting a
  // frame over an earlier one, say — re-indexes it and writes a new thumbnail here, and without
  // this the grid went on showing the previous image for the rest of the session.
  releaseThumbnailUrl(id);
  const handle = await db();
  await transact(handle, STORE, 'readwrite', (tx) =>
    idb.put(tx.objectStore(STORE), {
      id,
      blob: new Blob([data], { type: 'image/webp' }),
      width,
      height,
      createdAt: Date.now(),
    } satisfies ThumbnailRecord),
  );
}

export async function getThumbnail(id: string): Promise<Blob | null> {
  const handle = await db();
  const record = await transact(handle, STORE, 'readonly', (tx) =>
    idb.get<ThumbnailRecord>(tx.objectStore(STORE), id),
  );
  return record?.blob ?? null;
}

export async function deleteThumbnail(id: string): Promise<void> {
  releaseThumbnailUrl(id);
  const handle = await db();
  await transact(handle, STORE, 'readwrite', (tx) => idb.delete(tx.objectStore(STORE), id));
}

export async function clearThumbnails(): Promise<void> {
  const handle = await db();
  await transact(handle, STORE, 'readwrite', (tx) => idb.clear(tx.objectStore(STORE)));
}

/**
 * A small LRU of object URLs.
 *
 * Every `createObjectURL` holds its blob in memory until revoked, so a grid that creates one per
 * cell and never revokes will happily leak an entire photo library. This caps how many are alive
 * and revokes the oldest.
 */
const MAX_URLS = 300;
const urls = new Map<string, string>();

export async function thumbnailUrl(id: string): Promise<string | null> {
  const existing = urls.get(id);
  if (existing) {
    // Refresh recency.
    urls.delete(id);
    urls.set(id, existing);
    return existing;
  }

  const blob = await getThumbnail(id);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  urls.set(id, url);

  while (urls.size > MAX_URLS) {
    const oldest = urls.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const stale = urls.get(oldest);
    urls.delete(oldest);
    if (stale) URL.revokeObjectURL(stale);
  }
  return url;
}

/** Forgets one pooled URL, so the next request re-reads the stored blob. */
export function releaseThumbnailUrl(id: string): void {
  const url = urls.get(id);
  if (!url) return;
  urls.delete(id);
  URL.revokeObjectURL(url);
}

export function releaseThumbnailUrls(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

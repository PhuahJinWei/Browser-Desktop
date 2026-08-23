import { idb, openDatabase, transact, type StoreSchema } from '../idb';
import {
  DIRECTORY_MIME,
  ROOT_ID,
  guessMime,
  isValidName,
  sanitizeName,
  uniqueName,
  type FileContent,
  type ImportEntry,
  type ImportResult,
  type IndexState,
  type NodeId,
  type VfsNode,
  type VfsStats,
} from './types';

/**
 * The file system itself. Runs inside the file-I/O worker.
 *
 * Metadata lives in IndexedDB (a tree of nodes); bytes live in OPFS under their SHA-256, sharded
 * two characters deep so no single directory accumulates thousands of entries. Blobs are
 * reference-counted: deleting the last node that points at a hash removes the file.
 *
 * Everything here runs off the main thread, which is why it can use synchronous access handles —
 * measured at ~591 MB/s write, ~781 MB/s read (docs/benchmarks/).
 */

const DB_NAME = 'tabula-vfs';
const DB_VERSION = 1;

const SCHEMA: StoreSchema[] = [
  {
    name: 'nodes',
    keyPath: 'id',
    indexes: [
      { name: 'by_parent', keyPath: 'parentId' },
      { name: 'by_hash', keyPath: 'hash' },
      { name: 'by_index_state', keyPath: 'indexState' },
    ],
  },
];

/** Files above this are rejected rather than hashed: `crypto.subtle` needs the whole buffer. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

let database: IDBDatabase | null = null;
let blobRoot: FileSystemDirectoryHandle | null = null;

function newId(): string {
  return crypto.randomUUID();
}

async function db(): Promise<IDBDatabase> {
  database ??= await openDatabase(DB_NAME, DB_VERSION, SCHEMA);
  return database;
}

async function blobs(): Promise<FileSystemDirectoryHandle> {
  if (!blobRoot) {
    const root = await navigator.storage.getDirectory();
    blobRoot = await root.getDirectoryHandle('blobs', { create: true });
  }
  return blobRoot;
}

async function blobFile(hash: string, create: boolean): Promise<FileSystemFileHandle> {
  const shard = await (await blobs()).getDirectoryHandle(hash.slice(0, 2), { create });
  return shard.getFileHandle(hash, { create });
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* -------------------------------------------------------------------------------------------- */
/* Reads                                                                                          */
/* -------------------------------------------------------------------------------------------- */

export async function ensureRoot(): Promise<VfsNode> {
  const handle = await db();
  return transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const existing = await idb.get<VfsNode>(store, ROOT_ID);
    if (existing) return existing;

    const now = Date.now();
    const root: VfsNode = {
      id: ROOT_ID,
      parentId: null,
      name: 'Home',
      kind: 'directory',
      mime: DIRECTORY_MIME,
      size: 0,
      createdAt: now,
      modifiedAt: now,
      trashed: false,
    };
    await idb.put(store, root);
    return root;
  });
}

export async function list(parentId: NodeId, includeTrashed = false): Promise<VfsNode[]> {
  const handle = await db();
  const nodes = await transact(handle, 'nodes', 'readonly', (tx) =>
    idb.getAll<VfsNode>(tx.objectStore('nodes').index('by_parent'), parentId),
  );
  return nodes
    .filter((node) => includeTrashed || !node.trashed)
    .sort(
      (a, b) =>
        Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
}

export async function listTrash(): Promise<VfsNode[]> {
  const handle = await db();
  const all = await transact(handle, 'nodes', 'readonly', (tx) =>
    idb.getAll<VfsNode>(tx.objectStore('nodes')),
  );
  // Only the top of each trashed subtree: its children are trashed too but restoring the parent
  // brings them along, so listing them separately would be noise.
  const trashed = all.filter((node) => node.trashed);
  const ids = new Set(trashed.map((node) => node.id));
  return trashed
    .filter((node) => node.trashedFrom !== undefined || !ids.has(node.parentId ?? ''))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function stat(id: NodeId): Promise<VfsNode | undefined> {
  const handle = await db();
  return transact(handle, 'nodes', 'readonly', (tx) =>
    idb.get<VfsNode>(tx.objectStore('nodes'), id),
  );
}

export async function statMany(ids: NodeId[]): Promise<VfsNode[]> {
  const handle = await db();
  return transact(handle, 'nodes', 'readonly', async (tx) => {
    const store = tx.objectStore('nodes');
    const found: VfsNode[] = [];
    for (const id of ids) {
      const node = await idb.get<VfsNode>(store, id);
      if (node) found.push(node);
    }
    return found;
  });
}

/** Ancestors from root down to and including `id`, for breadcrumbs. */
export async function pathOf(id: NodeId): Promise<VfsNode[]> {
  const handle = await db();
  return transact(handle, 'nodes', 'readonly', async (tx) => {
    const store = tx.objectStore('nodes');
    const chain: VfsNode[] = [];
    let current = await idb.get<VfsNode>(store, id);
    // The depth guard is cheap insurance: a cycle here would hang the UI thread that awaits it.
    while (current && chain.length < 128) {
      chain.unshift(current);
      if (!current.parentId) break;
      current = await idb.get<VfsNode>(store, current.parentId);
    }
    return chain;
  });
}

export async function allNodes(): Promise<VfsNode[]> {
  const handle = await db();
  return transact(handle, 'nodes', 'readonly', (tx) =>
    idb.getAll<VfsNode>(tx.objectStore('nodes')),
  );
}

/**
 * Reads a file's bytes.
 *
 * The missing-blob case gets its own message rather than the platform's. Metadata lives in
 * IndexedDB and content lives in OPFS, and the two are not transactional with each other, so it is
 * possible — through an interrupted write, an eviction, or a bug — to hold a record whose bytes
 * are gone. That surfaced during M4 as a bare "A requested file or directory could not be found"
 * rejected into the console with nothing naming the file or saying what to do.
 */
export async function read(id: NodeId): Promise<FileContent> {
  const node = await stat(id);
  if (!node) throw new Error(`No such file: ${id}`);
  if (node.kind === 'directory') throw new Error(`${node.name} is a directory`);
  if (!node.hash) throw new Error(`${node.name} has no content`);

  try {
    const file = await (await blobFile(node.hash, false)).getFile();
    return { node, data: await file.arrayBuffer() };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      throw new MissingContentError(node.name, id);
    }
    throw error;
  }
}

/** A file whose record survives but whose stored bytes do not. */
export class MissingContentError extends Error {
  readonly nodeId: NodeId;
  constructor(name: string, nodeId: NodeId) {
    super(
      `The contents of ${name} are missing from storage. The file entry is still here, but its bytes are not — deleting it and adding it again is the only repair.`,
    );
    this.name = 'MissingContentError';
    this.nodeId = nodeId;
  }
}

/**
 * Files whose records point at bytes that are not there.
 *
 * Cheap enough to offer in Settings as a check rather than making every reader discover it one
 * failure at a time.
 */
export async function findBrokenFiles(): Promise<VfsNode[]> {
  const nodes = await allNodes();
  const broken: VfsNode[] = [];
  for (const node of nodes) {
    if (node.kind !== 'file' || !node.hash) continue;
    try {
      await blobFile(node.hash, false);
    } catch {
      broken.push(node);
    }
  }
  return broken;
}

export async function readText(id: NodeId): Promise<string> {
  const { data } = await read(id);
  return new TextDecoder().decode(data);
}

export async function stats(): Promise<VfsStats> {
  const nodes = await allNodes();
  const hashes = new Set<string>();
  let bytes = 0;
  let storedBytes = 0;
  const result: VfsStats = {
    files: 0,
    directories: 0,
    trashed: 0,
    bytes: 0,
    storedBytes: 0,
    indexed: 0,
    pending: 0,
  };

  for (const node of nodes) {
    if (node.id === ROOT_ID) continue;
    if (node.trashed) result.trashed++;
    if (node.kind === 'directory') {
      result.directories++;
      continue;
    }
    result.files++;
    bytes += node.size;
    if (node.hash && !hashes.has(node.hash)) {
      hashes.add(node.hash);
      storedBytes += node.size;
    }
    if (node.indexState === 'indexed') result.indexed++;
    if (node.indexState === 'pending' || node.indexState === 'indexing') result.pending++;
  }

  result.bytes = bytes;
  result.storedBytes = storedBytes;
  return result;
}

/* -------------------------------------------------------------------------------------------- */
/* Writes                                                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * Blob writes currently in flight, by hash.
 *
 * OPFS permits exactly one access handle or writable stream per file at a time, so two callers
 * storing the same bytes at the same moment is not a slow path — it is an exception thrown at
 * whichever of them arrives second. That happens more easily than it sounds: an editor saving on a
 * debounce, an import containing the same picture twice, two windows onto one note.
 *
 * Because the store is content-addressed, the second writer has nothing to contribute — identical
 * hash means identical bytes — so it waits for the first instead of racing it.
 */
const blobWrites = new Map<string, Promise<boolean>>();

/** Writes bytes into the blob store if that hash is not already present. Returns true if new. */
async function putBlob(hash: string, data: ArrayBuffer): Promise<boolean> {
  const inFlight = blobWrites.get(hash);
  if (inFlight) {
    await inFlight;
    return false;
  }

  const write = writeBlob(hash, data);
  blobWrites.set(hash, write);
  try {
    return await write;
  } finally {
    blobWrites.delete(hash);
  }
}

async function writeBlob(hash: string, data: ArrayBuffer): Promise<boolean> {
  const handle = await blobFile(hash, true);
  const existing = await handle.getFile();
  // Content-addressed: identical hash means identical bytes, so a non-empty file is already correct.
  if (existing.size === data.byteLength && existing.size > 0) return false;

  const createSync = handle.createSyncAccessHandle?.bind(handle);
  if (createSync) {
    const access = await createSync();
    try {
      access.truncate(0);
      access.write(new Uint8Array(data), { at: 0 });
      access.flush();
    } finally {
      access.close();
    }
  } else {
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }
  return true;
}

async function childNames(store: IDBObjectStore, parentId: NodeId): Promise<Set<string>> {
  const children = await idb.getAll<VfsNode>(store.index('by_parent'), parentId);
  return new Set(children.filter((child) => !child.trashed).map((child) => child.name));
}

export async function createDirectory(parentId: NodeId, name: string): Promise<VfsNode> {
  if (!isValidName(name)) throw new Error('That name is not allowed');
  const handle = await db();
  return transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const parent = await idb.get<VfsNode>(store, parentId);
    if (!parent || parent.kind !== 'directory') throw new Error('Destination is not a folder');

    const now = Date.now();
    const node: VfsNode = {
      id: newId(),
      parentId,
      name: uniqueName(sanitizeName(name), await childNames(store, parentId)),
      kind: 'directory',
      mime: DIRECTORY_MIME,
      size: 0,
      createdAt: now,
      modifiedAt: now,
      trashed: false,
    };
    await idb.put(store, node);
    return node;
  });
}

export interface WriteFileOptions {
  parentId: NodeId;
  name: string;
  data: ArrayBuffer;
  mime?: string;
  sample?: boolean;
  /** Replace the existing file of the same name rather than creating `name (2)`. */
  overwrite?: boolean;
}

export async function writeFile(options: WriteFileOptions): Promise<VfsNode> {
  const { parentId, data } = options;
  if (data.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `Files larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB are not supported yet`,
    );
  }
  if (!isValidName(options.name)) throw new Error('That name is not allowed');

  const hash = await sha256(data);
  await putBlob(hash, data);

  const handle = await db();
  return transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const parent = await idb.get<VfsNode>(store, parentId);
    if (!parent || parent.kind !== 'directory') throw new Error('Destination is not a folder');

    const name = sanitizeName(options.name);
    const now = Date.now();
    const siblings = await idb.getAll<VfsNode>(store.index('by_parent'), parentId);
    const existing = siblings.find((child) => !child.trashed && child.name === name);

    if (existing && options.overwrite) {
      const updated: VfsNode = {
        ...existing,
        hash,
        size: data.byteLength,
        mime: options.mime ?? existing.mime,
        modifiedAt: now,
        // Content changed, so any index entry for it is stale.
        indexState: 'pending',
      };
      await idb.put(store, updated);
      return updated;
    }

    const taken = new Set(siblings.filter((child) => !child.trashed).map((child) => child.name));
    const node: VfsNode = {
      id: newId(),
      parentId,
      name: uniqueName(name, taken),
      kind: 'file',
      mime: options.mime ?? guessMime(name),
      size: data.byteLength,
      createdAt: now,
      modifiedAt: now,
      hash,
      trashed: false,
      indexState: 'pending',
      ...(options.sample ? { sample: true } : {}),
    };
    await idb.put(store, node);
    return node;
  });
}

export async function rename(id: NodeId, name: string): Promise<VfsNode> {
  if (!isValidName(name)) throw new Error('That name is not allowed');
  const handle = await db();
  return transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const node = await idb.get<VfsNode>(store, id);
    if (!node) throw new Error('File not found');
    if (node.id === ROOT_ID) throw new Error('The home folder cannot be renamed');

    const taken = await childNames(store, node.parentId ?? ROOT_ID);
    taken.delete(node.name);
    const updated: VfsNode = {
      ...node,
      name: uniqueName(sanitizeName(name), taken),
      modifiedAt: Date.now(),
    };
    await idb.put(store, updated);
    return updated;
  });
}

/** True when `ancestorId` is `id` or one of its ancestors — the check that stops a folder loop. */
async function isAncestor(store: IDBObjectStore, ancestorId: NodeId, id: NodeId): Promise<boolean> {
  let current = await idb.get<VfsNode>(store, id);
  let depth = 0;
  while (current && depth++ < 128) {
    if (current.id === ancestorId) return true;
    if (!current.parentId) return false;
    current = await idb.get<VfsNode>(store, current.parentId);
  }
  return false;
}

export async function move(ids: NodeId[], targetId: NodeId): Promise<VfsNode[]> {
  const handle = await db();
  return transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const target = await idb.get<VfsNode>(store, targetId);
    if (!target || target.kind !== 'directory') throw new Error('Destination is not a folder');

    const taken = await childNames(store, targetId);
    const moved: VfsNode[] = [];

    for (const id of ids) {
      const node = await idb.get<VfsNode>(store, id);
      if (!node || node.id === ROOT_ID) continue;
      if (node.parentId === targetId) continue;
      // Moving a folder into its own descendant would detach that subtree from the root.
      if (node.kind === 'directory' && (await isAncestor(store, node.id, targetId))) {
        throw new Error(`Cannot move ${node.name} into itself`);
      }

      const name = uniqueName(node.name, taken);
      taken.add(name);
      const updated: VfsNode = { ...node, parentId: targetId, name, modifiedAt: Date.now() };
      await idb.put(store, updated);
      moved.push(updated);
    }
    return moved;
  });
}

/** Every descendant of `id`, excluding `id` itself. */
async function descendants(store: IDBObjectStore, id: NodeId): Promise<VfsNode[]> {
  const found: VfsNode[] = [];
  const queue: NodeId[] = [id];
  while (queue.length) {
    const current = queue.pop()!;
    const children = await idb.getAll<VfsNode>(store.index('by_parent'), current);
    for (const child of children) {
      found.push(child);
      if (child.kind === 'directory') queue.push(child.id);
    }
  }
  return found;
}

export async function trash(ids: NodeId[]): Promise<NodeId[]> {
  const handle = await db();
  return transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const affected: NodeId[] = [];

    for (const id of ids) {
      const node = await idb.get<VfsNode>(store, id);
      if (!node || node.id === ROOT_ID || node.trashed) continue;

      // Only the top node records where it came from; children follow it back on restore.
      await idb.put(store, {
        ...node,
        trashed: true,
        trashedFrom: node.parentId ?? ROOT_ID,
        modifiedAt: Date.now(),
      });
      affected.push(node.id);

      for (const child of await descendants(store, id)) {
        if (child.trashed) continue;
        await idb.put(store, { ...child, trashed: true });
        affected.push(child.id);
      }
    }
    return affected;
  });
}

export async function restore(ids: NodeId[]): Promise<NodeId[]> {
  const handle = await db();
  return transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const affected: NodeId[] = [];

    for (const id of ids) {
      const node = await idb.get<VfsNode>(store, id);
      if (!node || !node.trashed) continue;

      // The original parent may itself have been deleted; fall back to home rather than orphaning.
      const original = node.trashedFrom ?? ROOT_ID;
      const parent = await idb.get<VfsNode>(store, original);
      const parentId = parent && !parent.trashed ? original : ROOT_ID;
      const taken = await childNames(store, parentId);

      const restored: VfsNode = {
        ...node,
        trashed: false,
        parentId,
        name: uniqueName(node.name, taken),
        modifiedAt: Date.now(),
      };
      delete restored.trashedFrom;
      await idb.put(store, restored);
      affected.push(node.id);

      for (const child of await descendants(store, id)) {
        if (!child.trashed) continue;
        const restoredChild = { ...child, trashed: false };
        delete restoredChild.trashedFrom;
        await idb.put(store, restoredChild);
        affected.push(child.id);
      }
    }
    return affected;
  });
}

/**
 * Permanent delete. Removes nodes, then any blob no node references any more.
 *
 * The blob sweep runs after the metadata transaction commits: OPFS is not transactional with
 * IndexedDB, and losing bytes that records still point to is far worse than briefly keeping bytes
 * nothing points to.
 */
export async function deleteForever(ids: NodeId[]): Promise<{ nodes: NodeId[]; blobs: number }> {
  const handle = await db();
  const { removed, candidateHashes } = await transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const removedIds: NodeId[] = [];
    const hashes = new Set<string>();

    for (const id of ids) {
      const node = await idb.get<VfsNode>(store, id);
      if (!node || node.id === ROOT_ID) continue;

      const targets = [node, ...(await descendants(store, id))];
      for (const target of targets) {
        if (target.hash) hashes.add(target.hash);
        await idb.delete(store, target.id);
        removedIds.push(target.id);
      }
    }
    return { removed: removedIds, candidateHashes: hashes };
  });

  let blobsDeleted = 0;
  for (const hash of candidateHashes) {
    const stillReferenced = await transact(handle, 'nodes', 'readonly', (tx) =>
      idb.count(tx.objectStore('nodes').index('by_hash'), IDBKeyRange.only(hash)),
    );
    if (stillReferenced > 0) continue;
    try {
      const shard = await (await blobs()).getDirectoryHandle(hash.slice(0, 2), { create: false });
      await shard.removeEntry(hash);
      blobsDeleted++;
    } catch {
      /* Already gone: the desired end state either way. */
    }
  }

  return { nodes: removed, blobs: blobsDeleted };
}

export async function emptyTrash(): Promise<{ nodes: NodeId[]; blobs: number }> {
  const top = await listTrash();
  return deleteForever(top.map((node) => node.id));
}

export async function setIndexState(id: NodeId, state: IndexState, model?: string): Promise<void> {
  const handle = await db();
  await transact(handle, 'nodes', 'readwrite', async (tx) => {
    const store = tx.objectStore('nodes');
    const node = await idb.get<VfsNode>(store, id);
    if (!node) return;
    await idb.put(store, { ...node, indexState: state, ...(model ? { indexModel: model } : {}) });
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Import                                                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * Imports a batch of files, creating intermediate folders as needed.
 *
 * Everything is copied into OPFS rather than referenced in place: it is the only approach that
 * behaves identically across browsers and keeps working offline, since Firefox and Safari cannot
 * re-open a directory handle at all.
 */
export async function importEntries(
  parentId: NodeId,
  entries: ImportEntry[],
  onProgress: (progress: {
    phase: 'writing' | 'done';
    completed: number;
    total: number;
    currentPath: string;
    bytes: number;
  }) => void,
  options: { sample?: boolean } = {},
): Promise<ImportResult> {
  const result: ImportResult = { created: [], bytes: 0, deduplicated: 0, skipped: [] };
  const directoryCache = new Map<string, NodeId>([['', parentId]]);

  async function directoryFor(segments: string[]): Promise<NodeId> {
    let key = '';
    let current = parentId;
    for (const segment of segments) {
      key = key ? `${key}/${segment}` : segment;
      const cached = directoryCache.get(key);
      if (cached) {
        current = cached;
        continue;
      }
      const siblings = await list(current, false);
      const existing = siblings.find(
        (node) => node.kind === 'directory' && node.name === sanitizeName(segment),
      );
      const directory = existing ?? (await createDirectory(current, segment));
      directoryCache.set(key, directory.id);
      current = directory.id;
    }
    return current;
  }

  let completed = 0;
  for (const entry of entries) {
    const segments = entry.path.split('/').filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) {
      result.skipped.push({ path: entry.path, reason: 'no file name' });
      continue;
    }

    try {
      const targetId = await directoryFor(segments);
      const before = await stat(targetId);
      void before;
      const node = await writeFile({
        parentId: targetId,
        name: fileName,
        data: entry.data,
        ...(entry.mime ? { mime: entry.mime } : {}),
        ...(options.sample ? { sample: true } : {}),
      });
      result.created.push(node.id);
      result.bytes += entry.data.byteLength;
    } catch (error) {
      result.skipped.push({
        path: entry.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    completed++;
    onProgress({
      phase: 'writing',
      completed,
      total: entries.length,
      currentPath: entry.path,
      bytes: result.bytes,
    });
  }

  onProgress({
    phase: 'done',
    completed,
    total: entries.length,
    currentPath: '',
    bytes: result.bytes,
  });
  return result;
}

/** Removes everything the sample dataset created, leaving the user's own files untouched. */
export async function clearSample(): Promise<NodeId[]> {
  const nodes = await allNodes();
  const sampleTops = nodes.filter((node) => node.sample && node.parentId === ROOT_ID);
  const ids = sampleTops.length
    ? sampleTops.map((node) => node.id)
    : nodes.filter((node) => node.sample).map((node) => node.id);
  const { nodes: removed } = await deleteForever(ids);
  return removed;
}

/** Wipes metadata and blobs. Used by Settings, and by tests that need a clean slate. */
export async function resetEverything(): Promise<void> {
  const handle = await db();
  await transact(handle, 'nodes', 'readwrite', (tx) => idb.clear(tx.objectStore('nodes')));
  const root = await navigator.storage.getDirectory();
  await root.removeEntry('blobs', { recursive: true }).catch(() => undefined);
  blobRoot = null;
  await ensureRoot();
}

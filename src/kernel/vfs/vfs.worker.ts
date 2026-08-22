import { exposeRpc, transfer } from '../rpc';
import * as vfs from './store';
import type {
  FileContent,
  ImportEntry,
  ImportResult,
  IndexState,
  NodeId,
  VfsNode,
  VfsStats,
} from './types';

/**
 * The file-I/O worker.
 *
 * Every file operation in the desktop goes through here, for two reasons: OPFS synchronous access
 * handles only exist inside workers (they are the fast path), and hashing a file must never block
 * a window drag.
 */

export type VfsMethods = {
  init: () => VfsNode;
  list: (parentId: NodeId, includeTrashed?: boolean) => VfsNode[];
  listTrash: () => VfsNode[];
  stat: (id: NodeId) => VfsNode | undefined;
  statMany: (ids: NodeId[]) => VfsNode[];
  pathOf: (id: NodeId) => VfsNode[];
  allNodes: () => VfsNode[];
  read: (id: NodeId) => FileContent;
  readText: (id: NodeId) => string;
  writeFile: (options: {
    parentId: NodeId;
    name: string;
    data: ArrayBuffer;
    mime?: string;
    overwrite?: boolean;
  }) => VfsNode;
  createDirectory: (parentId: NodeId, name: string) => VfsNode;
  rename: (id: NodeId, name: string) => VfsNode;
  move: (ids: NodeId[], targetId: NodeId) => VfsNode[];
  trash: (ids: NodeId[]) => NodeId[];
  restore: (ids: NodeId[]) => NodeId[];
  deleteForever: (ids: NodeId[]) => { nodes: NodeId[]; blobs: number };
  emptyTrash: () => { nodes: NodeId[]; blobs: number };
  importEntries: (
    parentId: NodeId,
    entries: ImportEntry[],
    options?: { sample?: boolean },
  ) => ImportResult;
  stats: () => VfsStats;
  setIndexState: (id: NodeId, state: IndexState, model?: string) => void;
  clearSample: () => NodeId[];
  resetEverything: () => void;
};

exposeRpc<VfsMethods>({
  init: async () => vfs.ensureRoot(),
  list: async ([parentId, includeTrashed]) => vfs.list(parentId, includeTrashed ?? false),
  listTrash: async () => vfs.listTrash(),
  stat: async ([id]) => vfs.stat(id),
  statMany: async ([ids]) => vfs.statMany(ids),
  pathOf: async ([id]) => vfs.pathOf(id),
  allNodes: async () => vfs.allNodes(),

  // Whole files can be large, so hand the buffer over rather than cloning it.
  read: async ([id]) => {
    const content = await vfs.read(id);
    return transfer(content, [content.data]);
  },
  readText: async ([id]) => vfs.readText(id),

  writeFile: async ([options]) => vfs.writeFile(options),
  createDirectory: async ([parentId, name]) => vfs.createDirectory(parentId, name),
  rename: async ([id, name]) => vfs.rename(id, name),
  move: async ([ids, targetId]) => vfs.move(ids, targetId),
  trash: async ([ids]) => vfs.trash(ids),
  restore: async ([ids]) => vfs.restore(ids),
  deleteForever: async ([ids]) => vfs.deleteForever(ids),
  emptyTrash: async () => vfs.emptyTrash(),

  importEntries: async ([parentId, entries, options], report) =>
    vfs.importEntries(parentId, entries, report, options ?? {}),

  stats: async () => vfs.stats(),
  setIndexState: async ([id, state, model]) => vfs.setIndexState(id, state, model),
  clearSample: async () => vfs.clearSample(),
  resetEverything: async () => vfs.resetEverything(),
});

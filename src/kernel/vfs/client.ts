import { useEffect, useState } from 'react';
import VfsWorker from './vfs.worker?worker';
import { createRpcClient, type RpcClient } from '../rpc';
import type { VfsMethods } from './vfs.worker';
import type {
  FileContent,
  ImportEntry,
  ImportProgress,
  ImportResult,
  IndexState,
  NodeId,
  VfsChange,
  VfsNode,
  VfsStats,
} from './types';
import { ROOT_ID } from './types';

/**
 * Main-thread handle on the file system.
 *
 * Beyond forwarding calls to the worker it does one thing that matters: every mutation announces
 * what changed, locally and to other tabs. Views subscribe rather than poll, so a file created in
 * the Notepad app appears in an open Files window without either app knowing the other exists.
 */

type ChangeListener = (change: VfsChange) => void;

class Vfs {
  private rpc: RpcClient<VfsMethods> = createRpcClient<VfsMethods>(new VfsWorker());
  private listeners = new Set<ChangeListener>();
  private channel: BroadcastChannel | null =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('tabula:vfs');
  private ready: Promise<VfsNode> | null = null;

  constructor() {
    // A change in another tab is indistinguishable from a local one as far as views care.
    this.channel?.addEventListener('message', (event: MessageEvent<VfsChange>) => {
      for (const listener of [...this.listeners]) listener(event.data);
    });
  }

  init(): Promise<VfsNode> {
    this.ready ??= this.rpc.call('init', []);
    return this.ready;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private announce(change: VfsChange): void {
    for (const listener of [...this.listeners]) listener(change);
    this.channel?.postMessage(change);
  }

  /* Reads ------------------------------------------------------------------------------------ */

  list(parentId: NodeId, includeTrashed = false): Promise<VfsNode[]> {
    return this.rpc.call('list', [parentId, includeTrashed]);
  }
  listTrash(): Promise<VfsNode[]> {
    return this.rpc.call('listTrash', []);
  }
  stat(id: NodeId): Promise<VfsNode | undefined> {
    return this.rpc.call('stat', [id]);
  }
  statMany(ids: NodeId[]): Promise<VfsNode[]> {
    return this.rpc.call('statMany', [ids]);
  }
  pathOf(id: NodeId): Promise<VfsNode[]> {
    return this.rpc.call('pathOf', [id]);
  }
  allNodes(): Promise<VfsNode[]> {
    return this.rpc.call('allNodes', []);
  }
  read(id: NodeId): Promise<FileContent> {
    return this.rpc.call('read', [id]);
  }
  readText(id: NodeId): Promise<string> {
    return this.rpc.call('readText', [id]);
  }
  stats(): Promise<VfsStats> {
    return this.rpc.call('stats', []);
  }

  /* Writes ----------------------------------------------------------------------------------- */

  async createDirectory(parentId: NodeId, name: string): Promise<VfsNode> {
    const node = await this.rpc.call('createDirectory', [parentId, name]);
    this.announce({ parents: [parentId], nodes: [node.id], reason: 'create' });
    return node;
  }

  async writeFile(options: {
    parentId: NodeId;
    name: string;
    data: ArrayBuffer;
    mime?: string;
    overwrite?: boolean;
  }): Promise<VfsNode> {
    const node = await this.rpc.call('writeFile', [options], { transfer: [options.data] });
    this.announce({ parents: [options.parentId], nodes: [node.id], reason: 'write' });
    return node;
  }

  async writeText(
    parentId: NodeId,
    name: string,
    text: string,
    options: { mime?: string; overwrite?: boolean } = {},
  ): Promise<VfsNode> {
    const data = new TextEncoder().encode(text);
    // `.slice()` detaches a standalone ArrayBuffer, which is what the transfer list needs.
    return this.writeFile({
      parentId,
      name,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      mime: options.mime ?? 'text/plain',
      ...(options.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
    });
  }

  async rename(id: NodeId, name: string): Promise<VfsNode> {
    const node = await this.rpc.call('rename', [id, name]);
    this.announce({ parents: [node.parentId ?? ROOT_ID], nodes: [id], reason: 'rename' });
    return node;
  }

  async move(ids: NodeId[], targetId: NodeId): Promise<VfsNode[]> {
    const before = await this.statMany(ids);
    const moved = await this.rpc.call('move', [ids, targetId]);
    const parents = new Set<NodeId>([targetId]);
    for (const node of before) parents.add(node.parentId ?? ROOT_ID);
    this.announce({ parents: [...parents], nodes: ids, reason: 'move' });
    return moved;
  }

  async trash(ids: NodeId[]): Promise<NodeId[]> {
    const before = await this.statMany(ids);
    const affected = await this.rpc.call('trash', [ids]);
    this.announce({
      parents: [...new Set(before.map((node) => node.parentId ?? ROOT_ID))],
      nodes: affected,
      reason: 'trash',
    });
    return affected;
  }

  async restore(ids: NodeId[]): Promise<NodeId[]> {
    const affected = await this.rpc.call('restore', [ids]);
    const after = await this.statMany(affected);
    this.announce({
      parents: [...new Set(after.map((node) => node.parentId ?? ROOT_ID))],
      nodes: affected,
      reason: 'restore',
    });
    return affected;
  }

  async deleteForever(ids: NodeId[]): Promise<{ nodes: NodeId[]; blobs: number }> {
    const before = await this.statMany(ids);
    const result = await this.rpc.call('deleteForever', [ids]);
    this.announce({
      parents: [...new Set(before.map((node) => node.parentId ?? ROOT_ID))],
      nodes: result.nodes,
      reason: 'delete',
    });
    return result;
  }

  async emptyTrash(): Promise<{ nodes: NodeId[]; blobs: number }> {
    const result = await this.rpc.call('emptyTrash', []);
    this.announce({ parents: [], nodes: result.nodes, reason: 'delete' });
    return result;
  }

  async importEntries(
    parentId: NodeId,
    entries: ImportEntry[],
    options: { sample?: boolean; onProgress?: (progress: ImportProgress) => void } = {},
  ): Promise<ImportResult> {
    const result = await this.rpc.call(
      'importEntries',
      [parentId, entries, { ...(options.sample ? { sample: true } : {}) }],
      {
        transfer: entries.map((entry) => entry.data),
        ...(options.onProgress
          ? { onProgress: options.onProgress as (payload: unknown) => void }
          : {}),
      },
    );
    this.announce({ parents: [parentId], nodes: result.created, reason: 'import' });
    return result;
  }

  async setIndexState(id: NodeId, state: IndexState, model?: string): Promise<void> {
    await this.rpc.call('setIndexState', [id, state, model]);
    // Deliberately quiet: index progress would otherwise refresh every open window per file.
  }

  /**
   * Files the desktop still lists but can no longer open.
   *
   * Metadata and content live in two stores that are not transactional with each other, so a
   * record can outlive its bytes. Nothing here creates that state deliberately; this exists so
   * that when it happens it can be seen and cleared, rather than being met one failed open at a
   * time with a message from the platform.
   */
  findBrokenFiles(): Promise<VfsNode[]> {
    return this.rpc.call('findBrokenFiles', []);
  }

  async clearSample(): Promise<NodeId[]> {
    const removed = await this.rpc.call('clearSample', []);
    this.announce({ parents: [ROOT_ID], nodes: removed, reason: 'delete' });
    return removed;
  }

  async resetEverything(): Promise<void> {
    await this.rpc.call('resetEverything', []);
    this.announce({ parents: [ROOT_ID], nodes: [], reason: 'delete' });
  }
}

export const vfs = new Vfs();

/* -------------------------------------------------------------------------------------------- */
/* React bindings                                                                                 */
/* -------------------------------------------------------------------------------------------- */

export interface DirectoryView {
  nodes: VfsNode[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Live listing of a directory: re-reads whenever something in it changes. */
export function useDirectory(parentId: NodeId | null, includeTrashed = false): DirectoryView {
  const [nodes, setNodes] = useState<VfsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!parentId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const listing = await vfs.list(parentId, includeTrashed);
        if (!cancelled) {
          setNodes(listing);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const unsubscribe = vfs.onChange((change) => {
      // Reload when this directory's listing changed, or when a node inside it did.
      if (change.parents.includes(parentId) || change.parents.length === 0) void load();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [parentId, includeTrashed, nonce]);

  return { nodes, loading, error, reload: () => setNonce((n) => n + 1) };
}

/** The trash listing, kept live the same way. */
export function useTrash(): { nodes: VfsNode[]; loading: boolean; reload: () => void } {
  const [nodes, setNodes] = useState<VfsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const listing = await vfs.listTrash();
      if (cancelled) return;
      setNodes(listing);
      setLoading(false);
    };
    void load();
    const unsubscribe = vfs.onChange(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [nonce]);

  return { nodes, loading, reload: () => setNonce((n) => n + 1) };
}

export function useVfsStats(): VfsStats | null {
  const [stats, setStats] = useState<VfsStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await vfs.stats();
      if (!cancelled) setStats(next);
    };
    void load();
    const unsubscribe = vfs.onChange(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return stats;
}

/** Breadcrumb trail for a directory. */
export function usePath(id: NodeId | null): VfsNode[] {
  const [path, setPath] = useState<VfsNode[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      const chain = await vfs.pathOf(id);
      if (!cancelled) setPath(chain);
    };
    void load();
    const unsubscribe = vfs.onChange((change) => {
      if (change.reason === 'rename' || change.reason === 'move') void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id]);

  return path;
}

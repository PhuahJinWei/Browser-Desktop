import { createStore, useStore } from './store';
import { vfs } from './vfs/client';
import type { NodeId, VfsNode } from './vfs/types';

/**
 * Cut, Copy and Paste for files and folders.
 *
 * Deliberately not the system clipboard. The web platform can put text and pictures there, but not
 * a file in the sense a file manager means one: a page has no way to hand another program "these
 * three files", and no way to receive them back as anything but a fresh upload. So this holds
 * references into the desktop's own file system, and lasts as long as the page does — which is also
 * how long an operating system's clipboard held its file references.
 *
 * A cut marks rather than moves. Nothing happens to cut files until they are pasted somewhere, which
 * is what lets a cut be abandoned just by copying something else, and why Files draws cut items
 * dimmed rather than taking them away.
 */

export interface FileClipboard {
  mode: 'copy' | 'cut';
  ids: readonly NodeId[];
}

const clipboard = createStore<FileClipboard | null>(null);

export function copyFiles(ids: readonly NodeId[]): void {
  if (ids.length > 0) clipboard.set({ mode: 'copy', ids: [...ids] });
}

export function cutFiles(ids: readonly NodeId[]): void {
  if (ids.length > 0) clipboard.set({ mode: 'cut', ids: [...ids] });
}

/**
 * Abandon a cut, the way Esc always did. Nothing has happened to cut files until they are pasted, so
 * there is nothing to undo — only the marks to take away. A copy is left alone: it marks nothing.
 */
export function cancelCut(): void {
  if (clipboard.get()?.mode === 'cut') clipboard.set(null);
}

/** Whether Paste has anything to do. Menus read it as they are built, so it is current when shown. */
export function canPaste(): boolean {
  return clipboard.get() !== null;
}

export function useFileClipboard(): FileClipboard | null {
  return useStore(clipboard);
}

/**
 * Paste into a folder, returning what landed there.
 *
 * A copy can be pasted again and again, as it always could; a cut is used up by its paste, because
 * the originals are no longer where the clipboard says they are.
 *
 * Anything binned or deleted since it was put on the clipboard is left out rather than pasted —
 * moving a node still marked as trashed would plant an invisible file in the destination. If nothing
 * is left at all, the clipboard is emptied and the caller told, instead of Paste staying enabled for
 * files that no longer exist.
 */
export async function pasteFiles(targetId: NodeId): Promise<VfsNode[]> {
  const current = clipboard.get();
  if (!current) return [];

  /*
   * Only ever clear the clipboard that this paste started from. Paste is asynchronous, and anything
   * copied while it runs is a newer instruction — clearing unconditionally would quietly throw away
   * the thing the user copied last.
   */
  const release = () => {
    if (clipboard.get() === current) clipboard.set(null);
  };

  const live = (await vfs.statMany([...current.ids])).filter((node) => !node.trashed);
  if (live.length === 0) {
    release();
    throw new Error('What was on the clipboard has since been deleted');
  }
  const ids = live.map((node) => node.id);

  if (current.mode === 'copy') return vfs.copy(ids, targetId);

  const moved = await vfs.move(ids, targetId);
  release();
  return moved;
}

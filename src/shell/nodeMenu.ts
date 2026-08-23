import { appsFor, launchApp, openFile } from '../kernel/apps';
import { notify, notifyError } from '../kernel/notifications';
import { vfs } from '../kernel/vfs/client';
import type { VfsNode } from '../kernel/vfs/types';
import { isWallpaperCandidate, setWallpaperFromFile } from '../kernel/wallpaper';
import { separator, type MenuSpec } from './ContextMenu';

/**
 * The menu every file gets, wherever it is shown.
 *
 * A file behaves the same whether it is a row in Files, a thumbnail in Photos, a search result or
 * the thing currently open in the Viewer — so the menu that acts on it is built once here rather
 * than written out ten times and drifting nine ways. Surfaces add their own entries around it.
 *
 * The entries are deliberately about the file rather than about the app showing it: open it
 * elsewhere, find it in Files, make it the wallpaper, throw it away.
 */

export interface NodeMenuOptions {
  /** Drop the plain "Open" entry — for a surface that already has this file open. */
  omitOpen?: boolean;
  /** Drop "Move to Trash" — for read-only surfaces such as search results. */
  omitTrash?: boolean;
  /** Called after the file is trashed, so a surface can drop its selection. */
  onTrashed?: () => void;
}

export function nodeMenuItems(node: VfsNode, options: NodeMenuOptions = {}): MenuSpec {
  // The first opener is what plain "Open" already does; the rest are the alternatives.
  const openers = node.kind === 'file' ? appsFor(node) : [];

  return [
    !options.omitOpen && {
      id: 'node.open',
      label: node.kind === 'directory' ? 'Open folder' : 'Open',
      run: () => void openFile(node),
    },
    ...openers.slice(1).map((app) => ({
      id: `node.open.${app.id}`,
      label: `Open with ${app.name}`,
      run: () => void launchApp(app.id, { args: { fileId: node.id }, title: node.name }),
    })),
    separator('node.s1'),
    {
      id: 'node.reveal',
      label: 'Show in Files',
      run: () =>
        void launchApp('files', {
          args: { directoryId: node.parentId, selectId: node.id },
          title: 'Files',
        }),
    },
    {
      id: 'node.copyName',
      label: 'Copy name',
      run: () => void copyText(node.name),
    },
    isWallpaperCandidate(node) && {
      id: 'node.wallpaper',
      label: 'Set as desktop wallpaper',
      run: () => setWallpaperFromFile(node.id, node.name),
    },
    !options.omitTrash && separator('node.s2'),
    !options.omitTrash && {
      id: 'node.trash',
      label: 'Move to Trash',
      danger: true,
      run: () => {
        void vfs
          .trash([node.id])
          .then(() => {
            options.onTrashed?.();
            notify({
              title: `Moved ${node.name} to Trash`,
              level: 'success',
              action: { label: 'Undo', run: () => void vfs.restore([node.id]) },
            });
          })
          .catch((error: unknown) => notifyError('Could not move to Trash', error));
      },
    },
  ];
}

/**
 * Puts text on the clipboard.
 *
 * Failure is worth reporting rather than swallowing: the browser refuses this when the document is
 * not focused or the permission is denied, and a Copy that silently does nothing is the kind of
 * bug people blame themselves for.
 */
export function copyText(text: string, what = 'Copied'): void {
  void navigator.clipboard
    .writeText(text)
    .then(() => notify({ title: what, level: 'success', timeout: 2000 }))
    .catch((error: unknown) => notifyError('Could not copy to the clipboard', error));
}

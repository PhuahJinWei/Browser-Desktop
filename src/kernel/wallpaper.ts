import { notify, notifyError } from './notifications';
import { pickFile } from './pickFile';
import { settingsStore, updateSettings, type WallpaperFit } from './settings';
import { vfs } from './vfs/client';
import { ROOT_ID, type VfsNode } from './vfs/types';

/**
 * The custom wallpaper.
 *
 * The wallpaper is a file the user already has, referenced by VFS node id — not a copy stashed in
 * localStorage, and not a URL. That keeps the rule the rest of the desktop follows: what you see
 * points at something you own and can open. It also means the image is only available once the
 * file system is mounted, so the built-in gradient stays on screen until then rather than
 * flashing white.
 *
 * This module owns the inline `--desktop-bg` property outright. The presets live in tokens.css
 * keyed on `data-wallpaper`; `custom` has no rule there, so removing the inline value is all it
 * takes to fall back to the default gradient.
 */

const IMAGE_PREFIX = 'image/';

let objectUrl: string | null = null;
let loadedFileId: string | null = null;

function backgroundFor(url: string, fit: WallpaperFit): string {
  const image = `url("${url}")`;
  switch (fit) {
    case 'cover':
      return `${image} center center / cover no-repeat`;
    case 'contain':
      return `${image} center center / contain no-repeat, var(--surface-0)`;
    case 'tile':
      return `${image} top left / auto repeat, var(--surface-0)`;
    case 'center':
      return `${image} center center / auto no-repeat, var(--surface-0)`;
  }
}

function clearBackground(): void {
  document.documentElement.style.removeProperty('--desktop-bg');
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  loadedFileId = null;
}

/**
 * Brings the desktop background in line with the settings.
 *
 * Cheap to call repeatedly: the file is only re-read when the chosen node changes, so a theme
 * toggle or a text-size change costs a string assignment.
 */
export async function refreshWallpaper(): Promise<void> {
  if (typeof document === 'undefined') return;
  const { wallpaper, wallpaperFileId, wallpaperFit } = settingsStore.get();

  if (wallpaper !== 'custom' || !wallpaperFileId) {
    clearBackground();
    return;
  }

  if (wallpaperFileId !== loadedFileId) {
    let content;
    try {
      content = await vfs.read(wallpaperFileId);
    } catch {
      // The image was deleted or its contents are gone. Say so once and fall back, rather than
      // leaving a setting that silently does nothing.
      clearBackground();
      updateSettings({ wallpaper: 'aurora', wallpaperFileId: null });
      notify({
        title: 'The wallpaper image is no longer there',
        body: 'The desktop is back to Aurora. Pick another picture in Settings.',
        level: 'warning',
      });
      return;
    }

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(new Blob([content.data], { type: content.node.mime }));
    loadedFileId = wallpaperFileId;
  }

  if (objectUrl) {
    document.documentElement.style.setProperty(
      '--desktop-bg',
      backgroundFor(objectUrl, wallpaperFit),
    );
  }
}

/** Keeps the background in step with the settings for as long as the desktop is running. */
export function startWallpaper(): () => void {
  void refreshWallpaper();
  return settingsStore.subscribe(() => void refreshWallpaper());
}

/* -------------------------------------------------------------------------------------------- */
/* Choosing one                                                                                   */
/* -------------------------------------------------------------------------------------------- */

export function isWallpaperCandidate(node: VfsNode): boolean {
  return node.kind === 'file' && node.mime.startsWith(IMAGE_PREFIX);
}

export function setWallpaperFromFile(nodeId: string, name?: string): void {
  updateSettings({ wallpaper: 'custom', wallpaperFileId: nodeId });
  notify({
    title: name ? `Wallpaper set to ${name}` : 'Wallpaper set',
    body: 'Change the fit, or go back to a built-in wallpaper, in Settings.',
    level: 'success',
  });
}

/**
 * Takes a picture from the user's own machine and makes it the wallpaper.
 *
 * It is imported into the file system first, deliberately: a wallpaper that exists only as a
 * browser reference to a path outside this desktop would break the next time the tab opened, and
 * would be the one thing on screen the file manager could not show you.
 */
export async function importWallpaperImage(file: File): Promise<void> {
  if (!file.type.startsWith(IMAGE_PREFIX)) {
    notifyError('That is not an image', new Error(`${file.name} is ${file.type || 'unknown'}`));
    return;
  }

  const data = await file.arrayBuffer();
  const parent = await picturesFolder();
  const node = await vfs.writeFile({ parentId: parent, name: file.name, data, mime: file.type });
  setWallpaperFromFile(node.id, node.name);
}

/** Opens the browser's own file dialog, then does the above. Returns false if nothing was chosen. */
export async function pickWallpaperImage(): Promise<boolean> {
  const file = await pickFile('image/*');
  if (!file) return false;
  await importWallpaperImage(file);
  return true;
}

/** The existing Pictures folder, or a new one. Wallpapers belong with the other pictures. */
async function picturesFolder(): Promise<string> {
  const children = await vfs.list(ROOT_ID);
  const existing = children.find(
    (node) => node.kind === 'directory' && node.name.toLowerCase() === 'pictures',
  );
  if (existing) return existing.id;
  const created = await vfs.createDirectory(ROOT_ID, 'Pictures');
  return created.id;
}

/** The bytes behind the current custom wallpaper, for the setup export. Null if there is none. */
export async function readWallpaperImage(): Promise<{
  name: string;
  mime: string;
  data: ArrayBuffer;
} | null> {
  const { wallpaper, wallpaperFileId } = settingsStore.get();
  if (wallpaper !== 'custom' || !wallpaperFileId) return null;
  try {
    const content = await vfs.read(wallpaperFileId);
    return { name: content.node.name, mime: content.node.mime, data: content.data };
  } catch {
    return null;
  }
}

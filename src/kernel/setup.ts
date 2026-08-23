import { notify } from './notifications';
import { saveSession, settingsStore, updateSettings, type Settings } from './settings';
import {
  PORTABLE_KEYS,
  SETUP_FORMAT,
  SETUP_VERSION,
  fromBase64,
  toBase64,
  type DesktopSetup,
  type PortableSettings,
} from './setupFormat';
import { vfs } from './vfs/client';
import { ROOT_ID } from './vfs/types';
import { restoreSession, serializeSession, windowStore } from './windows';
import { readWallpaperImage } from './wallpaper';

/**
 * Exporting and importing a desktop setup.
 *
 * There is no account and no sync, so "use my setup on my other machine" has to be a file the user
 * carries. That is the honest local-first answer, and it has a property sync does not: you can open
 * it, read every line, and see exactly what this desktop knows about you.
 *
 * Two things are deliberately not in the file.
 *
 * **Your files.** A setup is a few kilobytes; the file system can be gigabytes. Exporting data is a
 * separate job with separate ergonomics.
 *
 * **Installed apps.** Those are code. The desktop already has one path for installing an app — from
 * a folder, an archive or a link, each time through the capability broker's prompts — and quietly
 * adding a second path that runs whatever a JSON file names would undo the point of the first.
 *
 * Reading a setup back is in `setupFormat.ts`, which is pure and tested.
 */

/** Past this, the picture does not travel: a setup file is meant to be small enough to email. */
const MAX_EMBEDDED_WALLPAPER = 8 * 1024 * 1024;

export interface ExportOptions {
  includeWindows: boolean;
  includeWallpaper: boolean;
}

/* -------------------------------------------------------------------------------------------- */
/* Export                                                                                         */
/* -------------------------------------------------------------------------------------------- */

export async function buildSetup(options: ExportOptions): Promise<DesktopSetup> {
  const current = settingsStore.get();
  const settings: PortableSettings = {};
  for (const key of PORTABLE_KEYS) {
    Object.assign(settings, { [key]: current[key] });
  }

  const setup: DesktopSetup = {
    format: SETUP_FORMAT,
    version: SETUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  };

  if (options.includeWindows) setup.session = serializeSession();

  if (options.includeWallpaper) {
    const image = await readWallpaperImage();
    if (image && image.data.byteLength <= MAX_EMBEDDED_WALLPAPER) {
      setup.wallpaper = { name: image.name, mime: image.mime, dataBase64: toBase64(image.data) };
    } else if (image) {
      // Dropping the picture silently would be worse than saying it was too big to carry.
      notify({
        title: 'The wallpaper was left out of the export',
        body: `${image.name} is larger than 8 MB. Everything else was exported.`,
        level: 'warning',
      });
    }
  }

  // A node id is meaningless anywhere but here, so a custom wallpaper without its bytes is not one.
  if (setup.settings.wallpaper === 'custom' && !setup.wallpaper)
    setup.settings.wallpaper = 'aurora';

  return setup;
}

/** Hands the setup to the browser as a download. Nothing is uploaded; the file never leaves. */
export async function exportSetup(options: ExportOptions): Promise<void> {
  const setup = await buildSetup(options);
  const blob = new Blob([JSON.stringify(setup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `tabula-desktop-${stamp}.json`;
  anchor.click();
  // Revoking in the same tick can race the download; a second is invisible and safe.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* -------------------------------------------------------------------------------------------- */
/* Import                                                                                         */
/* -------------------------------------------------------------------------------------------- */

export interface SetupImportResult {
  settingsApplied: number;
  wallpaperImported: boolean;
  windowsRestored: number;
}

export async function applySetup(setup: DesktopSetup): Promise<SetupImportResult> {
  const patch: PortableSettings = { ...setup.settings };
  let wallpaperImported = false;

  if (setup.wallpaper) {
    try {
      const node = await vfs.writeFile({
        parentId: await picturesFolder(),
        name: setup.wallpaper.name,
        data: fromBase64(setup.wallpaper.dataBase64),
        mime: setup.wallpaper.mime,
      });
      updateSettings({ wallpaperFileId: node.id });
      patch.wallpaper = 'custom';
      wallpaperImported = true;
    } catch {
      // A corrupt image should not cost the user the rest of their setup.
      patch.wallpaper = 'aurora';
    }
  }

  if (patch.wallpaper !== 'custom') updateSettings({ wallpaperFileId: null });
  updateSettings(patch as Partial<Settings>);

  let windowsRestored = 0;
  if (setup.session && setup.session.windows.length > 0) {
    restoreSession(setup.session, windowStore.get().viewport);
    saveSession(setup.session);
    windowsRestored = setup.session.windows.length;
  }

  return { settingsApplied: Object.keys(patch).length, wallpaperImported, windowsRestored };
}

/** Wallpapers arriving with a setup land with the other pictures, not loose in the root. */
async function picturesFolder(): Promise<string> {
  const children = await vfs.list(ROOT_ID);
  const existing = children.find(
    (node) => node.kind === 'directory' && node.name.toLowerCase() === 'pictures',
  );
  if (existing) return existing.id;
  return (await vfs.createDirectory(ROOT_ID, 'Pictures')).id;
}

export { parseSetup, type DesktopSetup } from './setupFormat';

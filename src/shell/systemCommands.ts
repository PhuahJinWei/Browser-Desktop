import { APPS, launchApp, searchFiles } from '../kernel/apps';
import { registerCommands, type Command } from '../kernel/commands';
import { arrangeIcons, resetIconLayout, rowsForHeight } from '../kernel/desktop';
import { pickFile } from '../kernel/pickFile';
import { applySetup, exportSetup, parseSetup } from '../kernel/setup';
import { pickWallpaperImage } from '../kernel/wallpaper';
import { notifyError } from '../kernel/notifications';
import { cancelKind } from '../kernel/jobs';
import { notify } from '../kernel/notifications';
import { clearSession, settingsStore, updateSettings } from '../kernel/settings';
import { vfs } from '../kernel/vfs/client';
import { ROOT_ID } from '../kernel/vfs/types';
import {
  closeAllWindows,
  cycleFocus,
  windowStore,
  closeWindow,
  toggleMaximize,
} from '../kernel/windows';
import { reindexEverything } from '../services/index/client';

/**
 * The system command set.
 *
 * Registered once at boot. Anything here is simultaneously a palette entry and, if it declares
 * one, a keyboard shortcut — which is the point of routing both through one registry.
 *
 * Shortcut choices are constrained by the browser: Ctrl+W, Ctrl+T and Ctrl+N belong to the tab
 * strip and cannot be intercepted, so window management lives on Ctrl+Alt instead.
 */
export function registerSystemCommands(): () => void {
  const appCommands: Command[] = APPS.filter((app) => !app.hidden).map((app) => ({
    id: `app.open.${app.id}`,
    title: `Open ${app.name}`,
    section: 'Apps',
    keywords: [app.description],
    ...(app.id === 'files'
      ? { shortcut: 'Ctrl+Shift+E' }
      : app.id === 'notes'
        ? { shortcut: 'Ctrl+Shift+N' }
        : app.id === 'settings'
          ? { shortcut: 'Ctrl+,' }
          : {}),
    run: () => void launchApp(app.id),
  }));

  const system: Command[] = [
    {
      // The shortcut the Search app had, kept for the place search now lives.
      id: 'files.search',
      title: 'Search files',
      section: 'Search',
      keywords: ['find', 'search inside files', 'meaning'],
      shortcut: 'Ctrl+Shift+F',
      run: () => void searchFiles(),
    },
    {
      id: 'window.cycle',
      title: 'Switch window',
      section: 'View',
      shortcut: 'Ctrl+`',
      run: () => cycleFocus(1),
    },
    {
      id: 'window.maximize',
      title: 'Maximise or restore the focused window',
      section: 'View',
      run: () => {
        const focused = windowStore.get().focusedId;
        if (focused) toggleMaximize(focused);
      },
      when: () => windowStore.get().focusedId !== null,
    },
    {
      id: 'window.close',
      title: 'Close the focused window',
      section: 'View',
      shortcut: 'Ctrl+Alt+W',
      run: () => {
        const focused = windowStore.get().focusedId;
        if (focused) closeWindow(focused);
      },
      when: () => windowStore.get().focusedId !== null,
    },
    {
      id: 'window.closeAll',
      title: 'Close all windows',
      section: 'View',
      run: () => closeAllWindows(),
      when: () => windowStore.get().windows.length > 0,
    },
    {
      // What the light/dark toggle used to be. There is one palette now, so the only appearance
      // choice worth a keystroke is which decade the desktop is from.
      id: 'view.skin.toggle',
      title: 'Switch between the modern and classic skin',
      section: 'View',
      keywords: ['skin', 'classic', 'modern', 'appearance', 'theme'],
      run: () => {
        updateSettings({ skin: settingsStore.get().skin === 'classic' ? 'modern' : 'classic' });
      },
    },
    {
      id: 'file.newFolder',
      title: 'New folder in Home',
      section: 'File',
      run: async () => {
        const node = await vfs.createDirectory(ROOT_ID, 'New folder');
        launchApp('files', { args: { directoryId: ROOT_ID, selectId: node.id } });
      },
    },
    {
      id: 'file.newNote',
      title: 'New note',
      section: 'File',
      keywords: ['write', 'markdown'],
      run: () => void launchApp('notes', { args: { create: true } }),
    },
    {
      id: 'search.reindex',
      title: 'Rebuild the search index',
      section: 'Search',
      keywords: ['reindex', 'embeddings'],
      run: () => void reindexEverything(),
    },
    {
      id: 'search.cancelIndexing',
      title: 'Stop background indexing',
      section: 'Search',
      run: () => {
        const stopped = cancelKind('index');
        notify({
          title:
            stopped > 0
              ? `Stopped ${stopped} indexing job${stopped === 1 ? '' : 's'}`
              : 'Nothing was indexing',
          level: stopped > 0 ? 'info' : 'info',
        });
      },
    },
    {
      id: 'view.wallpaper',
      title: 'Change the wallpaper',
      section: 'View',
      keywords: ['background', 'picture', 'personalise'],
      run: async () => {
        try {
          await pickWallpaperImage();
        } catch (error) {
          notifyError('That picture could not be used', error);
        }
      },
    },
    {
      id: 'view.sortIcons',
      title: 'Sort the desktop icons by name',
      section: 'View',
      keywords: ['arrange', 'tidy', 'desktop'],
      run: () =>
        arrangeIcons(
          APPS.filter((app) => !app.hidden)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((app) => app.id),
          rowsForHeight(windowStore.get().viewport.height),
        ),
    },
    {
      id: 'view.resetIcons',
      title: 'Reset the desktop icon layout',
      section: 'View',
      keywords: ['arrange', 'desktop', 'restore'],
      run: () => {
        resetIconLayout();
        notify({ title: 'Desktop icons back where they started', level: 'info' });
      },
    },
    {
      id: 'system.exportSetup',
      title: 'Export the desktop setup',
      section: 'System',
      keywords: ['backup', 'settings', 'transfer', 'another device'],
      run: async () => {
        try {
          await exportSetup({ includeWindows: true, includeWallpaper: true });
          notify({ title: 'Setup exported', level: 'success' });
        } catch (error) {
          notifyError('The setup could not be exported', error);
        }
      },
    },
    {
      id: 'system.importSetup',
      title: 'Import a desktop setup',
      section: 'System',
      keywords: ['restore', 'settings', 'transfer'],
      run: async () => {
        try {
          const file = await pickFile('application/json,.json');
          if (!file) return;
          await applySetup(parseSetup(await file.text()));
          notify({ title: 'Setup imported', level: 'success' });
        } catch (error) {
          notifyError('That setup could not be imported', error);
        }
      },
    },
    {
      id: 'system.clearSession',
      title: 'Forget the saved window layout',
      section: 'System',
      run: () => {
        clearSession();
        notify({
          title: 'Window layout forgotten',
          body: 'The next visit starts with a clean desktop.',
        });
      },
    },
  ];

  return registerCommands([...appCommands, ...system]);
}

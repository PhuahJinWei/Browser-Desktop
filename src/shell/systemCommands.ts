import { APPS, launchApp } from '../kernel/apps';
import { registerCommands, type Command } from '../kernel/commands';
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
      : app.id === 'search'
        ? { shortcut: 'Ctrl+Shift+F' }
        : app.id === 'notes'
          ? { shortcut: 'Ctrl+Shift+N' }
          : app.id === 'settings'
            ? { shortcut: 'Ctrl+,' }
            : {}),
    run: () => void launchApp(app.id),
  }));

  const system: Command[] = [
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
      id: 'view.theme.toggle',
      title: 'Toggle light and dark theme',
      section: 'View',
      keywords: ['dark mode', 'light mode', 'appearance'],
      run: () => {
        const current = settingsStore.get().theme;
        // From "system", switch to the opposite of what the system is currently showing.
        const systemDark =
          typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
        const next =
          current === 'system'
            ? systemDark
              ? 'light'
              : 'dark'
            : current === 'dark'
              ? 'light'
              : 'dark';
        updateSettings({ theme: next });
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

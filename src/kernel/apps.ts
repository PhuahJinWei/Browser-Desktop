import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { IconName } from '../shell/Icon';
import type { VfsNode } from './vfs/types';
import { openWindow, type WindowSession } from './windows';

/**
 * The application registry.
 *
 * An app is a manifest plus a component. Nothing else in the system hard-codes a list of apps:
 * the launcher, the command palette, the taskbar and "open with" all read this, which is what
 * makes adding an app a one-entry change — and what the M3 SDK will extend rather than replace.
 *
 * Components are lazily imported so the desktop shell stays small; opening an app is the moment
 * its code is fetched, not boot.
 */

export interface AppProps {
  windowId: string;
  args: unknown;
}

export interface AppDefinition {
  id: string;
  name: string;
  icon: IconName;
  description: string;
  component: LazyExoticComponent<ComponentType<AppProps>>;
  defaultSize?: { width: number; height: number };
  /** Only ever one window of this app. */
  singleton?: boolean;
  /** Hidden from the launcher; still openable by id. */
  hidden?: boolean;
  /** Whether this app can open a given file, used for "open with" and double-click. */
  opens?: (node: VfsNode) => boolean;
  /** Lower sorts first when several apps can open the same file. */
  openPriority?: number;
}

export const APPS: AppDefinition[] = [
  {
    id: 'files',
    name: 'Files',
    icon: 'folder',
    description: 'Browse, organise and import your files',
    component: lazy(() => import('../apps/files/FilesApp')),
    defaultSize: { width: 940, height: 600 },
  },
  {
    // The id stays 'notes' although the app is called Notepad. It is the key that saved icon
    // positions, hidden-icon lists and restored sessions were written under, so changing it would
    // quietly scatter the arrangement of every desktop that already exists.
    id: 'notes',
    name: 'Notepad',
    icon: 'note',
    description: 'Write and save notes as ordinary Markdown files',
    component: lazy(() => import('../apps/notepad/NotepadApp')),
    defaultSize: { width: 860, height: 600 },
  },
  {
    id: 'paint',
    name: 'Paint',
    icon: 'paint',
    description: 'Draw a picture, or edit one you have',
    component: lazy(() => import('../apps/paint/PaintApp')),
    defaultSize: { width: 900, height: 640 },
    // Listed for "Open with" on every picture, but after Photos: double-clicking a photograph
    // should show it, not open it for editing.
    opens: (node) => node.mime.startsWith('image/'),
    openPriority: 8,
  },
  {
    id: 'photos',
    name: 'Photos',
    icon: 'image',
    description: 'Browse your pictures',
    component: lazy(() => import('../apps/photos/PhotosApp')),
    defaultSize: { width: 960, height: 640 },
    singleton: true,
    opens: (node) => node.mime.startsWith('image/'),
    openPriority: 5,
  },
  {
    id: 'audio',
    name: 'Audio',
    icon: 'music',
    description: 'Play and record audio, with a waveform',
    component: lazy(() => import('../apps/audio/AudioApp')),
    defaultSize: { width: 880, height: 620 },
    opens: (node) => node.mime.startsWith('audio/'),
    openPriority: 5,
  },
  {
    id: 'video',
    name: 'Video',
    icon: 'video',
    description: 'Play video, and cut out a frame or a section',
    component: lazy(() => import('../apps/video/VideoApp')),
    defaultSize: { width: 1000, height: 700 },
    singleton: true,
    opens: (node) => node.mime.startsWith('video/'),
    openPriority: 5,
  },
  {
    // The wastebasket on the desktop is the oldest piece of this metaphor there is, and it was
    // reachable only from a pane inside Files. It is the same view — a mode Files already had —
    // rather than a second implementation of it.
    // The id stays 'trash' although the app is called the Recycle Bin: it is the key a saved icon
    // position and a restored session are written under, and the metaphor is older than either name.
    id: 'trash',
    name: 'Recycle Bin',
    icon: 'trash',
    description: 'Files you have thrown away, until you empty it',
    component: lazy(() => import('../apps/recycle-bin/RecycleBinApp')),
    defaultSize: { width: 940, height: 600 },
    singleton: true,
  },
  {
    id: 'viewer',
    name: 'Viewer',
    icon: 'file-text',
    description: 'Open text, Markdown, images and PDFs',
    component: lazy(() => import('../apps/viewer/ViewerApp')),
    defaultSize: { width: 900, height: 640 },
    hidden: true,
    opens: () => true,
    openPriority: 10,
  },
  {
    // The host that runs installed third-party apps. Hidden: it is never launched directly, only
    // through launchInstalledApp() with the app's id.
    id: 'sandbox',
    name: 'App',
    icon: 'apps',
    description: 'Runs an installed app in a sandbox',
    component: lazy(() => import('../shell/SandboxedApp')),
    defaultSize: { width: 720, height: 520 },
    hidden: true,
  },
  {
    id: 'tasks',
    name: 'Task Manager',
    icon: 'gauge',
    description: 'Apps, background work, performance and network activity',
    component: lazy(() => import('../apps/tasks/TaskManagerApp')),
    defaultSize: { width: 940, height: 620 },
    singleton: true,
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: 'settings',
    description: 'Appearance, indexing, storage and data',
    component: lazy(() => import('../apps/settings/SettingsApp')),
    // Wide enough for the page rail plus a full-measure page beside it; the old 760 predates the
    // rail and would have opened every page 190px narrower than it is laid out for.
    defaultSize: { width: 920, height: 620 },
    singleton: true,
  },
  {
    id: 'about',
    // Keep the id: restored sessions, desktop positions and hidden-icon choices already use it.
    // The old About report grew into the machine-level surface, so this is a rename rather than a
    // second app competing for the same information.
    name: 'My Computer',
    icon: 'computer',
    description: 'System specifications, capabilities and performance',
    component: lazy(() => import('../apps/system-report/SystemReportApp')),
    defaultSize: { width: 960, height: 640 },
    singleton: true,
  },
];

export function getApp(id: string): AppDefinition | undefined {
  return APPS.find((app) => app.id === id);
}

/**
 * A saved session without windows whose app no longer exists.
 *
 * Sessions and setup files outlive the apps they name — Watch and Portfolio were removed with
 * sessions still pointing at them — and a window with no app renders as an empty frame that cannot
 * load anything.
 */
export function withKnownApps(session: WindowSession): WindowSession {
  const windows = session.windows.filter((window) => getApp(window.appId));
  if (windows.length === session.windows.length) return session;
  const focusedId = windows.some((window) => window.id === session.focusedId)
    ? session.focusedId
    : null;
  return { ...session, windows, focusedId };
}

export function launcherApps(): AppDefinition[] {
  return APPS.filter((app) => !app.hidden);
}

/** Apps that can open a file, best first. */
export function appsFor(node: VfsNode): AppDefinition[] {
  return APPS.filter((app) => app.opens?.(node)).sort(
    (a, b) => (a.openPriority ?? 100) - (b.openPriority ?? 100),
  );
}

export interface LaunchOptions {
  args?: unknown;
  title?: string;
}

/** Opens an app in a new window, respecting its manifest. */
export function launchApp(appId: string, options: LaunchOptions = {}): string | null {
  const app = getApp(appId);
  if (!app) return null;

  return openWindow({
    appId: app.id,
    title: options.title ?? app.name,
    ...(options.args !== undefined ? { args: options.args } : {}),
    ...(app.defaultSize ?? {}),
    ...(app.singleton ? { singleton: true } : {}),
  });
}

/**
 * Opens an installed third-party app.
 *
 * Every one of them runs in the same sandbox host; the app's id is an argument rather than a
 * separate registry entry, so installing an app never touches the built-in app list.
 */
export function launchInstalledApp(
  appId: string,
  name: string,
  options: { args?: Record<string, unknown>; size?: { width: number; height: number } } = {},
): string | null {
  return openWindow({
    appId: 'sandbox',
    title: name,
    args: { appId, ...(options.args ?? {}) },
    ...(options.size ?? { width: 720, height: 520 }),
  });
}

/**
 * Opens Files on a search. A query runs as a search inside every file; an empty one just puts the
 * cursor in the search box. This is where the Start menu, the palette and Ctrl+Shift+F all land,
 * so there is one search surface rather than one per entry point.
 */
export function searchFiles(query = ''): string | null {
  return launchApp('files', { args: { search: query }, title: 'Search Results' });
}

/** Opens a file with the best-matching app. Directories open in Files. */
export function openFile(node: VfsNode): string | null {
  if (node.kind === 'directory') {
    return launchApp('files', { args: { directoryId: node.id }, title: node.name });
  }
  const [app] = appsFor(node);
  if (!app) return null;
  return launchApp(app.id, { args: { fileId: node.id }, title: node.name });
}

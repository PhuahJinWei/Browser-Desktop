import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { IconName } from '../shell/Icon';
import type { VfsNode } from './vfs/types';
import { openWindow } from './windows';

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
    id: 'search',
    name: 'Search',
    icon: 'search',
    description: 'Find documents by meaning, not just by name',
    component: lazy(() => import('../apps/search/SearchApp')),
    defaultSize: { width: 820, height: 620 },
    singleton: true,
  },
  {
    id: 'notes',
    name: 'Notes',
    icon: 'note',
    description: 'Write notes that become searchable as you type',
    component: lazy(() => import('../apps/notes/NotesApp')),
    defaultSize: { width: 860, height: 600 },
  },
  {
    id: 'photos',
    name: 'Photos',
    icon: 'image',
    description: 'Find pictures by describing them',
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
    description: 'Play, record and transcribe audio',
    component: lazy(() => import('../apps/audio/AudioApp')),
    defaultSize: { width: 880, height: 620 },
    opens: (node) => node.mime.startsWith('audio/'),
    openPriority: 5,
  },
  {
    id: 'video',
    name: 'Video',
    icon: 'video',
    description: 'Find the moment inside a video by describing it',
    component: lazy(() => import('../apps/video/VideoApp')),
    defaultSize: { width: 1000, height: 700 },
    singleton: true,
    opens: (node) => node.mime.startsWith('video/'),
    openPriority: 5,
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
    description: 'Jobs, models, storage and every network request',
    component: lazy(() => import('../apps/tasks/TaskManagerApp')),
    defaultSize: { width: 820, height: 560 },
    singleton: true,
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: 'settings',
    description: 'Appearance, indexing, storage and data',
    component: lazy(() => import('../apps/settings/SettingsApp')),
    defaultSize: { width: 760, height: 580 },
    singleton: true,
  },
  {
    id: 'about',
    name: 'About',
    icon: 'info',
    description: 'What this machine can do, and how fast',
    component: lazy(() => import('../apps/system-report/SystemReportApp')),
    defaultSize: { width: 960, height: 640 },
    singleton: true,
  },
];

export function getApp(id: string): AppDefinition | undefined {
  return APPS.find((app) => app.id === id);
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

/** Opens a file with the best-matching app. Directories open in Files. */
export function openFile(node: VfsNode): string | null {
  if (node.kind === 'directory') {
    return launchApp('files', { args: { directoryId: node.id }, title: node.name });
  }
  const [app] = appsFor(node);
  if (!app) return null;
  return launchApp(app.id, { args: { fileId: node.id }, title: node.name });
}

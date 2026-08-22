import { idb, openDatabase, transact } from './idb';
import { createStore, useStoreSelector } from './store';
import { notify } from './notifications';
import { clearAppData } from './appHost';
import { revokeAll } from './permissions';
import type { AppManifest } from '../sdk/protocol';
import { AppFormatError, parseApp } from '../sdk/package';

export { AppFormatError, packAppLink, parseApp, unpackAppLink } from '../sdk/package';

/**
 * Installed third-party apps.
 *
 * An app is one file: a JavaScript source with its manifest in a leading comment block. One file
 * means installing is dropping something in, sharing is sending a file, and inspecting before you
 * trust it is opening it in a text editor. There is no package format to learn, no build step to
 * run, and — since there is no backend — nowhere for a registry to live anyway.
 *
 *   /* tabula-app
 *   { "id": "com.example.notes", "name": "Notes", ... }
 *   *\/
 *   os.ui.setTitle('hello');
 */

const DB_NAME = 'tabula-apps';
const DB_VERSION = 1;
const STORE = 'apps';

export interface InstalledApp {
  id: string;
  manifest: AppManifest;
  source: string;
  installedAt: number;
  /** Where it came from, shown in Settings so a user can tell their own apps from imported ones. */
  origin: 'bundled' | 'file' | 'link';
}

interface AppsState {
  apps: InstalledApp[];
  loaded: boolean;
}

const store = createStore<AppsState>({ apps: [], loaded: false });

let database: IDBDatabase | null = null;
async function db(): Promise<IDBDatabase> {
  database ??= await openDatabase(DB_NAME, DB_VERSION, [{ name: STORE, keyPath: 'id' }]);
  return database;
}

/* -------------------------------------------------------------------------------------------- */
/* Store                                                                                          */
/* -------------------------------------------------------------------------------------------- */

export async function loadInstalledApps(): Promise<InstalledApp[]> {
  const handle = await db();
  const apps = await transact(handle, STORE, 'readonly', (tx) =>
    idb.getAll<InstalledApp>(tx.objectStore(STORE)),
  );
  apps.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  store.set({ apps, loaded: true });
  return apps;
}

export async function installApp(
  source: string,
  origin: InstalledApp['origin'] = 'file',
): Promise<InstalledApp> {
  const manifest = parseApp(source);
  if (source.length > 2_000_000) throw new AppFormatError('That app file is too large');

  const record: InstalledApp = {
    id: manifest.id,
    manifest,
    source,
    installedAt: Date.now(),
    origin,
  };

  const handle = await db();
  await transact(handle, STORE, 'readwrite', (tx) => idb.put(tx.objectStore(STORE), record));
  await loadInstalledApps();

  if (origin !== 'bundled') {
    notify({
      title: `Installed ${manifest.name}`,
      body:
        manifest.permissions.length > 0
          ? `Asks for: ${manifest.permissions.join(', ')}. You will be asked before it uses any of them.`
          : 'It asked for no permissions.',
      level: 'success',
    });
  }
  return record;
}

export async function uninstallApp(id: string): Promise<void> {
  const app = getInstalledApp(id);
  const handle = await db();
  await transact(handle, STORE, 'readwrite', (tx) => idb.delete(tx.objectStore(STORE), id));

  // Uninstalling means forgetting everything about it, not just hiding it: permissions, settings,
  // and the cached location of its folder. The folder itself stays — those are the user's files.
  if (app) {
    clearAppData(app.manifest);
    revokeAll(id);
  }
  await loadInstalledApps();
  notify({ title: `Removed ${app?.manifest.name ?? id}`, level: 'info' });
}

export function getInstalledApp(id: string): InstalledApp | undefined {
  return store.get().apps.find((app) => app.id === id);
}

export function listInstalledApps(): InstalledApp[] {
  return store.get().apps;
}

export function useInstalledApps(): InstalledApp[] {
  return useStoreSelector(store, (state) => state.apps);
}

/* -------------------------------------------------------------------------------------------- */
/* Sharing                                                                                        */
/* -------------------------------------------------------------------------------------------- */


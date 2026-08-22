import { notify } from './notifications';
import { requestPermission } from './permissions';
import { closeWindow, setWindowTitle } from './windows';
import { vfs } from './vfs/client';
import { ROOT_ID, type VfsNode } from './vfs/types';
import { capabilityFor, type AppFile, type AppManifest } from '../sdk/protocol';

/**
 * The host side of the app bridge.
 *
 * Everything a sandboxed app is allowed to do passes through here, and every call is checked
 * twice: the capability the method needs must be declared in the manifest *and* granted by the
 * user. Arguments are treated as hostile — this is a stranger's code asking the desktop to act on
 * its behalf.
 *
 * File access is scoped rather than global. An app gets a folder of its own under `Apps/`, and
 * may read exactly two things: what is inside that folder, and the specific file the user opened
 * it with. Granting "read files" should not mean handing over the whole disk.
 */

const APPS_FOLDER = 'Apps';

export interface AppContext {
  manifest: AppManifest;
  windowId: string;
  /** The file the user opened this app with, if any. The one thing outside its folder it may read. */
  openedFileId: string | null;
}

/**
 * Cache of app folder lookups.
 *
 * The **promise** is cached, not the resolved id. Caching the id looked equivalent and was not:
 * two calls arriving before the first finished would both miss the cache, both find no folder,
 * and both create one — which is how an app ended up with "Self Test" and "Self Test (2)".
 * Sharing the in-flight promise means concurrent callers wait for the same creation.
 */
const folderLookups = new Map<string, Promise<string>>();

function appFolder(manifest: AppManifest): Promise<string> {
  const existing = folderLookups.get(manifest.id);
  if (existing) return existing;

  const lookup = (async () => {
    const root = await vfs.list(ROOT_ID);
    const appsFolder =
      root.find((node) => node.kind === 'directory' && node.name === APPS_FOLDER) ??
      (await vfs.createDirectory(ROOT_ID, APPS_FOLDER));

    const children = await vfs.list(appsFolder.id);
    const own =
      children.find((node) => node.kind === 'directory' && node.name === manifest.name) ??
      (await vfs.createDirectory(appsFolder.id, manifest.name));

    return own.id;
  })().catch((error: unknown) => {
    // A failed lookup must not be cached, or the app can never recover.
    folderLookups.delete(manifest.id);
    throw error;
  });

  folderLookups.set(manifest.id, lookup);
  return lookup;
}

/** True when `id` is the app's own folder or something inside it. */
async function isInsideAppFolder(manifest: AppManifest, id: string): Promise<boolean> {
  const folder = await appFolder(manifest);
  if (id === folder) return true;
  const path = await vfs.pathOf(id);
  return path.some((node) => node.id === folder);
}

function toAppFile(node: VfsNode): AppFile {
  return {
    id: node.id,
    name: node.name,
    mime: node.mime,
    size: node.size,
    modifiedAt: node.modifiedAt,
  };
}

/** Arguments arrive from untrusted code, so nothing is assumed about their type. */
function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (value.length > 100_000) throw new Error(`${label} is too long`);
  return value;
}

function asOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, label);
}

export interface HostDependencies {
  embed: (texts: string[]) => Promise<Float32Array[]>;
  search: (query: string, limit: number) => Promise<{ fileId: string; fileName: string; snippet: string; score: number }[]>;
  searchPhotos: (query: string, limit: number) => Promise<{ id: string; name: string; score: number }[]>;
}

/**
 * Handles one call from a sandboxed app.
 *
 * Throws on refusal rather than returning a sentinel: the app sees a rejected promise with a
 * message it can show, and a refusal is never mistaken for an empty result.
 */
export async function handleAppCall(
  context: AppContext,
  method: string,
  args: unknown[],
  deps: HostDependencies,
): Promise<unknown> {
  const capability = capabilityFor(method);
  if (capability === undefined) throw new Error(`Unknown method: ${method}`);

  if (capability !== null) {
    if (!context.manifest.permissions.includes(capability)) {
      throw new Error(`${context.manifest.name} did not declare the "${capability}" permission`);
    }
    const allowed = await requestPermission(context.manifest, capability, method);
    if (!allowed) throw new Error(`Permission denied: ${capability}`);
  }

  switch (method) {
    /* Files ---------------------------------------------------------------------------------- */

    case 'fs.list': {
      const folder = asOptionalString(args[0], 'folder');
      const own = await appFolder(context.manifest);
      const target = folder ?? own;
      if (!(await isInsideAppFolder(context.manifest, target))) {
        throw new Error('An app may only list its own folder');
      }
      return (await vfs.list(target)).map(toAppFile);
    }

    case 'fs.readText':
    case 'fs.readBytes': {
      const id = asString(args[0], 'file id');
      const permitted = id === context.openedFileId || (await isInsideAppFolder(context.manifest, id));
      if (!permitted) {
        throw new Error('An app may only read its own files, or the file it was opened with');
      }
      if (method === 'fs.readText') return vfs.readText(id);
      const { data } = await vfs.read(id);
      return data;
    }

    case 'fs.writeText': {
      const name = asString(args[0], 'name');
      const text = asString(args[1], 'text');
      const folder = await appFolder(context.manifest);
      const node = await vfs.writeText(folder, name, text, { overwrite: true });
      return toAppFile(node);
    }

    case 'fs.createFolder': {
      const name = asString(args[0], 'name');
      const folder = await appFolder(context.manifest);
      return toAppFile(await vfs.createDirectory(folder, name));
    }

    case 'fs.remove': {
      const id = asString(args[0], 'file id');
      if (!(await isInsideAppFolder(context.manifest, id))) {
        throw new Error('An app may only remove its own files');
      }
      await vfs.trash([id]);
      return true;
    }

    /* Intelligence --------------------------------------------------------------------------- */

    case 'ai.embed': {
      const texts = args[0];
      if (!Array.isArray(texts) || texts.some((value) => typeof value !== 'string')) {
        throw new Error('embed expects an array of strings');
      }
      if (texts.length > 64) throw new Error('embed accepts at most 64 strings at a time');
      const vectors = await deps.embed(texts as string[]);
      // Plain arrays cross the boundary: a Float32Array would clone as an opaque object.
      return vectors.map((vector) => [...vector]);
    }

    case 'ai.search': {
      const query = asString(args[0], 'query');
      const limit = Math.min(50, Math.max(1, Number(args[1]) || 10));
      return deps.search(query, limit);
    }

    case 'ai.searchPhotos': {
      const query = asString(args[0], 'query');
      const limit = Math.min(60, Math.max(1, Number(args[1]) || 20));
      return deps.searchPhotos(query, limit);
    }

    /* Window and shell ----------------------------------------------------------------------- */

    case 'ui.notify': {
      const title = asString(args[0], 'title');
      const body = asOptionalString(args[1], 'body');
      notify({
        title: `${context.manifest.name}: ${title.slice(0, 120)}`,
        ...(body ? { body: body.slice(0, 400) } : {}),
        level: 'info',
      });
      return undefined;
    }

    case 'ui.setTitle': {
      const title = asString(args[0], 'title');
      // Prefixed with the app's name so a window cannot impersonate a system one.
      setWindowTitle(context.windowId, `${title.slice(0, 80)} — ${context.manifest.name}`);
      return undefined;
    }

    case 'ui.close':
      closeWindow(context.windowId);
      return undefined;

    case 'clipboard.writeText': {
      const text = asString(args[0], 'text');
      await navigator.clipboard.writeText(text.slice(0, 100_000));
      return undefined;
    }

    /* Per-app storage ------------------------------------------------------------------------ */

    case 'storage.get': {
      const key = asString(args[0], 'key');
      try {
        const raw = localStorage.getItem(`tabula:app:${context.manifest.id}:${key}`);
        return raw === null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    }

    case 'storage.set': {
      const key = asString(args[0], 'key');
      const serialised = JSON.stringify(args[1] ?? null);
      if (serialised.length > 200_000) throw new Error('That value is too large to store');
      localStorage.setItem(`tabula:app:${context.manifest.id}:${key}`, serialised);
      return undefined;
    }

    default:
      throw new Error(`Unhandled method: ${method}`);
  }
}

/** Forgets an app's cached folder and its stored settings. Used when uninstalling. */
export function clearAppData(manifest: AppManifest): void {
  folderLookups.delete(manifest.id);
  const prefix = `tabula:app:${manifest.id}:`;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(prefix)) localStorage.removeItem(key);
  }
}

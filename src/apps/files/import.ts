import type { ImportEntry } from '../../kernel/vfs/types';
import { guessMime } from '../../kernel/vfs/types';

/**
 * Getting files into the desktop.
 *
 * Three routes, because no single one works everywhere:
 *
 *  - **Drag and drop** works in every browser, and `webkitGetAsEntry` walks dropped folders.
 *  - **A file picker** (`<input type=file>`) is the universal fallback, including on mobile.
 *  - **`showDirectoryPicker`** is Chromium-only; Firefox and Safari ship no local-disk picker at
 *    all, only the origin-private file system.
 *
 * Whichever route is used, bytes are copied into OPFS rather than referenced in place — the only
 * behaviour that is identical across browsers and survives going offline.
 */

/** Files this size are refused rather than hashed: `crypto.subtle` needs the whole buffer. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

async function toEntry(file: File, path: string): Promise<ImportEntry | null> {
  if (file.size > MAX_FILE_BYTES) return null;
  return {
    path,
    data: await file.arrayBuffer(),
    mime: file.type || guessMime(file.name),
    modifiedAt: file.lastModified,
  };
}

/** Recursively walks a dropped directory. Depth-limited against pathological trees. */
async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  collected: ImportEntry[],
  depth = 0,
): Promise<void> {
  if (depth > 12) return;

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    const imported = await toEntry(file, `${prefix}${entry.name}`);
    if (imported) collected.push(imported);
    return;
  }

  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();

  // readEntries returns at most 100 at a time and signals the end with an empty array.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    for (const child of batch) {
      await walkEntry(child, `${prefix}${entry.name}/`, collected, depth + 1);
    }
  }
}

export async function collectDroppedEntries(transfer: DataTransfer): Promise<ImportEntry[]> {
  const collected: ImportEntry[] = [];

  // The item list must be read synchronously: it is emptied once the drop event returns.
  const entries: FileSystemEntry[] = [];
  const plainFiles: File[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) plainFiles.push(file);
    }
  }

  for (const entry of entries) await walkEntry(entry, '', collected);
  for (const file of plainFiles) {
    const imported = await toEntry(file, file.name);
    if (imported) collected.push(imported);
  }

  // Some browsers expose only `files` for a plain multi-file drop.
  if (collected.length === 0) {
    for (const file of Array.from(transfer.files)) {
      const imported = await toEntry(file, file.name);
      if (imported) collected.push(imported);
    }
  }

  return collected;
}

/** Opens the file picker. Works everywhere. */
export function pickFiles(): Promise<ImportEntry[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';

    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? []);
      const entries: ImportEntry[] = [];
      for (const file of files) {
        const imported = await toEntry(file, file.name);
        if (imported) entries.push(imported);
      }
      input.remove();
      resolve(entries);
    });
    // A cancelled picker must not leave the caller waiting forever.
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });

    document.body.append(input);
    input.click();
  });
}

interface DirectoryPicker {
  (): Promise<ImportEntry[]>;
  supported: boolean;
}

interface DirectoryHandleLike {
  name: string;
  entries: () => AsyncIterableIterator<[string, DirectoryHandleLike | FileHandleLike]>;
  kind: 'directory' | 'file';
}
interface FileHandleLike {
  kind: 'file' | 'directory';
  getFile: () => Promise<File>;
}

async function walkHandle(
  handle: DirectoryHandleLike,
  prefix: string,
  collected: ImportEntry[],
  depth = 0,
): Promise<void> {
  if (depth > 12) return;
  for await (const [name, child] of handle.entries()) {
    if (child.kind === 'directory') {
      await walkHandle(child as DirectoryHandleLike, `${prefix}${name}/`, collected, depth + 1);
    } else {
      const file = await (child as FileHandleLike).getFile();
      const imported = await toEntry(file, `${prefix}${name}`);
      if (imported) collected.push(imported);
    }
  }
}

/**
 * Chromium's folder picker. Absent in Firefox and Safari, which is why the button that uses it is
 * hidden rather than shown broken.
 */
export const pickDirectory: DirectoryPicker = Object.assign(
  async (): Promise<ImportEntry[]> => {
    const picker = (
      globalThis as unknown as {
        showDirectoryPicker?: (options?: { mode?: string }) => Promise<DirectoryHandleLike>;
      }
    ).showDirectoryPicker;
    if (!picker) return [];

    try {
      const handle = await picker({ mode: 'read' });
      const collected: ImportEntry[] = [];
      await walkHandle(handle, `${handle.name}/`, collected);
      return collected;
    } catch {
      // The user dismissed the picker.
      return [];
    }
  },
  {
    supported:
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
  },
);

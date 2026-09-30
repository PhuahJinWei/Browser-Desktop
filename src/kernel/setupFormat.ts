import type { IconCell, Settings } from './settings';
import type { WindowSession } from './windows';

/**
 * The shape of a desktop setup file, and the rules for reading one back.
 *
 * Separated from the code that writes and applies it because this half is pure: given a string it
 * either yields a setup or throws, with no file system, no download and no store to mutate. That
 * is what makes it testable, and this is the half that has to be right — everything in the file is
 * untrusted input, the same as every other file this desktop parses.
 */

export const SETUP_FORMAT = 'tabula.desktop-setup';
export const SETUP_VERSION = 1;

/** The settings that describe a desktop, rather than the state of one particular visit. */
export const PORTABLE_KEYS = [
  'skin',
  'classicCursors',
  'accent',
  'fontScale',
  'motion',
  'wallpaper',
  'wallpaperFit',
  'backend',
  'autoIndex',
  'restoreSession',
  'iconPositions',
  'hiddenIcons',
] as const;

type PortableKey = (typeof PORTABLE_KEYS)[number];
export type PortableSettings = Partial<Pick<Settings, PortableKey>>;

export interface DesktopSetup {
  format: typeof SETUP_FORMAT;
  version: number;
  exportedAt: string;
  settings: PortableSettings;
  /** Open windows and their geometry. Omitted unless asked for. */
  session?: WindowSession;
  /** The wallpaper travels as bytes, because a node id means nothing on another machine. */
  wallpaper?: { name: string; mime: string; dataBase64: string };
}

/**
 * Reads a setup file.
 *
 * All of this is untrusted input — it is a file, and files are parsed defensively everywhere else
 * in this system too. Nothing is spread into the settings store: each field is checked against the
 * values it is allowed to have, and anything unrecognised is dropped rather than carried through.
 */
export function parseSetup(raw: string): DesktopSetup {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('That file does not contain a desktop setup.');
  if (parsed['format'] !== SETUP_FORMAT) {
    throw new Error('That is not a Tabula desktop setup file.');
  }
  const version = parsed['version'];
  if (typeof version !== 'number' || version > SETUP_VERSION) {
    throw new Error('That setup was written by a newer version of Tabula.');
  }

  const setup: DesktopSetup = {
    format: SETUP_FORMAT,
    version,
    exportedAt: typeof parsed['exportedAt'] === 'string' ? parsed['exportedAt'] : '',
    settings: cleanSettings(parsed['settings']),
  };

  const session = cleanSession(parsed['session']);
  if (session) setup.session = session;

  const wallpaper = parsed['wallpaper'];
  if (
    isRecord(wallpaper) &&
    typeof wallpaper['dataBase64'] === 'string' &&
    typeof wallpaper['mime'] === 'string' &&
    wallpaper['mime'].startsWith('image/')
  ) {
    setup.wallpaper = {
      name: typeof wallpaper['name'] === 'string' ? safeName(wallpaper['name']) : 'Wallpaper',
      mime: wallpaper['mime'],
      dataBase64: wallpaper['dataBase64'],
    };
  }

  return setup;
}

/* -------------------------------------------------------------------------------------------- */
/* Validation                                                                                     */
/* -------------------------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends readonly unknown[]>(value: unknown, allowed: T): value is T[number] {
  return allowed.includes(value);
}

function cleanSettings(input: unknown): PortableSettings {
  if (!isRecord(input)) return {};
  const out: PortableSettings = {};

  if (oneOf(input['skin'], ['modern', 'classic'] as const)) out.skin = input['skin'];
  if (typeof input['classicCursors'] === 'boolean') out.classicCursors = input['classicCursors'];
  if (oneOf(input['accent'], ['blue', 'teal', 'indigo', 'amber', 'rose'] as const)) {
    out.accent = input['accent'];
  }
  if (oneOf(input['fontScale'], [0.9, 1, 1.1, 1.25] as const)) out.fontScale = input['fontScale'];
  if (oneOf(input['motion'], ['system', 'reduced', 'full'] as const)) out.motion = input['motion'];
  if (oneOf(input['wallpaper'], ['bloom', 'aurora', 'grid', 'plain', 'dusk', 'custom'] as const)) {
    out.wallpaper = input['wallpaper'];
  }
  if (oneOf(input['wallpaperFit'], ['cover', 'contain', 'tile', 'center'] as const)) {
    out.wallpaperFit = input['wallpaperFit'];
  }
  if (oneOf(input['backend'], ['auto', 'webgpu', 'wasm'] as const)) out.backend = input['backend'];
  if (typeof input['autoIndex'] === 'boolean') out.autoIndex = input['autoIndex'];
  if (typeof input['restoreSession'] === 'boolean') out.restoreSession = input['restoreSession'];

  const positions = cleanIconPositions(input['iconPositions']);
  if (positions) out.iconPositions = positions;

  const hidden = input['hiddenIcons'];
  if (Array.isArray(hidden)) {
    out.hiddenIcons = hidden
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64)
      .slice(0, 64);
  }

  return out;
}

function cleanIconPositions(input: unknown): Record<string, IconCell> | null {
  if (!isRecord(input)) return null;
  const out: Record<string, IconCell> = {};

  for (const [id, cell] of Object.entries(input).slice(0, 128)) {
    if (id.length > 64 || !isRecord(cell)) continue;
    const col = cell['col'];
    const row = cell['row'];
    if (typeof col !== 'number' || typeof row !== 'number') continue;
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    out[id] = {
      col: Math.min(255, Math.max(0, Math.round(col))),
      row: Math.min(255, Math.max(0, Math.round(row))),
    };
  }

  return out;
}

const SNAP_ZONES = [
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'maximized',
] as const;

function cleanSession(input: unknown): WindowSession | null {
  if (!isRecord(input) || !Array.isArray(input['windows'])) return null;

  const windows = input['windows']
    .filter(isRecord)
    .filter((window) => typeof window['id'] === 'string' && typeof window['appId'] === 'string')
    .slice(0, 32)
    .map((window) => ({
      id: String(window['id']).slice(0, 64),
      appId: String(window['appId']).slice(0, 64),
      title: typeof window['title'] === 'string' ? window['title'].slice(0, 200) : 'Window',
      ...(window['args'] !== undefined ? { args: window['args'] } : {}),
      x: finite(window['x'], 40),
      y: finite(window['y'], 40),
      width: finite(window['width'], 880),
      height: finite(window['height'], 560),
      minimized: window['minimized'] === true,
      snap: oneOf(window['snap'], SNAP_ZONES) ? window['snap'] : null,
      restore: null,
    }));

  if (windows.length === 0) return null;
  return {
    windows,
    focusedId: typeof input['focusedId'] === 'string' ? input['focusedId'] : null,
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-10000, Math.min(20000, Math.round(value)))
    : fallback;
}

/** Strips anything that would turn a name into a path. Names are per-directory, not routes. */
function safeName(name: string): string {
  return name.replace(/[/\\]/g, '-').slice(0, 120) || 'Wallpaper';
}

/* -------------------------------------------------------------------------------------------- */
/* Base64                                                                                         */
/* -------------------------------------------------------------------------------------------- */

/** Chunked: `String.fromCharCode(...bytes)` blows the argument limit on a megabyte-sized image. */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

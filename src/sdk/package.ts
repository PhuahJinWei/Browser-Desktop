import type { AppManifest, Capability } from './protocol';

/**
 * The app file format: parsing, validation and link packing.
 *
 * Deliberately free of any dependency on the desktop — no file system, no workers, no DOM beyond
 * the encoding helpers. That keeps it testable on its own, and means the same code could validate
 * an app file anywhere it needs checking.
 *
 * Everything here parses untrusted input, so it validates rather than trusts: an unrecognised
 * permission is an error, not something to ignore, and an id is constrained so it can neither
 * collide with a built-in app nor escape a storage key prefix.
 */

const KNOWN_CAPABILITIES: Capability[] = [
  'fs:read',
  'fs:write',
  'ai:embed',
  'ai:search',
  'notifications',
  'clipboard',
  'storage',
];

export class AppFormatError extends Error {}

/**
 * Reads the manifest out of an app file.
 *
 * Validated strictly, because everything here is attacker-controlled: an unknown capability is
 * rejected rather than ignored, so a typo cannot silently become "no permission needed", and an
 * id is constrained so it cannot collide with a built-in app or escape a storage key prefix.
 */
export function parseApp(source: string): AppManifest {
  const match = /\/\*\s*tabula-app\s*([\s\S]*?)\*\//.exec(source);
  if (!match?.[1]) {
    throw new AppFormatError('No manifest found. An app starts with a /* tabula-app … */ block.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch (error) {
    throw new AppFormatError(
      `The manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const raw = parsed as Partial<AppManifest>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!/^[a-z0-9][a-z0-9.-]{2,63}$/i.test(id)) {
    throw new AppFormatError('id must be 3–64 characters of letters, digits, dots or hyphens');
  }
  if (!raw.name || typeof raw.name !== 'string' || raw.name.length > 40) {
    throw new AppFormatError('name is required and must be at most 40 characters');
  }

  const permissions = Array.isArray(raw.permissions) ? raw.permissions : [];
  for (const permission of permissions) {
    if (!KNOWN_CAPABILITIES.includes(permission as Capability)) {
      throw new AppFormatError(`Unknown permission: ${String(permission)}`);
    }
  }

  // A window that keeps one size may be smaller than one the user can resize: it is drawn for that
  // size. Either way the bounds keep it on a screen and big enough to hold a title bar.
  const fixed = raw.resizable === false;
  const size = (input: unknown): { width: number; height: number } | null => {
    if (!input || typeof input !== 'object') return null;
    const { width, height } = input as { width?: unknown; height?: unknown };
    return {
      width: Math.min(1600, Math.max(fixed ? 160 : 320, Number(width) || 640)),
      height: Math.min(1200, Math.max(fixed ? 120 : 200, Number(height) || 480)),
    };
  };
  const defaultSize = size(raw.defaultSize);
  const skins = raw.skinSizes && typeof raw.skinSizes === 'object' ? raw.skinSizes : {};
  const classicSize = size((skins as { classic?: unknown }).classic);
  const modernSize = size((skins as { modern?: unknown }).modern);

  return {
    id,
    name: raw.name,
    version: typeof raw.version === 'string' ? raw.version.slice(0, 20) : '0.0.0',
    description:
      typeof raw.description === 'string' ? raw.description.slice(0, 200) : 'No description',
    ...(typeof raw.author === 'string' ? { author: raw.author.slice(0, 60) } : {}),
    permissions: permissions as Capability[],
    ...(Array.isArray(raw.handles) ? { handles: raw.handles.slice(0, 20).map(String) } : {}),
    ...(defaultSize ? { defaultSize } : {}),
    ...(classicSize || modernSize
      ? {
          skinSizes: {
            ...(classicSize ? { classic: classicSize } : {}),
            ...(modernSize ? { modern: modernSize } : {}),
          },
        }
      : {}),
    ...(fixed ? { resizable: false } : {}),
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Sharing                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/**
 * Packs an app into a URL fragment.
 *
 * The fragment is the only part of a URL a browser never sends to a server, which is what makes
 * this a way to share an app without a backend: the code travels in the link itself and reaches
 * nobody but the person who opens it.
 *
 * Practical limit is a few tens of kilobytes before browsers and chat clients start truncating —
 * enough for a small app, and the length is reported so the caller can say when it is not.
 */
export function packAppLink(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#app=${encoded}`;
}

export function unpackAppLink(fragment: string): string | null {
  const match = /[#&]app=([A-Za-z0-9\-_]+)/.exec(fragment);
  if (!match?.[1]) return null;
  try {
    const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

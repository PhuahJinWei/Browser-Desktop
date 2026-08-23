import { createStore, useStoreSelector } from './store';
import type { WindowSession } from './windows';

/**
 * Settings, persisted synchronously.
 *
 * localStorage rather than IndexedDB on purpose: the theme has to be known before the first paint,
 * and an async read means a flash of the wrong colours. The payload is a few hundred bytes.
 *
 * Storage keys are namespaced because every GitHub Pages project site shares one origin
 * (`<user>.github.io`), so a neighbouring project would otherwise collide with this one.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type MotionPreference = 'system' | 'reduced' | 'full';
export type BackendPreference = 'auto' | 'webgpu' | 'wasm';
export type WallpaperPreference = 'aurora' | 'grid' | 'plain' | 'dusk' | 'custom';
export type WallpaperFit = 'cover' | 'contain' | 'tile' | 'center';

/** Where a desktop icon sits, in grid cells rather than pixels — see `desktop.ts`. */
export interface IconCell {
  col: number;
  row: number;
}

export interface Settings {
  theme: ThemePreference;
  accent: 'teal' | 'indigo' | 'amber' | 'rose';
  fontScale: 0.9 | 1 | 1.1 | 1.25;
  motion: MotionPreference;
  wallpaper: WallpaperPreference;
  /** How a custom wallpaper image fills the desktop. Ignored by the built-in wallpapers. */
  wallpaperFit: WallpaperFit;
  /** VFS node of the image used when `wallpaper` is `custom`; the wallpaper is a file you have. */
  wallpaperFileId: string | null;
  backend: BackendPreference;
  /** Index files in the background as they arrive. Off means search only covers what is indexed. */
  autoIndex: boolean;
  restoreSession: boolean;
  /** Manually placed desktop icons, by app id. Absent ids flow into the first free cell. */
  iconPositions: Record<string, IconCell>;
  /** Apps the user removed from the desktop. They stay in the launcher and the palette. */
  hiddenIcons: string[];
  sampleDataLoaded: boolean;
  welcomeDismissed: boolean;
  /** The small-screen notice has been read once; do not show it again. */
  limitedNoticeDismissed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: 'teal',
  fontScale: 1,
  motion: 'system',
  wallpaper: 'aurora',
  wallpaperFit: 'cover',
  wallpaperFileId: null,
  backend: 'auto',
  autoIndex: true,
  restoreSession: true,
  iconPositions: {},
  hiddenIcons: [],
  sampleDataLoaded: false,
  welcomeDismissed: false,
  limitedNoticeDismissed: false,
};

const SETTINGS_KEY = 'tabula:settings';
const SESSION_KEY = 'tabula:session';

function read(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge over defaults so a settings file written by an older build stays valid.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = createStore<Settings>(
  typeof localStorage === 'undefined' ? DEFAULT_SETTINGS : read(),
);

export function updateSettings(patch: Partial<Settings>): void {
  settingsStore.set((current) => {
    const next = { ...current, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* Private mode or a full quota: the session still works, it just will not be remembered. */
    }
    return next;
  });
}

export function resetSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    /* Nothing to undo. */
  }
  settingsStore.set(DEFAULT_SETTINGS);
}

export function useSettings(): Settings {
  return useStoreSelector(settingsStore, (state) => state);
}

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useStoreSelector(settingsStore, (state) => state[key]);
}

/* -------------------------------------------------------------------------------------------- */
/* Session                                                                                        */
/* -------------------------------------------------------------------------------------------- */

export function saveSession(session: WindowSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* Not worth interrupting the user over. */
  }
}

export function loadSession(): WindowSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WindowSession;
    return Array.isArray(parsed.windows) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* Nothing to undo. */
  }
}

/* -------------------------------------------------------------------------------------------- */
/* Applying settings to the document                                                              */
/* -------------------------------------------------------------------------------------------- */

/**
 * Reflects settings onto the root element as data attributes and variables, so CSS does the work.
 * Called once at boot and on every change.
 */
export function applySettings(settings: Settings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.dataset['theme'] = settings.theme;
  root.dataset['accent'] = settings.accent;
  root.dataset['wallpaper'] = settings.wallpaper;
  root.dataset['motion'] = settings.motion;
  root.style.setProperty('--font-scale', String(settings.fontScale));

  // `color-scheme` drives form controls, scrollbars and the default canvas colour.
  root.style.colorScheme =
    settings.theme === 'system' ? 'dark light' : settings.theme === 'dark' ? 'dark' : 'light';
}

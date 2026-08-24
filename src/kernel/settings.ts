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

/**
 * The visual skin, which is a different axis from light/dark.
 *
 * `modern` is this project's own design language. `classic` is a 1990s desktop: square corners,
 * two-tone bevels, one grey. It is era-inspired rather than an impersonation — no vendor's logos,
 * wordmarks, icons or fonts — because the goal is the contrast between an old face and new
 * machinery, and cloning someone's shell would trade that for a lawsuit.
 *
 * Classic defines its own complete palette, so `theme` has no effect while it is on; 1995 did not
 * have a dark mode and pretending otherwise would look like neither.
 *
 * Classic is the default. Modern is one switch away, and nothing about it changed to make room.
 */
export type SkinPreference = 'modern' | 'classic';
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
  skin: SkinPreference;
  accent: 'teal' | 'indigo' | 'amber' | 'rose';
  fontScale: 0.9 | 1 | 1.1 | 1.25;
  motion: MotionPreference;
  wallpaper: WallpaperPreference;
  /** How a custom wallpaper image fills the desktop. Ignored by the built-in wallpapers. */
  wallpaperFit: WallpaperFit;
  /** VFS node of the image used when `wallpaper` is `custom`; the wallpaper is a file you have. */
  wallpaperFileId: string | null;
  /**
   * Draw the era's own pointers while the classic skin is on. Ignored by the modern skin.
   *
   * Worth a switch rather than following the skin outright, because a custom cursor is the one part
   * of a skin that overrides an operating-system accessibility setting: a pointer enlarged for low
   * vision is replaced by ours at our size, and CSS cannot detect that it was enlarged. This is the
   * escape hatch, and it is the reason the pointers are a preference at all.
   */
  classicCursors: boolean;
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
  /**
   * Watch may load a frame from youtube-nocookie.com. False until the consent card is accepted,
   * and set back to false by Settings, which is what makes the consent reversible rather than
   * a one-way door.
   */
  watchConsent: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  skin: 'classic',
  accent: 'teal',
  fontScale: 1,
  motion: 'system',
  wallpaper: 'aurora',
  wallpaperFit: 'cover',
  wallpaperFileId: null,
  classicCursors: true,
  backend: 'auto',
  autoIndex: true,
  restoreSession: true,
  iconPositions: {},
  hiddenIcons: [],
  sampleDataLoaded: false,
  welcomeDismissed: false,
  limitedNoticeDismissed: false,
  watchConsent: false,
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
  root.dataset['skin'] = settings.skin;
  root.dataset['accent'] = settings.accent;
  root.dataset['wallpaper'] = settings.wallpaper;
  root.dataset['motion'] = settings.motion;
  // One attribute rather than two conditions in the stylesheet: the pointers are on only when the
  // classic skin is on *and* they have not been switched off, and CSS should not have to know that.
  root.dataset['cursors'] =
    settings.skin === 'classic' && settings.classicCursors ? 'classic' : 'system';
  root.style.setProperty('--font-scale', String(settings.fontScale));

  // `color-scheme` drives form controls, scrollbars and the default canvas colour. Classic
  // supplies its own light palette whatever the theme says, so it must not be told 'dark'.
  // 'dark light' rather than a resolved value, so the UA keeps following the OS by itself.
  root.style.colorScheme =
    settings.skin === 'classic'
      ? 'light'
      : settings.theme === 'system'
        ? 'dark light'
        : settings.theme === 'dark'
          ? 'dark'
          : 'light';

  // The browser's own chrome tint, which takes a colour rather than a pair and so has to be
  // resolved here. index.html ships the classic grey, so the frame painted before this function
  // exists is already right; from here it follows what is actually on screen.
  const dark =
    settings.skin !== 'classic' &&
    (settings.theme === 'dark' ||
      (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      settings.skin === 'classic' ? '#c0c0c0' : dark ? '#0b0d10' : '#f6f7f9',
    );
}

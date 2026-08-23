import { createStore, useStoreSelector } from './store';

/**
 * Window manager.
 *
 * State only — no DOM, no React. That separation is what lets the drag loop bypass React entirely
 * (see WindowFrame: pointer moves write transforms straight to the element and commit once on
 * release) while every other consumer, from the taskbar to session restore, reads plain data.
 *
 * Geometry is stored in CSS pixels relative to the desktop area, excluding the taskbar.
 */

export type SnapZone =
  'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'maximized';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends Rect {
  id: string;
  appId: string;
  title: string;
  /** Arbitrary launch argument, e.g. which file a viewer opened. */
  args?: unknown;
  minimized: boolean;
  snap: SnapZone | null;
  /** Geometry to return to when unsnapping or unmaximising. */
  restore: Rect | null;
  zIndex: number;
}

export interface WindowManagerState {
  windows: WindowState[];
  focusedId: string | null;
  nextZ: number;
  /** Size of the area windows live in; snapping and clamping are relative to it. */
  viewport: { width: number; height: number };
  /**
   * Whether `viewport` is a measurement or still the placeholder below.
   *
   * The distinction matters exactly once, at boot: session restore has to place windows against
   * the real desktop, and a plausible-looking default is worse than an obviously absent one —
   * it passes every "is this sensible?" check while being wrong on any screen that is not 1280
   * wide. The placeholder is kept rather than zeroed because geometry helpers still have to
   * produce something usable if a window is opened before the desktop has been measured.
   */
  viewportMeasured: boolean;
}

export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 200;

/**
 * Below this width, windows stop overlapping and open maximised instead.
 *
 * Two half-snapped windows at this text size are already unusable at 720 px; below it, a cascade
 * of floating windows is a worse way to show one thing at a time than simply showing one thing at
 * a time. The window manager is still here — the title bar, the taskbar and the switcher all work
 * — it just stops pretending there is room to arrange anything.
 */
export const COMPACT_VIEWPORT = 720;

const initialState: WindowManagerState = {
  windows: [],
  focusedId: null,
  nextZ: 1,
  viewport: { width: 1280, height: 800 },
  viewportMeasured: false,
};

export const windowStore = createStore<WindowManagerState>(initialState);

/* -------------------------------------------------------------------------------------------- */
/* Geometry                                                                                       */
/* -------------------------------------------------------------------------------------------- */

export function snapRect(zone: SnapZone, viewport: { width: number; height: number }): Rect {
  const { width, height } = viewport;
  const half = Math.round(width / 2);
  const halfHeight = Math.round(height / 2);
  switch (zone) {
    case 'maximized':
      return { x: 0, y: 0, width, height };
    case 'left':
      return { x: 0, y: 0, width: half, height };
    case 'right':
      return { x: width - half, y: 0, width: half, height };
    case 'top-left':
      return { x: 0, y: 0, width: half, height: halfHeight };
    case 'top-right':
      return { x: width - half, y: 0, width: half, height: halfHeight };
    case 'bottom-left':
      return { x: 0, y: height - halfHeight, width: half, height: halfHeight };
    case 'bottom-right':
      return { x: width - half, y: height - halfHeight, width: half, height: halfHeight };
  }
}

/**
 * Keeps a window reachable after a viewport change.
 *
 * The rule is deliberately not "keep it fully on screen": dragging a window mostly off the right
 * edge is legitimate. What must never happen is losing the title bar, because that is the only
 * way to drag it back.
 */
export function clampToViewport(rect: Rect, viewport: { width: number; height: number }): Rect {
  const width = Math.max(MIN_WIDTH, Math.min(rect.width, viewport.width));
  const height = Math.max(MIN_HEIGHT, Math.min(rect.height, viewport.height));
  const titleBarSafety = 120;
  return {
    width,
    height,
    x: Math.max(titleBarSafety - width, Math.min(rect.x, viewport.width - titleBarSafety)),
    y: Math.max(0, Math.min(rect.y, viewport.height - 36)),
  };
}

/** Offsets each new window so a stack of them stays individually clickable. */
function cascade(
  count: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): Rect {
  const step = 28;
  const offset = (count % 8) * step;
  const width = Math.min(size.width, Math.max(MIN_WIDTH, viewport.width - 40));
  const height = Math.min(size.height, Math.max(MIN_HEIGHT, viewport.height - 40));
  return {
    width,
    height,
    x: Math.round(Math.max(0, (viewport.width - width) / 2 - 80) + offset),
    y: Math.round(Math.max(0, (viewport.height - height) / 2 - 60) + offset),
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Operations                                                                                     */
/* -------------------------------------------------------------------------------------------- */

export interface OpenWindowOptions {
  appId: string;
  title: string;
  args?: unknown;
  width?: number;
  height?: number;
  /** Reuse an existing window of this app instead of opening a second one. */
  singleton?: boolean;
}

let windowCounter = 0;

export function openWindow(options: OpenWindowOptions): string {
  const state = windowStore.get();

  if (options.singleton) {
    const existing = state.windows.find((window) => window.appId === options.appId);
    if (existing) {
      focusWindow(existing.id);
      if (options.args !== undefined) {
        windowStore.set((current) => ({
          ...current,
          windows: current.windows.map((window) =>
            window.id === existing.id
              ? { ...window, args: options.args, title: options.title, minimized: false }
              : window,
          ),
        }));
      }
      return existing.id;
    }
  }

  const id = `win-${++windowCounter}`;
  const rect = cascade(
    state.windows.length,
    { width: options.width ?? 880, height: options.height ?? 560 },
    state.viewport,
  );

  const compact = state.viewport.width <= COMPACT_VIEWPORT;
  const geometry = compact
    ? snapRect('maximized', state.viewport)
    : clampToViewport(rect, state.viewport);

  const window: WindowState = {
    id,
    appId: options.appId,
    title: options.title,
    ...(options.args !== undefined ? { args: options.args } : {}),
    ...geometry,
    minimized: false,
    snap: compact ? 'maximized' : null,
    // What the app asked for, not what it would have been squeezed into here: the size worth
    // remembering on a phone is the one that makes sense on the screen it might be restored to.
    restore: compact
      ? { x: rect.x, y: rect.y, width: options.width ?? 880, height: options.height ?? 560 }
      : null,
    zIndex: state.nextZ,
  };

  windowStore.set((current) => ({
    ...current,
    windows: [...current.windows, window],
    focusedId: id,
    nextZ: current.nextZ + 1,
  }));
  return id;
}

export function closeWindow(id: string): void {
  windowStore.set((current) => {
    const windows = current.windows.filter((window) => window.id !== id);
    const focusedId =
      current.focusedId === id
        ? // Focus the top-most remaining window, which is what a user expects after closing.
          (windows.reduce<WindowState | null>(
            (top, window) =>
              window.minimized ? top : !top || window.zIndex > top.zIndex ? window : top,
            null,
          )?.id ?? null)
        : current.focusedId;
    return { ...current, windows, focusedId };
  });
}

export function focusWindow(id: string): void {
  windowStore.set((current) => {
    const target = current.windows.find((window) => window.id === id);
    if (!target) return current;
    if (current.focusedId === id && !target.minimized) return current;
    return {
      ...current,
      focusedId: id,
      nextZ: current.nextZ + 1,
      windows: current.windows.map((window) =>
        window.id === id ? { ...window, zIndex: current.nextZ, minimized: false } : window,
      ),
    };
  });
}

export function setWindowRect(id: string, rect: Partial<Rect>): void {
  windowStore.set((current) => ({
    ...current,
    windows: current.windows.map((window) =>
      window.id === id
        ? { ...window, ...clampToViewport({ ...window, ...rect }, current.viewport), snap: null }
        : window,
    ),
  }));
}

export function setWindowTitle(id: string, title: string): void {
  windowStore.set((current) => ({
    ...current,
    windows: current.windows.map((window) => (window.id === id ? { ...window, title } : window)),
  }));
}

export function setWindowArgs(id: string, args: unknown): void {
  windowStore.set((current) => ({
    ...current,
    windows: current.windows.map((window) => (window.id === id ? { ...window, args } : window)),
  }));
}

export function minimizeWindow(id: string): void {
  windowStore.set((current) => {
    const windows = current.windows.map((window) =>
      window.id === id ? { ...window, minimized: true } : window,
    );
    const next = windows
      .filter((window) => !window.minimized)
      .reduce<WindowState | null>(
        (top, window) => (!top || window.zIndex > top.zIndex ? window : top),
        null,
      );
    return {
      ...current,
      windows,
      focusedId: current.focusedId === id ? (next?.id ?? null) : current.focusedId,
    };
  });
}

export function snapWindow(id: string, zone: SnapZone | null): void {
  windowStore.set((current) => ({
    ...current,
    windows: current.windows.map((window) => {
      if (window.id !== id) return window;

      if (zone === null) {
        // Unsnap: go back to the pre-snap geometry, or a sensible default if there is none.
        const restore = window.restore ?? {
          x: Math.round(current.viewport.width / 2 - 440),
          y: Math.round(current.viewport.height / 2 - 280),
          width: 880,
          height: 560,
        };
        return {
          ...window,
          ...clampToViewport(restore, current.viewport),
          snap: null,
          restore: null,
        };
      }

      const rect = snapRect(zone, current.viewport);
      return {
        ...window,
        ...rect,
        snap: zone,
        // Remember the free geometry only on the first snap, so snap-to-snap keeps the original.
        restore:
          window.restore ??
          ({ x: window.x, y: window.y, width: window.width, height: window.height } satisfies Rect),
        minimized: false,
      };
    }),
  }));
}

export function toggleMaximize(id: string): void {
  const window = windowStore.get().windows.find((candidate) => candidate.id === id);
  if (!window) return;
  snapWindow(id, window.snap === 'maximized' ? null : 'maximized');
}

/**
 * Re-flows windows after the desktop area changes size, keeping snapped ones snapped.
 *
 * Only ever called with a real measurement, which is what makes it the place that flips
 * `viewportMeasured`. Note the flag in the early return: a desktop that genuinely measures
 * 1280x800 must still count as measured, or it would be the one screen size where session
 * restore waits forever.
 */
export function setViewport(viewport: { width: number; height: number }): void {
  windowStore.set((current) => {
    if (
      current.viewportMeasured &&
      current.viewport.width === viewport.width &&
      current.viewport.height === viewport.height
    ) {
      return current;
    }
    return {
      ...current,
      viewport,
      viewportMeasured: true,
      windows: current.windows.map((window) =>
        window.snap
          ? { ...window, ...snapRect(window.snap, viewport) }
          : { ...window, ...clampToViewport(window, viewport) },
      ),
    };
  });
}

/** Cycles focus through non-minimised windows, most recently used first. */
export function cycleFocus(direction: 1 | -1 = 1): void {
  const { windows, focusedId } = windowStore.get();
  const ordered = windows.filter((window) => !window.minimized).sort((a, b) => b.zIndex - a.zIndex);
  if (ordered.length === 0) return;

  const index = ordered.findIndex((window) => window.id === focusedId);
  const next = ordered[(index + direction + ordered.length) % ordered.length] ?? ordered[0]!;
  focusWindow(next.id);
}

export function closeAllWindows(): void {
  windowStore.set((current) => ({ ...current, windows: [], focusedId: null }));
}

/* -------------------------------------------------------------------------------------------- */
/* Session persistence                                                                            */
/* -------------------------------------------------------------------------------------------- */

export interface WindowSession {
  windows: Omit<WindowState, 'zIndex'>[];
  focusedId: string | null;
}

export function serializeSession(): WindowSession {
  const { windows, focusedId } = windowStore.get();
  return {
    // Sorted by z so restoring in order rebuilds the stack without storing raw indices.
    windows: [...windows]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map(({ zIndex: _zIndex, ...rest }) => rest),
    focusedId,
  };
}

export function restoreSession(
  session: WindowSession,
  viewport: { width: number; height: number },
): void {
  windowCounter = Math.max(
    windowCounter,
    ...session.windows.map((window) => Number(window.id.replace('win-', '')) || 0),
  );

  const compact = viewport.width <= COMPACT_VIEWPORT;

  windowStore.set((current) => ({
    ...current,
    viewport,
    nextZ: session.windows.length + 1,
    focusedId: session.focusedId,
    windows: session.windows.map((window, index) => ({
      ...window,
      ...restoredGeometry(window, viewport, compact),
      zIndex: index + 1,
    })),
  }));
}

/**
 * Where a restored window goes.
 *
 * A session recorded on a laptop and reopened on a phone describes a screen that is not there.
 * Clamping alone satisfies the window manager's rule — enough title bar stays reachable to drag it
 * back — while still leaving a 940-pixel window three-quarters off the side of a 375-pixel screen.
 * Below the compact threshold the same rule as `openWindow` applies instead: one window, full
 * width, with the recorded geometry kept as what to restore to on a wider screen.
 */
function restoredGeometry(
  window: Omit<WindowState, 'zIndex'>,
  viewport: { width: number; height: number },
  compact: boolean,
): Rect & { snap: SnapZone | null; restore: Rect | null } {
  if (compact) {
    return {
      ...snapRect('maximized', viewport),
      snap: 'maximized',
      restore:
        window.restore ??
        ({ x: window.x, y: window.y, width: window.width, height: window.height } satisfies Rect),
    };
  }

  return {
    ...(window.snap ? snapRect(window.snap, viewport) : clampToViewport(window, viewport)),
    snap: window.snap,
    restore: window.restore,
  };
}

/* -------------------------------------------------------------------------------------------- */
/* React bindings                                                                                 */
/* -------------------------------------------------------------------------------------------- */

export function useWindows(): WindowState[] {
  return useStoreSelector(windowStore, (state) => state.windows);
}

export function useFocusedWindowId(): string | null {
  return useStoreSelector(windowStore, (state) => state.focusedId);
}

export function useViewport(): { width: number; height: number } {
  return useStoreSelector(windowStore, (state) => state.viewport);
}

/** False until the desktop has reported its real size. See `viewportMeasured`. */
export function useViewportMeasured(): boolean {
  return useStoreSelector(windowStore, (state) => state.viewportMeasured);
}

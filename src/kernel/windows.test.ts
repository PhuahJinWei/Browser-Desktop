import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampToViewport,
  closeWindow,
  cycleFocus,
  focusWindow,
  minimizeWindow,
  openWindow,
  restoreSession,
  serializeSession,
  setViewport,
  snapRect,
  snapWindow,
  toggleMaximize,
  windowStore,
  closeAllWindows,
} from './windows';

const viewport = { width: 1200, height: 800 };

beforeEach(() => {
  closeAllWindows();
  windowStore.set((state) => ({ ...state, viewport, nextZ: 1 }));
});

describe('openWindow', () => {
  it('opens and focuses a window', () => {
    const id = openWindow({ appId: 'files', title: 'Files' });
    const state = windowStore.get();
    expect(state.windows).toHaveLength(1);
    expect(state.focusedId).toBe(id);
  });

  it('cascades so stacked windows stay individually clickable', () => {
    const a = openWindow({ appId: 'files', title: 'A' });
    const b = openWindow({ appId: 'files', title: 'B' });
    const [first, second] = [a, b].map((id) =>
      windowStore.get().windows.find((window) => window.id === id)!,
    );
    expect(second!.x).toBeGreaterThan(first!.x);
    expect(second!.y).toBeGreaterThan(first!.y);
  });

  it('reuses a singleton window instead of opening a second', () => {
    const first = openWindow({ appId: 'settings', title: 'Settings', singleton: true });
    const second = openWindow({ appId: 'settings', title: 'Settings', singleton: true });
    expect(second).toBe(first);
    expect(windowStore.get().windows).toHaveLength(1);
  });

  it('un-minimises a singleton when it is reopened', () => {
    const id = openWindow({ appId: 'settings', title: 'Settings', singleton: true });
    minimizeWindow(id);
    openWindow({ appId: 'settings', title: 'Settings', singleton: true });
    expect(windowStore.get().windows[0]!.minimized).toBe(false);
  });

  it('shrinks a window that would not fit the viewport', () => {
    setViewport({ width: 600, height: 400 });
    const id = openWindow({ appId: 'files', title: 'Files', width: 1400, height: 900 });
    const window = windowStore.get().windows.find((candidate) => candidate.id === id)!;
    expect(window.width).toBeLessThanOrEqual(600);
    expect(window.height).toBeLessThanOrEqual(400);
  });
});

describe('focus', () => {
  it('raises a window above the others when focused', () => {
    const a = openWindow({ appId: 'files', title: 'A' });
    const b = openWindow({ appId: 'notes', title: 'B' });
    focusWindow(a);
    const windows = windowStore.get().windows;
    const first = windows.find((window) => window.id === a)!;
    const second = windows.find((window) => window.id === b)!;
    expect(first.zIndex).toBeGreaterThan(second.zIndex);
  });

  it('moves focus to the top-most remaining window when one closes', () => {
    const a = openWindow({ appId: 'files', title: 'A' });
    const b = openWindow({ appId: 'notes', title: 'B' });
    closeWindow(b);
    expect(windowStore.get().focusedId).toBe(a);
  });

  it('leaves nothing focused when the last window closes', () => {
    const a = openWindow({ appId: 'files', title: 'A' });
    closeWindow(a);
    expect(windowStore.get().focusedId).toBeNull();
  });

  it('skips minimised windows when cycling', () => {
    const a = openWindow({ appId: 'files', title: 'A' });
    const b = openWindow({ appId: 'notes', title: 'B' });
    minimizeWindow(b);
    focusWindow(a);
    cycleFocus(1);
    expect(windowStore.get().focusedId).toBe(a);
  });

  it('hands focus on when the focused window is minimised', () => {
    const a = openWindow({ appId: 'files', title: 'A' });
    const b = openWindow({ appId: 'notes', title: 'B' });
    minimizeWindow(b);
    expect(windowStore.get().focusedId).toBe(a);
  });
});

describe('snapping', () => {
  it('splits the viewport for half and quarter zones', () => {
    expect(snapRect('left', viewport)).toEqual({ x: 0, y: 0, width: 600, height: 800 });
    expect(snapRect('right', viewport)).toEqual({ x: 600, y: 0, width: 600, height: 800 });
    expect(snapRect('bottom-right', viewport)).toEqual({
      x: 600,
      y: 400,
      width: 600,
      height: 400,
    });
  });

  it('restores the pre-snap geometry when unsnapped', () => {
    const id = openWindow({ appId: 'files', title: 'A', width: 700, height: 500 });
    const before = { ...windowStore.get().windows[0]! };
    snapWindow(id, 'left');
    snapWindow(id, null);
    const after = windowStore.get().windows[0]!;
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.x).toBe(before.x);
  });

  it('keeps the original geometry across snap-to-snap moves', () => {
    // Snapping left then right then unsnapping must land back at the free size, not at half width.
    const id = openWindow({ appId: 'files', title: 'A', width: 700, height: 500 });
    const before = { ...windowStore.get().windows[0]! };
    snapWindow(id, 'left');
    snapWindow(id, 'right');
    snapWindow(id, null);
    expect(windowStore.get().windows[0]!.width).toBe(before.width);
  });

  it('toggles maximise', () => {
    const id = openWindow({ appId: 'files', title: 'A' });
    toggleMaximize(id);
    expect(windowStore.get().windows[0]!.snap).toBe('maximized');
    expect(windowStore.get().windows[0]!.width).toBe(viewport.width);
    toggleMaximize(id);
    expect(windowStore.get().windows[0]!.snap).toBeNull();
  });
});

describe('clampToViewport', () => {
  it('keeps enough of the title bar reachable to drag the window back', () => {
    const clamped = clampToViewport({ x: 5000, y: 5000, width: 400, height: 300 }, viewport);
    expect(clamped.x).toBeLessThanOrEqual(viewport.width - 120);
    expect(clamped.y).toBeLessThanOrEqual(viewport.height - 36);
  });

  it('allows a window to hang off the left edge, but not entirely', () => {
    const clamped = clampToViewport({ x: -5000, y: 10, width: 400, height: 300 }, viewport);
    expect(clamped.x).toBe(120 - 400);
  });

  it('never shrinks below the minimum usable size', () => {
    const clamped = clampToViewport({ x: 0, y: 0, width: 10, height: 10 }, viewport);
    expect(clamped.width).toBeGreaterThanOrEqual(320);
    expect(clamped.height).toBeGreaterThanOrEqual(200);
  });
});

describe('viewport changes', () => {
  it('re-flows snapped windows to the new size', () => {
    const id = openWindow({ appId: 'files', title: 'A' });
    snapWindow(id, 'right');
    setViewport({ width: 800, height: 600 });
    const window = windowStore.get().windows[0]!;
    expect(window.width).toBe(400);
    expect(window.x).toBe(400);
    expect(window.height).toBe(600);
  });

  it('pulls free windows back into reach when the viewport shrinks', () => {
    const id = openWindow({ appId: 'files', title: 'A' });
    windowStore.set((state) => ({
      ...state,
      windows: state.windows.map((window) => ({ ...window, x: 1100 })),
    }));
    setViewport({ width: 500, height: 400 });
    expect(windowStore.get().windows[0]!.x).toBeLessThanOrEqual(500 - 120);
    void id;
  });
});

describe('session', () => {
  it('round-trips windows, order and focus', () => {
    const a = openWindow({ appId: 'files', title: 'Files' });
    const b = openWindow({ appId: 'notes', title: 'Notes' });
    snapWindow(b, 'left');
    focusWindow(a);

    const session = serializeSession();
    closeAllWindows();
    restoreSession(session, viewport);

    const state = windowStore.get();
    expect(state.windows).toHaveLength(2);
    expect(state.focusedId).toBe(a);
    // Stacking order survives without persisting raw z-indices.
    const restoredA = state.windows.find((window) => window.id === a)!;
    const restoredB = state.windows.find((window) => window.id === b)!;
    expect(restoredA.zIndex).toBeGreaterThan(restoredB.zIndex);
    expect(restoredB.snap).toBe('left');
  });

  it('re-applies snapping to the viewport it is restored into', () => {
    const id = openWindow({ appId: 'files', title: 'Files' });
    snapWindow(id, 'right');
    const session = serializeSession();
    closeAllWindows();
    restoreSession(session, { width: 600, height: 400 });
    const window = windowStore.get().windows[0]!;
    expect(window.width).toBe(300);
    expect(window.x).toBe(300);
  });
});

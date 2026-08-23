import { createStore, useStoreSelector } from './store';

/**
 * A live badge in a window's title bar, set by the app inside it.
 *
 * There is exactly one use for this and it is the reason it exists: Watch keeps a frame open to
 * another company's server, and a claim like "nothing here talks to anyone unless you asked" is
 * only worth something if the one exception announces itself while it is true. A chip in the app's
 * own toolbar would be easy to miss and easy to leave behind after the frame is gone; the title
 * bar is the part of a window that is always visible, including when the window is behind another.
 *
 * Kept out of `WindowState` deliberately. Window state is serialised into the session and the
 * setup export, and a transient "this is happening right now" flag has no business surviving a
 * reload — restoring a window with a chip claiming a connection that does not exist would be a
 * lie told by the honesty feature.
 */

export interface WindowChip {
  label: string;
  /** Long form for the title attribute, when the label has to stay short. */
  detail?: string;
}

const chips = createStore<Record<string, WindowChip>>({});

export function setWindowChip(windowId: string, chip: WindowChip | null): void {
  chips.set((current) => {
    if (!chip) {
      if (!(windowId in current)) return current;
      const rest = { ...current };
      delete rest[windowId];
      return rest;
    }
    const existing = current[windowId];
    if (existing && existing.label === chip.label && existing.detail === chip.detail)
      return current;
    return { ...current, [windowId]: chip };
  });
}

export function useWindowChip(windowId: string): WindowChip | undefined {
  return useStoreSelector(chips, (state) => state[windowId]);
}

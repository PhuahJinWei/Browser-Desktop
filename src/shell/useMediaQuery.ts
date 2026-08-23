import { useSyncExternalStore } from 'react';
import { COMPACT_VIEWPORT } from '../kernel/windows';

/**
 * Media queries as state.
 *
 * The desktop asks two questions of the device — is the pointer coarse, and is the screen small —
 * and they are genuinely separate: a touchscreen laptop is coarse and wide, a desktop browser
 * window dragged narrow is fine and small. Conflating them into one "mobile" flag gets both wrong.
 */

const cache = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList | null {
  if (typeof matchMedia !== 'function') return null;
  const existing = cache.get(query);
  if (existing) return existing;
  const created = matchMedia(query);
  cache.set(query, created);
  return created;
}

export function useMediaQuery(query: string): boolean {
  const list = listFor(query);

  return useSyncExternalStore(
    (onChange) => {
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => list?.matches ?? false,
    () => false,
  );
}

/** Fingers, not a mouse: hovering does not exist and 32-pixel targets are a coin flip. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/**
 * Too narrow for overlapping windows.
 *
 * The threshold belongs to the window manager, which is what actually changes behaviour at it;
 * this is the CSS-side reading of the same number.
 */
export function useCompactLayout(): boolean {
  return useMediaQuery(`(max-width: ${COMPACT_VIEWPORT}px)`);
}

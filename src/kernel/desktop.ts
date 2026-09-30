import type { IconCell } from './settings';
import { settingsStore, updateSettings } from './settings';

/**
 * Desktop icon layout.
 *
 * Positions are stored as **grid cells, not pixels**. A pixel layout is wrong the moment the
 * window is resized or the text size changes: icons drift off the edge, or land under the taskbar,
 * and the only fix is to clamp them — which quietly destroys the arrangement the user made. Cells
 * survive all of that, keep icons aligned with each other for free, and make "sort" and "reset"
 * one-line operations.
 *
 * Nothing here touches the DOM or React. The drag loop in DesktopIcons writes transforms directly
 * (ADR 9) and calls into this module once, on drop.
 */

/** Cell geometry in CSS pixels. The icon itself is smaller; the cell includes its gap. */
export const ICON_CELL = {
  width: 96,
  height: 100,
  originX: 12,
  originY: 12,
} as const;

/**
 * Desktop order is not launcher order.
 *
 * A launcher is an app catalogue; a fresh Windows desktop starts with the machine and its file
 * system, then the things a person works with, then media and administration. Keeping that order
 * here also means a new built-in can be added to the launcher without quietly scattering every
 * icon that follows it on the desktop.
 *
 * At the usual six rows this forms two deliberate columns:
 *   My Computer · Files · Recycle Bin · Notepad · Paint · Search
 *   Photos · Audio · Video · Settings · Task Manager
 * Installed apps begin in the next free cell, alphabetically as supplied by their registry.
 */
export const DEFAULT_DESKTOP_ORDER = [
  'about',
  'files',
  'trash',
  'notes',
  'paint',
  'search',
  'photos',
  'audio',
  'video',
  'settings',
  'tasks',
] as const;

const desktopRank = new Map<string, number>(DEFAULT_DESKTOP_ORDER.map((id, index) => [id, index]));

/** Curated built-ins first; unknown future ids retain their registry order at the end. */
export function orderDesktopIds(ids: readonly string[]): string[] {
  return ids
    .map((id, index) => ({ id, index }))
    .sort(
      (left, right) =>
        (desktopRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (desktopRank.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index,
    )
    .map(({ id }) => id);
}

export function cellToPixels(cell: IconCell): { x: number; y: number } {
  return {
    x: ICON_CELL.originX + cell.col * ICON_CELL.width,
    y: ICON_CELL.originY + cell.row * ICON_CELL.height,
  };
}

export function pixelsToCell(x: number, y: number): IconCell {
  return {
    col: Math.max(0, Math.round((x - ICON_CELL.originX) / ICON_CELL.width)),
    row: Math.max(0, Math.round((y - ICON_CELL.originY) / ICON_CELL.height)),
  };
}

/** How many icon rows fit above the taskbar. At least one, however short the viewport is. */
export function rowsForHeight(height: number): number {
  return Math.max(1, Math.floor((height - ICON_CELL.originY) / ICON_CELL.height));
}

const key = (cell: IconCell): string => `${cell.col},${cell.row}`;

/**
 * Resolves stored positions and defaults into one cell per icon, with no two icons on a cell.
 *
 * Stored positions win, in the order given; anything left over flows column-major into the first
 * free cell, which is the arrangement the desktop starts with.
 */
export function layoutIcons(
  ids: string[],
  positions: Record<string, IconCell>,
  rows: number,
): Map<string, IconCell> {
  const layout = new Map<string, IconCell>();
  const taken = new Set<string>();
  const unplaced: string[] = [];

  for (const id of ids) {
    const stored = positions[id];
    if (!stored) {
      unplaced.push(id);
      continue;
    }
    // A shorter viewport pulls stored rows into range rather than hiding the icon below the fold.
    const wanted: IconCell = {
      col: Math.max(0, stored.col),
      row: Math.min(Math.max(0, stored.row), rows - 1),
    };
    const cell = taken.has(key(wanted)) ? nearestFreeCell(wanted, taken, rows) : wanted;
    layout.set(id, cell);
    taken.add(key(cell));
  }

  for (const id of unplaced) {
    const cell = nextFreeCell(taken, rows);
    layout.set(id, cell);
    taken.add(key(cell));
  }

  return layout;
}

/** First free cell reading down each column, then across — how a desktop fills up. */
export function nextFreeCell(taken: ReadonlySet<string>, rows: number): IconCell {
  for (let col = 0; col < 256; col++) {
    for (let row = 0; row < rows; row++) {
      if (!taken.has(`${col},${row}`)) return { col, row };
    }
  }
  return { col: 0, row: 0 };
}

/**
 * The free cell closest to where the user dropped an icon.
 *
 * Rings outward by Chebyshev distance, so a drop onto an occupied cell lands beside it rather than
 * somewhere arbitrary. Falls back to the first free cell if the neighbourhood is full.
 */
export function nearestFreeCell(
  desired: IconCell,
  taken: ReadonlySet<string>,
  rows: number,
): IconCell {
  if (!taken.has(key(desired))) return desired;

  for (let radius = 1; radius <= 32; radius++) {
    let best: IconCell | null = null;
    let bestDistance = Infinity;

    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        // Only the ring, not the filled square: inner cells were checked at a smaller radius.
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        const col = desired.col + dc;
        const row = desired.row + dr;
        if (col < 0 || row < 0 || row >= rows) continue;
        if (taken.has(`${col},${row}`)) continue;

        // Ties inside a ring go to the cell that is closest as the crow flies, and then up-left,
        // so repeated drops in the same place stay predictable.
        const distance = Math.hypot(dc, dr) + col * 1e-6 + row * 1e-9;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { col, row };
        }
      }
    }
    if (best) return best;
  }

  return nextFreeCell(taken, rows);
}

/* -------------------------------------------------------------------------------------------- */
/* Operations                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * Commits a drag.
 *
 * Every visible icon's cell is written, not just the moved ones: once a user has arranged the
 * desktop, the icons they did not touch must not re-flow underneath them when another app appears.
 */
export function moveIcons(
  movingIds: string[],
  delta: { cols: number; rows: number },
  layout: Map<string, IconCell>,
  rows: number,
): void {
  const moving = new Set(movingIds);
  const taken = new Set<string>();
  const next: Record<string, IconCell> = {};

  for (const [id, cell] of layout) {
    if (moving.has(id)) continue;
    next[id] = cell;
    taken.add(key(cell));
  }

  for (const id of movingIds) {
    const from = layout.get(id);
    if (!from) continue;
    const wanted: IconCell = {
      col: Math.max(0, from.col + delta.cols),
      row: Math.min(Math.max(0, from.row + delta.rows), rows - 1),
    };
    const cell = nearestFreeCell(wanted, taken, rows);
    next[id] = cell;
    taken.add(key(cell));
  }

  updateSettings({ iconPositions: next });
}

/** Sorts the icons into columns by name, keeping the given order. */
export function arrangeIcons(orderedIds: string[], rows: number): void {
  const positions: Record<string, IconCell> = {};
  orderedIds.forEach((id, index) => {
    positions[id] = { col: Math.floor(index / rows), row: index % rows };
  });
  updateSettings({ iconPositions: positions });
}

/** Forgets every manual position, so icons flow again in the desktop's curated order. */
export function resetIconLayout(): void {
  updateSettings({ iconPositions: {}, hiddenIcons: [] });
}

export function hideIcon(appId: string): void {
  const current = settingsStore.get();
  if (current.hiddenIcons.includes(appId)) return;
  // Its cell goes too: an icon that comes back later should flow in, not reclaim a stale place.
  const positions = Object.fromEntries(
    Object.entries(current.iconPositions).filter(([key]) => key !== appId),
  );
  updateSettings({ hiddenIcons: [...current.hiddenIcons, appId], iconPositions: positions });
}

export function showIcon(appId: string): void {
  const current = settingsStore.get();
  if (!current.hiddenIcons.includes(appId)) return;
  updateSettings({ hiddenIcons: current.hiddenIcons.filter((id) => id !== appId) });
}

export function isIconHidden(appId: string): boolean {
  return settingsStore.get().hiddenIcons.includes(appId);
}

export function showAllIcons(): void {
  updateSettings({ hiddenIcons: [] });
}

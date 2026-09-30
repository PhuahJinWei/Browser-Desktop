import { describe, expect, it } from 'vitest';
import {
  ICON_CELL,
  cellToPixels,
  layoutIcons,
  nearestFreeCell,
  orderDesktopIds,
  pixelsToCell,
  rowsForHeight,
} from './desktop';
import type { IconCell } from './settings';

const cells = (layout: Map<string, IconCell>) =>
  Object.fromEntries([...layout].map(([id, cell]) => [id, `${cell.col},${cell.row}`]));

describe('desktop icon layout', () => {
  it('starts like a Windows desktop rather than repeating launcher order', () => {
    expect(
      orderDesktopIds(['files', 'search', 'photos', 'trash', 'about', 'settings', 'new-app']),
    ).toEqual(['about', 'files', 'trash', 'search', 'photos', 'settings', 'new-app']);
  });

  it('keeps unknown future apps in their registry order', () => {
    expect(orderDesktopIds(['later-b', 'files', 'later-a'])).toEqual([
      'files',
      'later-b',
      'later-a',
    ]);
  });

  it('flows unplaced icons down the first column, then across', () => {
    const layout = layoutIcons(['a', 'b', 'c', 'd'], {}, 3);
    expect(cells(layout)).toEqual({ a: '0,0', b: '0,1', c: '0,2', d: '1,0' });
  });

  it('keeps a stored position and flows the rest around it', () => {
    const layout = layoutIcons(['a', 'b'], { b: { col: 0, row: 0 } }, 4);
    expect(cells(layout)).toEqual({ b: '0,0', a: '0,1' });
  });

  it('never puts two icons on one cell, even when the file says so', () => {
    const layout = layoutIcons(['a', 'b'], { a: { col: 2, row: 1 }, b: { col: 2, row: 1 } }, 5);
    expect(layout.get('a')).toEqual({ col: 2, row: 1 });
    expect(layout.get('b')).not.toEqual(layout.get('a'));
  });

  it('pulls a stored row back into view when the viewport shrinks', () => {
    const layout = layoutIcons(['a'], { a: { col: 1, row: 9 } }, 3);
    expect(layout.get('a')).toEqual({ col: 1, row: 2 });
  });

  it('drops a negative cell from a hand-edited file back onto the grid', () => {
    const layout = layoutIcons(['a'], { a: { col: -4, row: -2 } }, 3);
    expect(layout.get('a')).toEqual({ col: 0, row: 0 });
  });
});

describe('nearestFreeCell', () => {
  it('returns the cell itself when it is free', () => {
    expect(nearestFreeCell({ col: 3, row: 1 }, new Set(), 5)).toEqual({ col: 3, row: 1 });
  });

  it('lands beside an occupied cell rather than somewhere arbitrary', () => {
    const taken = new Set(['3,1']);
    const found = nearestFreeCell({ col: 3, row: 1 }, taken, 5);
    expect(Math.abs(found.col - 3) + Math.abs(found.row - 1)).toBe(1);
  });

  it('rings outward when the whole neighbourhood is full', () => {
    const taken = new Set<string>();
    for (let col = 0; col <= 4; col++) {
      for (let row = 0; row <= 4; row++) taken.add(`${col},${row}`);
    }
    const found = nearestFreeCell({ col: 2, row: 2 }, taken, 5);
    expect(taken.has(`${found.col},${found.row}`)).toBe(false);
    expect(found.col).toBe(5);
  });
});

describe('cells and pixels', () => {
  it('round-trips a cell through pixels', () => {
    const cell = { col: 3, row: 2 };
    const { x, y } = cellToPixels(cell);
    expect(pixelsToCell(x, y)).toEqual(cell);
  });

  it('snaps a drop between two cells to the nearer one', () => {
    const { x, y } = cellToPixels({ col: 1, row: 1 });
    expect(pixelsToCell(x + ICON_CELL.width * 0.4, y)).toEqual({ col: 1, row: 1 });
    expect(pixelsToCell(x + ICON_CELL.width * 0.6, y)).toEqual({ col: 2, row: 1 });
  });

  it('always leaves room for at least one row, however short the desktop is', () => {
    expect(rowsForHeight(0)).toBe(1);
    expect(rowsForHeight(-500)).toBe(1);
    expect(rowsForHeight(512)).toBeGreaterThan(1);
  });
});

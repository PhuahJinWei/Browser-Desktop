import { describe, expect, it } from 'vitest';
import { treeRows } from './treeRows';

const root = { id: 'root', name: 'Home' };
const folder = (id: string) => ({ id, name: id });

describe('treeRows', () => {
  const children = new Map([
    ['root', [folder('a'), folder('b')]],
    ['a', [folder('a1'), folder('a2')]],
    ['a1', []],
  ]);

  it('lists only what is open, in order, with depths', () => {
    const rows = treeRows(root, children, new Set(['root', 'a']));
    expect(rows.map((row) => `${row.depth}:${row.id}`)).toEqual([
      '0:root',
      '1:a',
      '2:a1',
      '2:a2',
      '1:b',
    ]);
  });

  it('offers an expander only where there is something inside, and not before it knows', () => {
    const rows = treeRows(root, children, new Set(['root', 'a']));
    const by = (id: string) => rows.find((row) => row.id === id)!;
    expect(by('a').hasChildren).toBe(true);
    expect(by('a1').hasChildren).toBe(false);
    expect(by('a2').hasChildren).toBeNull();
  });

  it('carries a line past a folder only while a later sibling of its parent is still to come', () => {
    const rows = treeRows(root, children, new Set(['root', 'a']));
    const by = (id: string) => rows.find((row) => row.id === id)!;
    // a has a later sibling (b), so the line at a's level carries on past a's children.
    expect(by('a1').continues).toEqual([false, true]);
    expect(by('a2').last).toBe(true);
    expect(by('b').last).toBe(true);
  });
});

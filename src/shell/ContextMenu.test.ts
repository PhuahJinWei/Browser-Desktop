import { describe, expect, it } from 'vitest';
import { normalise, separator, type MenuSpec } from './ContextMenu';

const row = (id: string) => ({ id, label: id, run: () => {} });

/** The ids that survive, with separators written as `—` so the shape of the menu reads at a glance. */
function shape(spec: MenuSpec): string[] {
  return normalise(spec).map((item) => ('separator' in item ? '—' : item.id));
}

describe('normalise', () => {
  it('drops the falsy entries that conditional rows leave behind', () => {
    expect(shape([row('a'), false, null, undefined, row('b')])).toEqual(['a', 'b']);
  });

  it('keeps a separator between two groups', () => {
    expect(shape([row('a'), separator('s'), row('b')])).toEqual(['a', '—', 'b']);
  });

  it('keeps one divider when the group between two separators empties out', () => {
    // The Recycle Bin's own menu: the Paste group is hidden there.
    expect(
      shape([row('empty'), separator('s1'), false, separator('s2'), row('selectAll')]),
    ).toEqual(['empty', '—', 'selectAll']);
  });

  it('collapses any length of run to one', () => {
    expect(
      shape([row('a'), separator('1'), separator('2'), false, separator('3'), row('b')]),
    ).toEqual(['a', '—', 'b']);
  });

  it('never starts or ends a menu with a separator', () => {
    expect(shape([separator('lead'), false, row('a'), separator('trail'), false])).toEqual(['a']);
  });

  it('leaves nothing at all when every row is conditional and none apply', () => {
    expect(shape([false, separator('s'), null])).toEqual([]);
  });
});

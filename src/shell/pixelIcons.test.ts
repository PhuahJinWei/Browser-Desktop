import { describe, expect, it } from 'vitest';
import { PIXEL_ART, PIXEL_PALETTE, PIXEL_SIZE } from './pixelIcons';
import { layersFor } from './PixelIcon';

/**
 * The art is text, so the things that can go wrong are textual: a row one character short, a
 * typo outside the palette, a stray space. A wrong pixel is a matter of taste; a malformed grid
 * is a bug, and it is cheap to catch here rather than as a silently misdrawn icon.
 */
describe('pixel icons', () => {
  const names = Object.keys(PIXEL_ART) as (keyof typeof PIXEL_ART)[];

  it('has at least the desktop set', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'folder',
        'search',
        'note',
        'image',
        'music',
        'video',
        'apps',
        'link',
        'gauge',
        'settings',
        'info',
      ]),
    );
  });

  it.each(names)('%s is a %ix%i grid in the palette', (name) => {
    const rows = (PIXEL_ART[name] as string).replace(/^\n/, '').replace(/\n$/, '').split('\n');
    expect(rows).toHaveLength(PIXEL_SIZE);
    for (const row of rows) {
      expect(row).toHaveLength(PIXEL_SIZE);
      for (const ch of row) expect(ch === '.' || ch in PIXEL_PALETTE).toBe(true);
    }
  });

  it.each(names)('%s rasterises with a black outline and fits inside the grid', (name) => {
    const layers = layersFor(PIXEL_ART[name] as string);
    expect(layers.length).toBeGreaterThan(1);
    expect(layers.some((layer) => layer.fill === '#000000')).toBe(true);
    // Every run starts inside the grid and does not run off its right edge.
    for (const layer of layers) {
      for (const [, x, , w] of layer.d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
        expect(Number(x) + Number(w)).toBeLessThanOrEqual(PIXEL_SIZE);
      }
    }
  });

  it('merges horizontal runs rather than emitting one rect per pixel', () => {
    const layers = layersFor('\nkkkk\n....\nk.kk\n');
    expect(layers).toEqual([{ fill: '#000000', d: 'M0 0h4v1h-4zM0 2h1v1h-1zM2 2h2v1h-2z' }]);
  });

  it('refuses a character outside the palette', () => {
    expect(() => layersFor('\n.?..\n')).toThrow(/unknown colour '\?'/);
  });
});

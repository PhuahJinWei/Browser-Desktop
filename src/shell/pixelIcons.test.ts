import { describe, expect, it } from 'vitest';
import { PIXEL_ART_16, PIXEL_ART_32, PIXEL_PALETTE } from './pixelIcons';
import { layersFor } from './PixelIcon';
import { APPS } from '../kernel/apps';

/**
 * The art is text, so the things that can go wrong are textual: a row one character short, a typo
 * outside the palette, a stray space. A wrong pixel is a matter of taste; a malformed grid is a
 * bug, and it is cheap to catch here rather than as a silently misdrawn icon.
 */
describe('pixel icons', () => {
  const grids = [
    { size: 16, art: PIXEL_ART_16 },
    { size: 32, art: PIXEL_ART_32 },
  ] as const;

  it('draws every app on the desktop at both sizes', () => {
    // The desktop uses the 32 grid and the chrome the 16 one, so a missing drawing at either size
    // silently falls back to a line icon in one skin — the exact inconsistency this set exists to
    // remove. `file` is the title bar's fallback when a window has no app behind it.
    const needed = [...new Set(APPS.map((app) => app.icon))];
    expect(Object.keys(PIXEL_ART_32)).toEqual(expect.arrayContaining(needed));
    expect(Object.keys(PIXEL_ART_16)).toEqual(expect.arrayContaining([...needed, 'file']));
  });

  for (const { size, art } of grids) {
    describe(`${size}x${size}`, () => {
      const names = Object.keys(art) as (keyof typeof art)[];

      it.each(names)(`%s is a ${size}-row grid in the palette`, (name) => {
        const rows = (art[name] as string).replace(/^\n/, '').replace(/\n$/, '').split('\n');
        expect(rows).toHaveLength(size);
        for (const row of rows) {
          expect(row).toHaveLength(size);
          for (const ch of row) expect(ch === '.' || ch in PIXEL_PALETTE).toBe(true);
        }
      });

      it.each(names)('%s rasterises with an outline and stays inside the grid', (name) => {
        const layers = layersFor(art[name] as string);
        expect(layers.length).toBeGreaterThan(1);
        expect(layers.some((layer) => layer.fill === '#000000')).toBe(true);
        for (const layer of layers) {
          for (const [, x, , w] of layer.d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
            expect(Number(x) + Number(w)).toBeLessThanOrEqual(size);
          }
        }
      });
    });
  }

  it('merges horizontal runs rather than emitting one rect per pixel', () => {
    const layers = layersFor('\nkkkk\n....\nk.kk\n');
    expect(layers).toEqual([{ fill: '#000000', d: 'M0 0h4v1h-4zM0 2h1v1h-1zM2 2h2v1h-2z' }]);
  });

  it('refuses a character outside the palette', () => {
    expect(() => layersFor('\n.?..\n')).toThrow(/unknown colour '\?'/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  brushSpans,
  constrain,
  ellipsePixels,
  floodFill,
  hexToRgba,
  linePixels,
  rectPixels,
  rgbaToHex,
} from './raster';

const WHITE = [255, 255, 255, 255] as const;
const BLACK = [0, 0, 0, 255] as const;
const RED = [255, 0, 0, 255] as const;

function canvas(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x: number, y: number, [r, g, b, a]: readonly number[]) =>
    data.set([r!, g!, b!, a!], (y * width + x) * 4);
  const get = (x: number, y: number) => [
    ...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4),
  ];
  return { data, set, get };
}

describe('linePixels', () => {
  it('includes both ends and leaves no gaps', () => {
    const points = linePixels(0, 0, 7, 3);
    expect(points[0]).toEqual([0, 0]);
    expect(points.at(-1)).toEqual([7, 3]);
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      expect(Math.max(Math.abs(bx - ax), Math.abs(by - ay))).toBe(1);
    }
  });

  it('is a single pixel when both ends are the same', () => {
    expect(linePixels(4, 4, 4, 4)).toEqual([[4, 4]]);
  });
});

describe('rectPixels', () => {
  it('draws each outline pixel once, whichever corner the drag started from', () => {
    const points = rectPixels(5, 4, 1, 1);
    expect(points).toHaveLength(2 * 5 + 2 * 2);
    expect(new Set(points.map(([x, y]) => `${x},${y}`)).size).toBe(points.length);
  });
});

describe('ellipsePixels', () => {
  it('draws a closed outline that fill cannot escape', () => {
    const size = 21;
    const { data, set, get } = canvas(size, size);
    for (const [x, y] of ellipsePixels(0, 3, 20, 17)) set(x, y, BLACK);
    floodFill(data, size, size, 10, 10, RED);
    expect(get(0, 0)).toEqual([...WHITE]);
    expect(get(20, 20)).toEqual([...WHITE]);
    expect(get(10, 10)).toEqual([...RED]);
  });
});

describe('brushSpans', () => {
  it('is one pixel at size 1', () => {
    expect(brushSpans(1)).toEqual([{ dx: 0, dy: 0, width: 1 }]);
  });

  it('is round, and as tall and as wide as its size', () => {
    const spans = brushSpans(8);
    expect(spans).toHaveLength(8);
    expect(Math.max(...spans.map((span) => span.width))).toBe(8);
    expect(spans[0]!.width).toBeLessThan(8);
  });
});

describe('constrain', () => {
  it('makes a box square in the direction of the drag', () => {
    expect(constrain('box', [10, 10], [4, 30])).toEqual([-10, 30]);
  });

  it('snaps a line to the nearest 45°', () => {
    expect(constrain('line', [0, 0], [10, 1])).toEqual([10, 0]);
    expect(constrain('line', [0, 0], [10, 9])).toEqual([10, 10]);
  });
});

describe('floodFill', () => {
  it('fills the enclosed region and stops at the outline', () => {
    const { data, set, get } = canvas(10, 10);
    for (const [x, y] of rectPixels(2, 2, 7, 7)) set(x, y, BLACK);

    expect(floodFill(data, 10, 10, 4, 4, RED)).toBe(true);
    expect(get(4, 4)).toEqual([...RED]);
    expect(get(3, 6)).toEqual([...RED]);
    expect(get(2, 2)).toEqual([...BLACK]);
    expect(get(0, 0)).toEqual([...WHITE]);
  });

  it('reports no change when the region is already that colour', () => {
    const { data } = canvas(4, 4);
    expect(floodFill(data, 4, 4, 1, 1, WHITE)).toBe(false);
  });

  it('ignores a point outside the canvas', () => {
    const { data } = canvas(4, 4);
    expect(floodFill(data, 4, 4, 9, 0, RED)).toBe(false);
  });
});

describe('colour conversion', () => {
  it('round-trips', () => {
    expect(rgbaToHex(hexToRgba('#80ff0a'))).toBe('#80ff0a');
  });
});

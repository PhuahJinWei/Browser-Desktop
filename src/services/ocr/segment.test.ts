import { describe, expect, it } from 'vitest';
import { findLines, looksLikeText, otsuThreshold } from './segment';

/** A blank page, with helpers to stamp bands of "text" on it. */
function page(width: number, height: number, background = 250) {
  const grey = new Uint8Array(width * height).fill(background);
  return {
    grey,
    width,
    height,
    /** A horizontal band of ink, as a run of dark rows between x1 and x2. */
    band(top: number, bottom: number, x1 = 0, x2 = width - 1, value = 20) {
      for (let y = top; y <= bottom; y++) {
        for (let x = x1; x <= x2; x++) grey[y * width + x] = value;
      }
      return this;
    },
  };
}

describe('otsuThreshold', () => {
  it('splits two separated peaks between them', () => {
    const histogram = new Uint32Array(256);
    histogram[20] = 1000; // ink
    histogram[240] = 9000; // paper
    const threshold = otsuThreshold(histogram, 10000);
    expect(threshold).toBeGreaterThan(20);
    expect(threshold).toBeLessThan(240);
  });

  it('survives a histogram with a single value', () => {
    const histogram = new Uint32Array(256);
    histogram[128] = 500;
    expect(() => otsuThreshold(histogram, 500)).not.toThrow();
  });
});

describe('findLines', () => {
  it('finds three lines on a clean page', () => {
    const p = page(200, 120).band(10, 20).band(50, 60).band(90, 100);
    const { lines } = findLines(p.grey, p.width, p.height);
    expect(lines).toHaveLength(3);
    // In reading order, and each one covering its band plus padding.
    expect(lines[0]!.y).toBeLessThan(lines[1]!.y);
    expect(lines[1]!.y).toBeLessThan(lines[2]!.y);
    expect(lines[0]!.y).toBeLessThanOrEqual(10);
    expect(lines[0]!.y + lines[0]!.height).toBeGreaterThanOrEqual(20);
  });

  it('trims a short line to the ink, not the page width', () => {
    const p = page(200, 60).band(20, 30, 10, 59);
    const { lines } = findLines(p.grey, p.width, p.height);
    expect(lines).toHaveLength(1);
    // 50 pixels of ink plus a little padding — nothing like the 200-pixel page.
    expect(lines[0]!.width).toBeLessThan(80);
    expect(lines[0]!.x).toBeLessThanOrEqual(10);
  });

  it('does not split a line at a one-pixel gap', () => {
    // A row of ink, one blank row (the gap under a dot on an i), then more ink.
    const p = page(200, 60).band(20, 24).band(26, 32);
    const { lines } = findLines(p.grey, p.width, p.height);
    expect(lines).toHaveLength(1);
  });

  it('does split lines at a real gap', () => {
    const p = page(200, 200).band(20, 30).band(90, 100);
    const { lines } = findLines(p.grey, p.width, p.height);
    expect(lines).toHaveLength(2);
  });

  it('ignores specks too short to be a line', () => {
    const p = page(400, 400).band(100, 130).band(300, 300, 0, 3);
    const { lines } = findLines(p.grey, p.width, p.height);
    expect(lines).toHaveLength(1);
  });

  it('handles light text on a dark background by inverting', () => {
    const p = page(200, 120, 15).band(40, 55, 0, 199, 245);
    const analysis = findLines(p.grey, p.width, p.height);
    expect(analysis.inverted).toBe(true);
    expect(analysis.lines).toHaveLength(1);
    expect(analysis.lines[0]!.y).toBeLessThanOrEqual(40);
  });

  it('returns nothing for a blank page', () => {
    const p = page(100, 100);
    const { lines } = findLines(p.grey, p.width, p.height);
    expect(lines).toEqual([]);
  });

  it('respects maxLines', () => {
    const p = page(100, 400);
    for (let i = 0; i < 20; i++) p.band(i * 20, i * 20 + 8);
    const { lines } = findLines(p.grey, p.width, p.height, { maxLines: 5 });
    expect(lines).toHaveLength(5);
  });
});

describe('looksLikeText', () => {
  it('accepts a page of evenly sized lines', () => {
    const p = page(200, 200).band(20, 30).band(60, 70).band(100, 110);
    expect(looksLikeText(findLines(p.grey, p.width, p.height))).toBe(true);
  });

  it('rejects a blank page', () => {
    const p = page(100, 100);
    expect(looksLikeText(findLines(p.grey, p.width, p.height))).toBe(false);
  });

  it('rejects a page that is mostly ink', () => {
    // Thick alternating bands: 40% of the page, far more than writing ever is.
    const p = page(100, 100);
    for (let i = 0; i < 10; i++) p.band(i * 10, i * 10 + 3);
    expect(findLines(p.grey, p.width, p.height).inkFraction).toBeGreaterThan(0.35);
    expect(looksLikeText(findLines(p.grey, p.width, p.height))).toBe(false);
  });

  it('rejects lines of wildly inconsistent height', () => {
    // One enormous block and several hairlines: texture, not text.
    const p = page(200, 400).band(10, 150);
    for (let i = 0; i < 6; i++) p.band(200 + i * 20, 200 + i * 20 + 3);
    expect(looksLikeText(findLines(p.grey, p.width, p.height))).toBe(false);
  });
});

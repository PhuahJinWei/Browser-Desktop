/**
 * Pixel geometry for Paint.
 *
 * Everything is drawn as whole pixels rather than through the canvas's own `lineTo` and `ellipse`,
 * which antialias. An antialiased edge is a ring of in-between colours, and flood fill stops at the
 * first of them — so filling a shape you just drew would leave a halo inside its outline. Hard
 * edges are also simply what this program drew.
 *
 * Pure functions over numbers and byte arrays, so they are tested without a canvas.
 */

export type Point = readonly [x: number, y: number];

export type Rgba = readonly [r: number, g: number, b: number, a: number];

/** Every pixel on the line between two points, both ends included (Bresenham). */
export function linePixels(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/** The outline of the rectangle spanned by two corners, each pixel once. */
export function rectPixels(x0: number, y0: number, x1: number, y1: number): Point[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const points: Point[] = [];
  for (let x = left; x <= right; x++) {
    points.push([x, top]);
    if (bottom !== top) points.push([x, bottom]);
  }
  for (let y = top + 1; y < bottom; y++) {
    points.push([left, y]);
    if (right !== left) points.push([right, y]);
  }
  return points;
}

/**
 * The outline of the ellipse inscribed in the box spanned by two corners.
 *
 * Walked one column and one row at a time from the centre outwards, so the outline has no gaps on
 * either the flat or the steep parts — sampling by angle leaves holes along the long sides of a
 * wide ellipse, and fill escapes through them.
 */
export function ellipsePixels(x0: number, y0: number, x1: number, y1: number): Point[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  if (rx === 0 || ry === 0) return linePixels(left, top, right, bottom);

  const seen = new Set<number>();
  const points: Point[] = [];
  const add = (x: number, y: number) => {
    const key = y * 65536 + x;
    if (seen.has(key)) return;
    seen.add(key);
    points.push([x, y]);
  };
  const mirror = (dx: number, dy: number) => {
    add(Math.round(cx - dx), Math.round(cy - dy));
    add(Math.round(cx + dx), Math.round(cy - dy));
    add(Math.round(cx - dx), Math.round(cy + dy));
    add(Math.round(cx + dx), Math.round(cy + dy));
  };

  // One point per column across the flat part, then one per row down the steep part.
  for (let dx = 0; dx <= rx; dx++) mirror(dx, ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2)));
  for (let dy = 0; dy <= ry; dy++) mirror(rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)), dy);
  return points;
}

/**
 * A round brush of a given diameter, as horizontal runs relative to its centre pixel.
 *
 * Runs rather than points because the caller paints each with one `fillRect`, and a brush 8 wide
 * is 52 pixels but only 8 rectangles.
 */
export function brushSpans(size: number): { dx: number; dy: number; width: number }[] {
  const radius = size / 2;
  const origin = Math.floor(size / 2);
  const spans: { dx: number; dy: number; width: number }[] = [];
  for (let row = 0; row < size; row++) {
    let start = -1;
    let width = 0;
    for (let column = 0; column < size; column++) {
      const inside = (column + 0.5 - radius) ** 2 + (row + 0.5 - radius) ** 2 <= radius ** 2;
      if (!inside) continue;
      if (start < 0) start = column;
      width++;
    }
    if (width > 0) spans.push({ dx: start - origin, dy: row - origin, width });
  }
  return spans;
}

/** Endpoint for a shape drawn with Shift held: a square box, or a line snapped to 45°. */
export function constrain(tool: 'line' | 'box', from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (tool === 'box') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return [from[0] + Math.sign(dx || 1) * side, from[1] + Math.sign(dy || 1) * side];
  }
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return [
    from[0] + Math.round(Math.cos(angle) * length),
    from[1] + Math.round(Math.sin(angle) * length),
  ];
}

/**
 * Fills the region of matching colour around a pixel, in place. Returns whether anything changed.
 *
 * Scanline rather than one pixel per stack entry: a 640x480 fill is 300,000 pixels, and pushing
 * each one is what makes a naive fill pause visibly on a large empty canvas.
 */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  colour: Rgba,
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const start = (y * width + x) * 4;
  const target: Rgba = [data[start]!, data[start + 1]!, data[start + 2]!, data[start + 3]!];
  if (target.every((value, index) => value === colour[index])) return false;

  const matches = (index: number) =>
    data[index] === target[0] &&
    data[index + 1] === target[1] &&
    data[index + 2] === target[2] &&
    data[index + 3] === target[3];
  const paint = (index: number) => {
    data[index] = colour[0];
    data[index + 1] = colour[1];
    data[index + 2] = colour[2];
    data[index + 3] = colour[3];
  };

  const stack: number[] = [x, y];
  while (stack.length > 0) {
    const sy = stack.pop()!;
    let sx = stack.pop()!;
    while (sx > 0 && matches((sy * width + sx - 1) * 4)) sx--;
    let above = false;
    let below = false;
    for (; sx < width && matches((sy * width + sx) * 4); sx++) {
      paint((sy * width + sx) * 4);
      if (sy > 0) {
        const up = matches(((sy - 1) * width + sx) * 4);
        if (up && !above) stack.push(sx, sy - 1);
        above = up;
      }
      if (sy < height - 1) {
        const down = matches(((sy + 1) * width + sx) * 4);
        if (down && !below) stack.push(sx, sy + 1);
        below = down;
      }
    }
  }
  return true;
}

export function hexToRgba(hex: string): Rgba {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

export function rgbaToHex([r, g, b]: Rgba): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

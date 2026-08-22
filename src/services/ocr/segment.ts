/**
 * Finding the lines of text in a page.
 *
 * TrOCR reads *one line* at a time. It has no page-layout model, no word boxes and no notion of
 * columns: hand it a whole page and it returns the first line and stops. Everything between "an
 * image" and "text this model can read" has to happen here.
 *
 * The method is a horizontal projection profile, which is the oldest idea in document analysis and
 * still the right one for the case this is honest about handling: dark text on a light background,
 * roughly horizontal, one column. Binarise the page, count dark pixels in each row, and text lines
 * appear as runs of rows with ink between runs with none.
 *
 * What it deliberately does not do: deskew, dewarp, detect columns, or find text in a photograph
 * of a shop front. Those need a detection model — EAST, CRAFT, DBNet — which is a second download
 * and a much larger claim. This handles scans, screenshots and rendered documents, and says so.
 */

export interface LineBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentOptions {
  /**
   * Rows with at least this fraction of the page's peak ink count as text.
   *
   * Relative to the peak rather than absolute, because a page of small print and a page of
   * headings have very different amounts of ink per line and neither is wrong.
   */
  inkThreshold?: number;
  /** Lines shorter than this fraction of the page height are noise — specks, rules, borders. */
  minHeightFraction?: number;
  /** Gaps smaller than this many pixels do not split a line, so dots on i and j stay attached. */
  mergeGap?: number;
  /** Whitespace kept around each line, as a fraction of its height. */
  padFraction?: number;
  maxLines?: number;
}

export interface PageAnalysis {
  lines: LineBox[];
  /** True when the page appears to be light text on a dark background, and was inverted. */
  inverted: boolean;
  /** Fraction of the page that is ink. Very high or very low means this is probably not a page. */
  inkFraction: number;
}

/**
 * Otsu's method: the threshold that best separates a greyscale histogram into two classes.
 *
 * A fixed threshold fails on the two cases that matter most — a grey scan and a bright screenshot
 * — because "dark" is relative to the rest of the page. Otsu finds the split with the greatest
 * between-class variance, which is the same answer a person gives by eye.
 *
 * When several thresholds tie — which happens whenever ink and paper are cleanly separated, since
 * every value in the empty gap between them splits equally well — the midpoint of the tied range
 * is returned rather than its lower end. On a clean page that puts the threshold in the middle of
 * the gap instead of hard against the ink, where a little noise would push pixels across it.
 */
export function otsuThreshold(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let value = 0; value < 256; value++) sum += value * histogram[value]!;

  let sumBackground = 0;
  let weightBackground = 0;
  let first = 0;
  let last = 0;
  let bestVariance = -1;

  for (let value = 0; value < 256; value++) {
    weightBackground += histogram[value]!;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += value * histogram[value]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      first = value;
      last = value;
    } else if (variance === bestVariance) {
      last = value;
    }
  }
  return Math.round((first + last) / 2);
}

/**
 * Finds the text lines in a greyscale page.
 *
 * `grey` is one byte per pixel, row-major. Returns boxes in the same coordinates.
 */
export function findLines(
  grey: Uint8Array,
  width: number,
  height: number,
  options: SegmentOptions = {},
): PageAnalysis {
  const inkThreshold = options.inkThreshold ?? 0.08;
  const minHeightFraction = options.minHeightFraction ?? 0.004;
  // At least 2: one blank row between two inked rows is a difference of 2, and that blank row is
  // the gap under the dot of an i, not the end of a line.
  const mergeGap = options.mergeGap ?? Math.max(2, Math.round(height * 0.006));
  const padFraction = options.padFraction ?? 0.18;
  const maxLines = options.maxLines ?? 200;

  const histogram = new Uint32Array(256);
  for (let i = 0; i < grey.length; i++) histogram[grey[i]!] = histogram[grey[i]!]! + 1;
  const threshold = otsuThreshold(histogram, width * height);

  // Which side is the ink? Whichever there is less of. A page is mostly background.
  let darkCount = 0;
  for (let i = 0; i < grey.length; i++) if (grey[i]! <= threshold) darkCount++;
  const inverted = darkCount > grey.length / 2;
  const isInk = inverted
    ? (value: number) => value > threshold
    : (value: number) => value <= threshold;

  const rowInk = new Uint32Array(height);
  let totalInk = 0;
  for (let y = 0; y < height; y++) {
    let count = 0;
    const offset = y * width;
    for (let x = 0; x < width; x++) if (isInk(grey[offset + x]!)) count++;
    rowInk[y] = count;
    totalInk += count;
  }

  let peak = 0;
  for (let y = 0; y < height; y++) peak = Math.max(peak, rowInk[y]!);
  const cutoff = Math.max(1, peak * inkThreshold);

  // Rows with ink, merged across small gaps.
  const bands: { top: number; bottom: number }[] = [];
  let start = -1;
  let lastInked = -1;
  for (let y = 0; y < height; y++) {
    if (rowInk[y]! >= cutoff) {
      if (start === -1) start = y;
      else if (y - lastInked > mergeGap) {
        bands.push({ top: start, bottom: lastInked });
        start = y;
      }
      lastInked = y;
    }
  }
  if (start !== -1) bands.push({ top: start, bottom: lastInked });

  const minHeight = Math.max(3, height * minHeightFraction);
  const lines: LineBox[] = [];

  for (const band of bands) {
    if (lines.length >= maxLines) break;
    const bandHeight = band.bottom - band.top + 1;
    if (bandHeight < minHeight) continue;

    // Trim the band horizontally to where its own ink actually is, so a short line is not handed
    // to the model as a mostly-blank strip — which changes the aspect ratio it is resized to and
    // measurably hurts what it reads.
    let left = width;
    let right = -1;
    for (let y = band.top; y <= band.bottom; y++) {
      const offset = y * width;
      for (let x = 0; x < width; x++) {
        if (isInk(grey[offset + x]!)) {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (right < left) continue;

    const pad = Math.round(bandHeight * padFraction);
    const top = Math.max(0, band.top - pad);
    const bottom = Math.min(height - 1, band.bottom + pad);
    const x = Math.max(0, left - pad);
    const x2 = Math.min(width - 1, right + pad);

    lines.push({ x, y: top, width: x2 - x + 1, height: bottom - top + 1 });
  }

  return { lines, inverted, inkFraction: totalInk / (width * height) };
}

/**
 * Whether a page looks like something worth reading.
 *
 * A photograph run through a line finder produces dozens of "lines" that are really texture, and
 * each one costs a model pass. Two cheap signals catch most of that: a page that is almost all ink
 * or almost none is not a page of text, and a page whose "lines" are wildly inconsistent in height
 * is a picture.
 */
export function looksLikeText(analysis: PageAnalysis): boolean {
  const { lines, inkFraction } = analysis;
  if (lines.length === 0) return false;

  // Ink is always the minority class — the finder inverts the page if it is not — so anything
  // above about a third is a photograph or a solid block, not writing. Set text runs 3–15%.
  if (inkFraction < 0.001 || inkFraction > 0.35) return false;
  if (lines.length === 1) return true;

  const heights = lines.map((line) => line.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)]!;
  const tallest = heights[heights.length - 1]!;

  // One enormous band among hairlines is texture. The median stays small, so a rule counting
  // outliers would call it fine — the ratio to the tallest is what catches it.
  if (tallest > median * 8) return false;

  const wild = heights.filter((h) => h > median * 4 || h < median / 4).length;
  return wild / heights.length < 0.4;
}

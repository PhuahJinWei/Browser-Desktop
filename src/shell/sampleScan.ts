/**
 * The sample scanned page.
 *
 * A page of printed text with no text layer — the one kind of document the desktop could not read
 * until M4, and therefore the only honest way to demonstrate that it can now. Rendered here rather
 * than shipped, like every other fixture.
 *
 * The scan artefacts are deliberate and mild: an off-white ground, a faint speckle, a slightly
 * uneven exposure. Enough that this is plainly not a screenshot of crisp text, not so much that it
 * becomes a test of denoising rather than of reading. It is not rotated, because the line finder
 * does not deskew and pretending otherwise would be measuring the wrong thing — that limitation is
 * documented rather than hidden behind a fixture chosen to avoid it.
 */

/** The exact words on the page, so accuracy can be measured rather than eyeballed. */
export const SAMPLE_SCAN_LINES = [
  'DELIVERY NOTE',
  'Northgate Instruments Ltd',
  'Order 4471-B',
  'Received by: A. Okonkwo',
  'Date: 14 March 2026',
  'Two crates, calibration equipment.',
  'One crate shows water damage on the',
  'underside and has been set aside.',
  'Please advise before the invoice is',
  'raised against this consignment.',
];

const WIDTH = 900;
const HEIGHT = 1180;

/** Deterministic noise, so every visitor gets the same page. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function draw(context: OffscreenCanvasRenderingContext2D): void {
  const random = seeded(20260314);

  // Paper: not white, and not evenly lit.
  context.fillStyle = '#f2efe8';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const wash = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  wash.addColorStop(0, 'rgba(0,0,0,0.02)');
  wash.addColorStop(0.5, 'rgba(0,0,0,0)');
  wash.addColorStop(1, 'rgba(0,0,0,0.05)');
  context.fillStyle = wash;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = '#1a1a1a';
  context.textBaseline = 'top';

  let y = 120;
  SAMPLE_SCAN_LINES.forEach((line, index) => {
    if (index === 0) {
      context.font = 'bold 44px Georgia, "Times New Roman", serif';
      context.fillText(line, 90, y);
      y += 78;
      // A rule under the heading, as a form would have.
      context.fillRect(90, y - 22, WIDTH - 180, 2);
      return;
    }
    context.font = '30px Georgia, "Times New Roman", serif';
    context.fillText(line, 90, y);
    // A little extra air after the header block, where a real form has a gap.
    y += index === 4 ? 82 : 56;
  });

  // Speckle: the dust and grain a flatbed picks up.
  for (let i = 0; i < 2600; i++) {
    const x = random() * WIDTH;
    const spotY = random() * HEIGHT;
    const dark = random() > 0.5;
    context.fillStyle = dark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.20)';
    context.fillRect(x, spotY, 1 + random() * 1.5, 1 + random() * 1.5);
  }

  // The edge of the platen: a soft grey border, which is what makes it read as a scan.
  context.strokeStyle = 'rgba(0,0,0,0.10)';
  context.lineWidth = 10;
  context.strokeRect(5, 5, WIDTH - 10, HEIGHT - 10);
}

/** Renders the page to PNG. Returns nothing if the browser has no OffscreenCanvas. */
export async function renderSampleScan(): Promise<{
  name: string;
  data: ArrayBuffer;
  mime: string;
} | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;

  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  if (!context) return null;
  draw(context);

  // PNG, not WebP: a scan is exactly the case where lossy artefacts around letter edges would be
  // the thing under test rather than the text.
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { name: 'Delivery note (scanned).png', data: await blob.arrayBuffer(), mime: 'image/png' };
}

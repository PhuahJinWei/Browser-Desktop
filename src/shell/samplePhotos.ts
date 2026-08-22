/**
 * The sample pictures.
 *
 * Drawn here, in the browser, rather than shipped or downloaded. Photographs would mean either
 * bytes in the repository and a licence to track, or a request to a third host — and the whole
 * claim of this project is that it talks to two hosts and keeps your files to itself.
 *
 * They are illustrations, not photographs, and the README says so. That is enough to demonstrate
 * what the model actually does: CLIP was trained on illustrations and diagrams as well as photos,
 * so a drawn sunset really does land near the words "sunset over water" in its vector space. The
 * honest test is still to drag in your own pictures, which is one of the things Files is for.
 */

export interface DrawnImage {
  name: string;
  /** What it depicts, so the demo can suggest a query that should find it. */
  subject: string;
  draw: (context: OffscreenCanvasRenderingContext2D, size: number) => void;
}

function sky(
  context: OffscreenCanvasRenderingContext2D,
  size: number,
  stops: [number, string][],
): void {
  const gradient = context.createLinearGradient(0, 0, 0, size);
  for (const [offset, colour] of stops) gradient.addColorStop(offset, colour);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
}

/** A deterministic pseudo-random source, so every visitor gets identical pictures. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export const SAMPLE_IMAGES: DrawnImage[] = [
  {
    name: 'Sunset over the sea.webp',
    subject: 'a sunset over the ocean',
    draw: (context, size) => {
      sky(context, size, [
        [0, '#2b1055'],
        [0.35, '#c2410c'],
        [0.55, '#f59e0b'],
        [0.62, '#fcd34d'],
      ]);
      // Sun, low on the horizon.
      const horizon = size * 0.62;
      context.fillStyle = '#fff7c2';
      context.beginPath();
      context.arc(size * 0.5, horizon - size * 0.08, size * 0.11, 0, Math.PI * 2);
      context.fill();

      // Sea.
      const water = context.createLinearGradient(0, horizon, 0, size);
      water.addColorStop(0, '#b45309');
      water.addColorStop(0.4, '#1e3a5f');
      water.addColorStop(1, '#0c1a2e');
      context.fillStyle = water;
      context.fillRect(0, horizon, size, size - horizon);

      // The sun's reflection, as broken bands of light.
      context.fillStyle = 'rgba(255, 236, 170, 0.55)';
      const random = seeded(7);
      for (let y = horizon + 4; y < size; y += 7) {
        const spread = ((y - horizon) / (size - horizon)) * size * 0.34 + size * 0.02;
        const width = spread * (0.5 + random() * 0.5);
        context.fillRect(size * 0.5 - width / 2, y, width, 3);
      }
    },
  },
  {
    name: 'Night sky.webp',
    subject: 'a starry night sky with a crescent moon',
    draw: (context, size) => {
      sky(context, size, [
        [0, '#050a1a'],
        [0.7, '#0b1533'],
        [1, '#111f42'],
      ]);
      const random = seeded(19);
      for (let i = 0; i < 220; i++) {
        const x = random() * size;
        const y = random() * size * 0.85;
        const radius = random() * 1.6 + 0.4;
        context.fillStyle = `rgba(255,255,255,${0.35 + random() * 0.65})`;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      // Crescent moon: a bright disc with a darker disc offset over it.
      context.fillStyle = '#f8fafc';
      context.beginPath();
      context.arc(size * 0.72, size * 0.24, size * 0.1, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#080f26';
      context.beginPath();
      context.arc(size * 0.67, size * 0.21, size * 0.1, 0, Math.PI * 2);
      context.fill();
    },
  },
  {
    name: 'Mountain lake.webp',
    subject: 'mountains reflected in a lake',
    draw: (context, size) => {
      sky(context, size, [
        [0, '#7dd3fc'],
        [0.6, '#dbeafe'],
      ]);
      const horizon = size * 0.6;

      const range = (baseline: number, colour: string, peaks: number[]) => {
        context.fillStyle = colour;
        context.beginPath();
        context.moveTo(0, baseline);
        peaks.forEach((height, index) => {
          const x = (index / (peaks.length - 1)) * size;
          context.lineTo(x, baseline - height * size);
        });
        context.lineTo(size, baseline);
        context.closePath();
        context.fill();
      };

      range(horizon, '#64748b', [0.05, 0.22, 0.1, 0.3, 0.12, 0.26, 0.06]);
      range(horizon, '#475569', [0.02, 0.14, 0.28, 0.09, 0.2, 0.08, 0.02]);

      // Snow caps.
      context.fillStyle = '#f8fafc';
      context.beginPath();
      context.moveTo(size * 0.5, horizon - 0.28 * size);
      context.lineTo(size * 0.46, horizon - 0.22 * size);
      context.lineTo(size * 0.54, horizon - 0.22 * size);
      context.closePath();
      context.fill();

      // Lake, with a mirrored, muted reflection.
      context.fillStyle = '#1d4ed8';
      context.fillRect(0, horizon, size, size - horizon);
      context.save();
      context.globalAlpha = 0.35;
      context.translate(0, horizon * 2);
      context.scale(1, -1);
      range(horizon, '#475569', [0.02, 0.14, 0.28, 0.09, 0.2, 0.08, 0.02]);
      context.restore();

      context.fillStyle = 'rgba(255,255,255,0.18)';
      for (let y = horizon + 10; y < size; y += 12) {
        context.fillRect(size * 0.1, y, size * 0.8, 2);
      }
    },
  },
  {
    name: 'Red keyboard.webp',
    subject: 'a red mechanical keyboard',
    draw: (context, size) => {
      context.fillStyle = '#1c1917';
      context.fillRect(0, 0, size, size);

      const boardX = size * 0.06;
      const boardY = size * 0.28;
      const boardWidth = size * 0.88;
      const boardHeight = size * 0.44;

      context.fillStyle = '#7f1d1d';
      context.beginPath();
      context.roundRect(boardX, boardY, boardWidth, boardHeight, size * 0.03);
      context.fill();

      const columns = 14;
      const rows = 5;
      const gap = size * 0.008;
      const keyWidth = (boardWidth - gap * (columns + 1)) / columns;
      const keyHeight = (boardHeight - gap * (rows + 1)) / rows;

      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x = boardX + gap + column * (keyWidth + gap);
          const y = boardY + gap + row * (keyHeight + gap);
          context.fillStyle = row === rows - 1 && column > 3 && column < 10 ? '#dc2626' : '#ef4444';
          context.beginPath();
          context.roundRect(x, y, keyWidth, keyHeight, size * 0.008);
          context.fill();
          // A highlight along the top edge reads as a moulded keycap.
          context.fillStyle = 'rgba(255,255,255,0.18)';
          context.fillRect(x, y, keyWidth, keyHeight * 0.22);
        }
      }
    },
  },
  {
    name: 'Quarterly chart.webp',
    subject: 'a bar chart of quarterly figures',
    draw: (context, size) => {
      context.fillStyle = '#f8fafc';
      context.fillRect(0, 0, size, size);

      const left = size * 0.14;
      const bottom = size * 0.82;
      const top = size * 0.16;

      context.strokeStyle = '#cbd5e1';
      context.lineWidth = 1.5;
      for (let i = 0; i <= 4; i++) {
        const y = bottom - ((bottom - top) / 4) * i;
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(size * 0.92, y);
        context.stroke();
      }

      const values = [0.35, 0.55, 0.42, 0.78, 0.62];
      const barWidth = (size * 0.78 - left) / (values.length * 1.6);
      values.forEach((value, index) => {
        const x = left + size * 0.03 + index * barWidth * 1.6;
        const height = (bottom - top) * value;
        context.fillStyle = index === 3 ? '#0d9488' : '#14b8a6';
        context.fillRect(x, bottom - height, barWidth, height);
      });

      context.strokeStyle = '#334155';
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(left, top);
      context.lineTo(left, bottom);
      context.lineTo(size * 0.92, bottom);
      context.stroke();
    },
  },
  {
    name: 'Cup of coffee.webp',
    subject: 'a cup of coffee on a table',
    draw: (context, size) => {
      context.fillStyle = '#a8a29e';
      context.fillRect(0, 0, size, size);
      context.fillStyle = '#78716c';
      context.fillRect(0, size * 0.68, size, size * 0.32);

      // Saucer.
      context.fillStyle = '#e7e5e4';
      context.beginPath();
      context.ellipse(size * 0.5, size * 0.68, size * 0.3, size * 0.09, 0, 0, Math.PI * 2);
      context.fill();

      // Cup.
      context.fillStyle = '#fafaf9';
      context.beginPath();
      context.moveTo(size * 0.32, size * 0.4);
      context.lineTo(size * 0.36, size * 0.65);
      context.quadraticCurveTo(size * 0.5, size * 0.71, size * 0.64, size * 0.65);
      context.lineTo(size * 0.68, size * 0.4);
      context.closePath();
      context.fill();

      // Handle.
      context.strokeStyle = '#fafaf9';
      context.lineWidth = size * 0.035;
      context.beginPath();
      context.arc(size * 0.7, size * 0.5, size * 0.08, -Math.PI / 2.2, Math.PI / 2.2);
      context.stroke();

      // Coffee.
      context.fillStyle = '#3f2a1d';
      context.beginPath();
      context.ellipse(size * 0.5, size * 0.405, size * 0.175, size * 0.045, 0, 0, Math.PI * 2);
      context.fill();

      // Steam.
      context.strokeStyle = 'rgba(255,255,255,0.55)';
      context.lineWidth = size * 0.012;
      for (const offset of [-0.07, 0, 0.07]) {
        context.beginPath();
        context.moveTo(size * (0.5 + offset), size * 0.36);
        context.quadraticCurveTo(
          size * (0.54 + offset),
          size * 0.29,
          size * (0.48 + offset),
          size * 0.22,
        );
        context.stroke();
      }
    },
  },
  {
    name: 'Forest path.webp',
    subject: 'a path through green forest trees',
    draw: (context, size) => {
      sky(context, size, [
        [0, '#bbf7d0'],
        [0.4, '#4ade80'],
        [1, '#14532d'],
      ]);

      // Path receding to the horizon.
      context.fillStyle = '#a8a29e';
      context.beginPath();
      context.moveTo(size * 0.44, size * 0.45);
      context.lineTo(size * 0.56, size * 0.45);
      context.lineTo(size * 0.82, size);
      context.lineTo(size * 0.18, size);
      context.closePath();
      context.fill();

      const random = seeded(41);
      const tree = (x: number, y: number, height: number, colour: string) => {
        context.fillStyle = '#422006';
        context.fillRect(x - height * 0.05, y, height * 0.1, height * 0.28);
        context.fillStyle = colour;
        for (let layer = 0; layer < 3; layer++) {
          const layerY = y - height * (0.16 * layer);
          const width = height * (0.42 - layer * 0.09);
          context.beginPath();
          context.moveTo(x, layerY - height * 0.42);
          context.lineTo(x - width, layerY);
          context.lineTo(x + width, layerY);
          context.closePath();
          context.fill();
        }
      };

      for (let i = 0; i < 9; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const depth = random();
        const x = size * 0.5 + side * (size * 0.12 + depth * size * 0.36);
        const y = size * (0.5 + depth * 0.42);
        tree(x, y, size * (0.2 + depth * 0.34), depth > 0.5 ? '#166534' : '#15803d');
      }
    },
  },
  {
    name: 'Beach and palm.webp',
    subject: 'a tropical beach with a palm tree',
    draw: (context, size) => {
      sky(context, size, [
        [0, '#38bdf8'],
        [0.55, '#bae6fd'],
      ]);
      context.fillStyle = '#0ea5e9';
      context.fillRect(0, size * 0.55, size, size * 0.18);
      context.fillStyle = '#fde68a';
      context.fillRect(0, size * 0.73, size, size * 0.27);

      // Surf line.
      context.fillStyle = 'rgba(255,255,255,0.75)';
      context.fillRect(0, size * 0.72, size, size * 0.02);

      // Palm.
      context.strokeStyle = '#78350f';
      context.lineWidth = size * 0.022;
      context.beginPath();
      context.moveTo(size * 0.24, size * 0.92);
      context.quadraticCurveTo(size * 0.2, size * 0.6, size * 0.28, size * 0.36);
      context.stroke();

      context.fillStyle = '#15803d';
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6 + 0.4;
        context.beginPath();
        context.moveTo(size * 0.28, size * 0.36);
        context.quadraticCurveTo(
          size * 0.28 + Math.cos(angle) * size * 0.12,
          size * 0.36 + Math.sin(angle) * size * 0.1 - size * 0.04,
          size * 0.28 + Math.cos(angle) * size * 0.2,
          size * 0.36 + Math.sin(angle) * size * 0.16,
        );
        context.quadraticCurveTo(
          size * 0.28 + Math.cos(angle) * size * 0.12,
          size * 0.36 + Math.sin(angle) * size * 0.1 + size * 0.03,
          size * 0.28,
          size * 0.36,
        );
        context.fill();
      }

      // Sun.
      context.fillStyle = 'rgba(255,255,255,0.9)';
      context.beginPath();
      context.arc(size * 0.78, size * 0.18, size * 0.08, 0, Math.PI * 2);
      context.fill();
    },
  },
];

/** Renders the set to WebP. Returns nothing if the browser has no OffscreenCanvas. */
export async function renderSampleImages(
  size = 512,
): Promise<{ name: string; subject: string; data: ArrayBuffer; mime: string }[]> {
  if (typeof OffscreenCanvas === 'undefined') return [];

  const rendered: { name: string; subject: string; data: ArrayBuffer; mime: string }[] = [];
  for (const image of SAMPLE_IMAGES) {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d');
    if (!context) continue;
    image.draw(context, size);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
    rendered.push({
      name: image.name,
      subject: image.subject,
      data: await blob.arrayBuffer(),
      mime: 'image/webp',
    });
  }
  return rendered;
}

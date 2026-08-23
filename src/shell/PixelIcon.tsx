import { useId } from 'react';
import type { IconName } from './Icon';
import { PIXEL_ART, PIXEL_PALETTE, PIXEL_SIZE, type PixelKey } from './pixelIcons';

/**
 * Pixel-art icons for the classic skin.
 *
 * The line icons in `Icon.tsx` are the modern set: a 1.75 stroke with round caps, drawn white on
 * the desktop. Nothing tokens can do makes that look like 1995 — the artwork is the tell. These
 * are 32×32 bitmaps in a sixteen-colour palette, which is what the era's desktop icons were.
 *
 * They are stored as text (`pixelIcons.ts`), one character per pixel, and rasterised here into one
 * SVG path per colour: each horizontal run of a colour becomes a 1-unit-tall rectangle. With
 * `shape-rendering: crispEdges` and integer geometry the browser paints them pixel-exact at 32px,
 * and at 2× on a high-density display each art pixel is a clean 2×2 block. No image files, no
 * new hosts, and the art is reviewable in a diff.
 *
 * Selection is the era's: a 50% dither of the selection navy over the icon's own pixels — not a
 * square around it — done by painting the same paths a second time with a 2×2 pattern fill.
 */

interface Layer {
  fill: string;
  d: string;
}

/** Rasterises a grid into one path per colour. Throws on a character outside the palette. */
export function layersFor(art: string): Layer[] {
  const rows = art.replace(/^\n/, '').replace(/\n$/, '').split('\n');
  const runs = new Map<string, string[]>();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x] as string;
      if (ch === '.') {
        x++;
        continue;
      }
      let w = 1;
      while (row[x + w] === ch) w++;
      const fill = PIXEL_PALETTE[ch as PixelKey] as string | undefined;
      if (!fill) throw new Error(`pixel art: unknown colour '${ch}' at ${x},${y}`);
      let list = runs.get(fill);
      if (!list) runs.set(fill, (list = []));
      list.push(`M${x} ${y}h${w}v1h-${w}z`);
      x += w;
    }
  });
  return [...runs].map(([fill, d]) => ({ fill, d: d.join('') }));
}

const cache = new Map<IconName, Layer[]>();

function layers(name: IconName): Layer[] | null {
  const art = PIXEL_ART[name];
  if (!art) return null;
  let result = cache.get(name);
  if (!result) cache.set(name, (result = layersFor(art)));
  return result;
}

export function hasPixelIcon(name: IconName): boolean {
  return name in PIXEL_ART;
}

interface PixelIconProps {
  name: IconName;
  size?: number;
  /** Paints the era's navy dither over the icon's own pixels. */
  selected?: boolean;
  className?: string;
}

export function PixelIcon({
  name,
  size = PIXEL_SIZE,
  selected = false,
  className,
}: PixelIconProps) {
  // Pattern ids must be unique per instance; React's ids carry punctuation that is not safe in a
  // url() fragment, so keep only the characters that are.
  const id = `px-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const art = layers(name);
  if (!art) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${PIXEL_SIZE} ${PIXEL_SIZE}`}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {selected ? (
        <defs>
          <pattern id={id} width="2" height="2" patternUnits="userSpaceOnUse">
            <path d="M0 0h1v1H0zM1 1h1v1H1z" fill="#000080" />
          </pattern>
        </defs>
      ) : null}
      {art.map((layer) => (
        <path key={layer.fill} d={layer.d} fill={layer.fill} />
      ))}
      {selected
        ? art.map((layer) => <path key={`${layer.fill}-dither`} d={layer.d} fill={`url(#${id})`} />)
        : null}
    </svg>
  );
}

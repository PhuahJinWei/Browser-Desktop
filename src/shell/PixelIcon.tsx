import { useId } from 'react';
import { useSetting } from '../kernel/settings';
import { Icon, type IconName } from './Icon';
import { PIXEL_ART_16, PIXEL_ART_32, PIXEL_PALETTE, type PixelKey } from './pixelIcons';

/**
 * Pixel-art icons for the classic skin.
 *
 * The line icons in `Icon.tsx` are the modern set: a 1.75 stroke with round caps. Nothing tokens
 * can do makes that look like 1995 — the artwork is the tell. These are bitmaps in a sixteen-colour
 * palette, which is what the era's icons were.
 *
 * They are stored as text (`pixelIcons.ts`), one character per pixel, and rasterised here into one
 * SVG path per colour: each horizontal run of a colour becomes a 1-unit-tall rectangle. With
 * `shape-rendering: crispEdges` and integer geometry the browser paints them pixel-exact, and at 2×
 * on a high-density display each art pixel is a clean 2×2 block. No image files, no new hosts, and
 * the art is reviewable in a diff.
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

/**
 * Which of the two drawings to use.
 *
 * The era shipped a 16 and a 32 per icon rather than scaling one, because halving a bitmap throws
 * away the pixel it was placed on. The boundary is 24: below it the chrome drawing, at or above it
 * the desktop drawing.
 */
function gridFor(size: number): { grid: number; art: Partial<Record<IconName, string>> } {
  return size < 24 ? { grid: 16, art: PIXEL_ART_16 } : { grid: 32, art: PIXEL_ART_32 };
}

const cache = new Map<string, Layer[]>();

function layers(name: IconName, grid: number, art: Partial<Record<IconName, string>>) {
  const source = art[name];
  if (!source) return null;
  const key = `${grid}:${name}`;
  let result = cache.get(key);
  if (!result) cache.set(key, (result = layersFor(source)));
  return result;
}

/** Whether there is a drawing for this name at the size that would be used. */
export function hasPixelIcon(name: IconName, size = 32): boolean {
  return name in gridFor(size).art;
}

interface PixelIconProps {
  name: IconName;
  size?: number | undefined;
  /** Paints the era's navy dither over the icon's own pixels. */
  selected?: boolean | undefined;
  className?: string | undefined;
}

export function PixelIcon({ name, size = 32, selected = false, className }: PixelIconProps) {
  // Pattern ids must be unique per instance; React's ids carry punctuation that is not safe in a
  // url() fragment, so keep only the characters that are.
  const id = `px-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { grid, art } = gridFor(size);
  const paths = layers(name, grid, art);
  if (!paths) return null;

  // Snapped to a whole multiple of the grid. A 16-pixel drawing shown at 15px or 22px is resampled
  // and the crispness — the entire point — is lost, so the call site's size is a request for a
  // scale rather than an exact box.
  const rendered = Math.max(1, Math.floor(size / grid)) * grid;

  return (
    <svg
      width={rendered}
      height={rendered}
      viewBox={`0 0 ${grid} ${grid}`}
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
      {paths.map((layer) => (
        <path key={layer.fill} d={layer.d} fill={layer.fill} />
      ))}
      {selected
        ? paths.map((layer) => (
            <path key={`${layer.fill}-dither`} d={layer.d} fill={`url(#${id})`} />
          ))
        : null}
    </svg>
  );
}

/**
 * An icon as the current skin draws it: pixel art under classic, the line icon otherwise.
 *
 * One component rather than a skin branch at each call site, because the title bar, the taskbar,
 * the launcher and the desktop all draw the same app icon and four copies of the same condition
 * drift apart.
 *
 * `size` is the modern size. The classic side snaps it to a whole multiple of whichever grid it
 * picks, so a single number covers both: 15 in a title bar becomes the 16 drawing at 16px, and 24
 * on the desktop becomes the 32 drawing at 32px, which is the pairing the era used at those two
 * places anyway.
 */
export function AppIcon({ name, size, selected, className }: PixelIconProps & { size: number }) {
  const skin = useSetting('skin');
  if (skin === 'classic' && hasPixelIcon(name, size)) {
    return <PixelIcon name={name} size={size} selected={selected} className={className} />;
  }
  return <Icon name={name} size={size} className={className} />;
}

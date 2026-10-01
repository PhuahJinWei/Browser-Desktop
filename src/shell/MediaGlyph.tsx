/**
 * Transport symbols for the players: play, pause, stop, record, and the skips.
 *
 * Filled shapes rather than the line icon set, because these are the one family of symbols every
 * player on both desktops draws solid — a play triangle in outline reads as disabled. They take
 * `currentColor`, except record, whose red is the symbol.
 */

export type MediaGlyphName =
  'play' | 'pause' | 'stop' | 'record' | 'start' | 'end' | 'back' | 'forward';

const SHAPES: Record<MediaGlyphName, string> = {
  play: 'M4 2.5v11l9-5.5Z',
  pause: 'M3.5 2.5h3v11h-3ZM9.5 2.5h3v11h-3Z',
  stop: 'M3 3h10v10H3Z',
  record: '',
  // Skip to the start: a bar and two triangles pointing at it.
  start: 'M2 3h1.6v10H2ZM3.6 8 9 3v10ZM9 8l5.4-5v10Z',
  end: 'M14 3h-1.6v10H14ZM12.4 8 7 3v10ZM7 8 1.6 3v10Z',
  back: 'M8 8l6-5v10ZM2 8l6-5v10Z',
  forward: 'M8 8 2 3v10ZM14 8 8 3v10Z',
};

export function MediaGlyph({
  name,
  size = 16,
  className,
}: {
  name: MediaGlyphName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {name === 'record' ? (
        <circle cx="8" cy="8" r="5" fill="#d42020" />
      ) : (
        <path d={SHAPES[name]} fill="currentColor" />
      )}
    </svg>
  );
}

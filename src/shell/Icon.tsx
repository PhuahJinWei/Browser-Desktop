/**
 * The icon set.
 *
 * Drawn here rather than imported: an icon library is a dependency in the shell's hot path, and
 * the project's whole visual identity has to be original — no borrowed Windows or macOS artwork
 * (ADR 1, and a licensing matter besides).
 *
 * One 24-unit grid, 1.75 stroke, round caps, `currentColor` throughout, so an icon inherits the
 * colour of whatever it sits in and stays legible in both skins.
 */

export type IconName =
  | 'folder'
  | 'folder-open'
  | 'file'
  | 'file-text'
  | 'image'
  | 'music'
  | 'video'
  | 'pdf'
  | 'search'
  | 'settings'
  | 'gauge'
  | 'info'
  | 'note'
  | 'paint'
  | 'trash'
  | 'restore'
  | 'refresh'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'restore-window'
  | 'plus'
  | 'upload'
  | 'grid'
  | 'list'
  | 'check'
  | 'alert'
  | 'cpu'
  | 'computer'
  | 'drive'
  | 'bolt'
  | 'bell'
  | 'apps'
  | 'offline'
  | 'sparkle'
  | 'arrow-left'
  | 'arrow-up'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'edit'
  | 'download'
  | 'wallpaper'
  | 'power';

const PATHS: Record<IconName, string> = {
  folder:
    'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5Z',
  'folder-open':
    'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10M3 17.5V7.5m0 10A1.5 1.5 0 0 0 4.5 19h13a1.5 1.5 0 0 0 1.45-1.1L21 11H6.2a1.5 1.5 0 0 0-1.44 1.08Z',
  file: 'M6 3.5h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1ZM13 3.5v5h5',
  'file-text':
    'M6 3.5h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1ZM13 3.5v5h5M8.5 13h7M8.5 16.5h4.5',
  image: 'M4 5.5h16v13H4zM4 15l4.5-4 3.5 3 3-2.5L20 16M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  music:
    'M9 18V6.5l10-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  video: 'M3.5 6.5h12v11h-12zM15.5 10.5l5-3v9l-5-3z',
  pdf: 'M6 3.5h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1ZM13 3.5v5h5M8 17c2-1 3.2-3 4-5s2.4-2 2.8-.6c.4 1.6-3.4 3-6.8 5.6Z',
  // A brush: a handle down to a loaded tip, which is the tool rather than the palette it came from.
  paint:
    'M19.5 4.5 12 12M10.6 11.2c1.9 0 3.3 1.4 3.3 3.3 0 3-2.9 5.4-8.4 5.4 1-1.1 1.3-2.4 1.3-4 0-2.6 1.6-4.7 3.8-4.7Z',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14ZM16 16l4.5 4.5',
  settings:
    'M12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4ZM12 3.5l1.4 2.2 2.6-.4.6 2.5 2.4 1-1 2.4 1 2.4-2.4 1-.6 2.5-2.6-.4L12 20.5l-1.4-2.2-2.6.4-.6-2.5-2.4-1 1-2.4-1-2.4 2.4-1 .6-2.5 2.6.4Z',
  gauge: 'M4 17.5a8.5 8.5 0 1 1 16 0M12 13.5l4-3.5M12 17.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  info: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18ZM12 11v6M12 7.6h.01',
  note: 'M6 3.5h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1ZM8.5 10h7M8.5 13.5h7M8.5 17h4',
  trash: 'M4.5 7h15M9.5 7V5h5v2M6.5 7l1 13h9l1-13M10.5 10.5v6M13.5 10.5v6',
  restore: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4',
  // The mirror of restore: the arc runs the other way and the head sits top-right.
  refresh: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4',
  'chevron-right': 'M9.5 5.5 16 12l-6.5 6.5',
  'chevron-down': 'M5.5 9.5 12 16l6.5-6.5',
  close: 'M6 6l12 12M18 6 6 18',
  minimize: 'M6 12h12',
  maximize: 'M5.5 5.5h13v13h-13z',
  'restore-window':
    'M8 8.5V6.2A.7.7 0 0 1 8.7 5.5h9.6a.7.7 0 0 1 .7.7v9.6a.7.7 0 0 1-.7.7H16M5.5 9.5h10v9h-10z',
  plus: 'M12 5.5v13M5.5 12h13',
  upload: 'M12 16V4.5M7.5 9 12 4.5 16.5 9M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15',
  grid: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
  list: 'M4.5 7h15M4.5 12h15M4.5 17h15',
  check: 'M5 12.5 10 17.5 19 7',
  alert: 'M12 4.5 21 19.5H3ZM12 10v4M12 17h.01',
  cpu: 'M8 8h8v8H8zM4.5 10h3.5M4.5 14h3.5M16 10h3.5M16 14h3.5M10 4.5V8M14 4.5V8M10 16v3.5M14 16v3.5',
  computer: 'M3.5 4.5h17v11h-17zM7.5 19.5h9M12 15.5v4M6.5 7.5h11',
  drive:
    'M4 12.5h16M5.5 12.5 8 5.5h8l2.5 7M4 12.5v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5M7 16h.01M10.5 16h3',
  bolt: 'M13.5 3.5 5.5 13.5h5l-1 7 8-10h-5z',
  bell: 'M12 4a5.5 5.5 0 0 0-5.5 5.5c0 4-1.5 5.5-1.5 5.5h14s-1.5-1.5-1.5-5.5A5.5 5.5 0 0 0 12 4ZM10 18a2 2 0 0 0 4 0',
  apps: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM16.5 13.5v6M13.5 16.5h6',
  offline:
    'M3 3l18 18M8.8 12.3a5 5 0 0 1 3-1.2M5.5 9.2a10 10 0 0 1 4-2.1M18.5 9.2a10 10 0 0 0-6.6-2.6M12 18h.01',
  sparkle:
    'M12 3.5 13.7 9l5.3 1.8-5.3 1.8L12 18l-1.7-5.4L5 10.8 10.3 9zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  'arrow-left': 'M19 12H5M11 6 5 12l6 6',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  copy: 'M9 9h9.5a.5.5 0 0 1 .5.5V19a.5.5 0 0 1-.5.5H9a.5.5 0 0 1-.5-.5V9.5A.5.5 0 0 1 9 9ZM5.5 15V5.5A.5.5 0 0 1 6 5h9.5',
  // Two finger loops at the bottom, blades crossing to open tips at the top.
  cut: 'M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM20 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM8.4 15.6 17 4.5M15.6 15.6 7 4.5',
  // A clipboard: the board, the clip across its top edge, and two lines of what is on it.
  paste:
    'M8.5 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2.5M9 4h6v3H9zM8.5 12h7M8.5 15.5h5',
  edit: 'M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5zM14.5 7.5l2 2',
  download: 'M12 4.5V16M7.5 11.5 12 16l4.5-4.5M4.5 15v3.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V15',
  power: 'M12 3.5v8M7.3 6.4a7.5 7.5 0 1 0 9.4 0',
  wallpaper:
    'M4 6a1.5 1.5 0 0 1 1.5-1.5h13A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18ZM4 15.5l4.5-4a1.5 1.5 0 0 1 2 0l5.5 5M14.5 9.5h.01',
};

export interface IconProps {
  name: IconName;
  size?: number | undefined;
  /** Decorative by default; give a label when the icon is the only content of a control. */
  label?: string | undefined;
  className?: string | undefined;
  strokeWidth?: number | undefined;
}

export function Icon({ name, size = 18, label, className, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Picks the icon for a file, so every surface labels the same file the same way. */
export function iconForFile(input: { kind: string; mime: string; name: string }): IconName {
  if (input.kind === 'directory') return 'folder';
  const mime = input.mime;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'music';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/') || mime === 'application/json') return 'file-text';
  return 'file';
}

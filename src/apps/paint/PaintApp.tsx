import { useCallback, useEffect, useRef, useState } from 'react';
import { launchApp, type AppProps } from '../../kernel/apps';
import { notify, notifyError } from '../../kernel/notifications';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, type VfsNode } from '../../kernel/vfs/types';
import { setWallpaperFromFile } from '../../kernel/wallpaper';
import { closeWindow, setWindowTitle } from '../../kernel/windows';
import { separator } from '../../shell/ContextMenu';
import { MenuBar, type MenuBarMenu } from '../../shell/MenuBar';
import {
  brushSpans,
  constrain,
  ellipsePixels,
  floodFill,
  hexToRgba,
  linePixels,
  rectPixels,
  rgbaToHex,
  type Point,
} from './raster';
import styles from './PaintApp.module.css';

/**
 * Paint.
 *
 * A picture is a PNG in the file system, like a note is a Markdown file: it shows up in Files and
 * Photos, can be the wallpaper, and is trashed like anything else. There is no private store.
 *
 * Saving follows Notepad: explicit, with a flush on close underneath it, because a browser tab
 * cannot reliably stop a window closing to ask "save changes?". An untitled picture that has been
 * drawn on is saved into Pictures rather than thrown away.
 *
 * Right-click on the canvas draws with the second colour, and on a swatch it picks the second
 * colour. That is this program's answer to the gesture (D16), not a gap in it.
 */

type Tool = 'pencil' | 'brush' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'ellipse';

const TOOLS: { id: Tool; label: string; glyph: string }[] = [
  { id: 'pencil', label: 'Pencil', glyph: 'M4 20l1-4L16 5l3 3L8 19ZM14 7l3 3' },
  {
    id: 'brush',
    label: 'Brush',
    glyph:
      'M19 5l-7 7M10.5 11.5c1.7 0 3 1.3 3 3 0 2.7-2.6 4.8-7.5 4.8.9-1 1.2-2.2 1.2-3.6 0-2.3 1.4-4.2 3.3-4.2Z',
  },
  { id: 'eraser', label: 'Eraser', glyph: 'M9 19h11M4.5 14.5l9-9 5 5-8.5 8.5H8.5Z' },
  {
    id: 'fill',
    label: 'Fill',
    glyph:
      'M5 12l6-6 7 7-6 6ZM11 6 9 4M19.5 16.5c0 1.2-.7 2-1.5 2s-1.5-.8-1.5-2 1.5-3 1.5-3 1.5 1.8 1.5 3Z',
  },
  { id: 'picker', label: 'Pick colour', glyph: 'M14 6l4 4M5 19l2-4 8-8 2 2-8 8ZM16 4l4 4' },
  { id: 'line', label: 'Line', glyph: 'M5 19 19 5' },
  { id: 'rect', label: 'Rectangle', glyph: 'M4.5 6.5h15v11h-15Z' },
  {
    id: 'ellipse',
    label: 'Ellipse',
    glyph: 'M12 18c4.4 0 8-2.7 8-6s-3.6-6-8-6-8 2.7-8 6 3.6 6 8 6Z',
  },
];

const SIZED: ReadonlySet<Tool> = new Set(['brush', 'eraser', 'line', 'rect', 'ellipse']);
const SIZES = [1, 3, 5, 8] as const;

/** Two rows, darks over lights, the way the colour box of this era was laid out. */
const PALETTE = [
  '#000000',
  '#808080',
  '#800000',
  '#808000',
  '#008000',
  '#008080',
  '#000080',
  '#800080',
  '#808040',
  '#004040',
  '#0080ff',
  '#004080',
  '#8000ff',
  '#804000',
  '#ffffff',
  '#c0c0c0',
  '#ff0000',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#0000ff',
  '#ff00ff',
  '#ffff80',
  '#00ff80',
  '#80ffff',
  '#8080ff',
  '#ff0080',
  '#ff8040',
];

const DEFAULT_SIZE = { width: 640, height: 480 };
const PICTURES_FOLDER = 'Pictures';
/** Each step is a full copy of the canvas: 30 at 640x480 is about 37 MB, which is the ceiling. */
const HISTORY_LIMIT = 30;
const ZOOMS = [1, 2, 4, 8] as const;

interface PaintArgs {
  fileId?: string;
}

interface Snapshot {
  image: ImageData;
  revision: number;
}

type Gesture =
  | { kind: 'freehand'; last: Point; colour: string }
  | { kind: 'shape'; start: Point; before: ImageData; colour: string };

let revisions = 0;
const nextRevision = () => ++revisions;

export default function PaintApp({ windowId, args }: AppProps) {
  const { fileId } = (args as PaintArgs | undefined) ?? {};
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /*
   * Attached but never detached. React clears an object ref before unmount cleanups run, and the
   * save on close is one of those — it found no canvas, and a closed window lost its last strokes.
   */
  const attachCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (node) canvasRef.current = node;
  }, []);
  const colourInput = useRef<HTMLInputElement>(null);
  const colourTarget = useRef<'primary' | 'secondary'>('primary');

  const [tool, setTool] = useState<Tool>('pencil');
  const [lastTool, setLastTool] = useState<Tool>('pencil');
  const [size, setSize] = useState<number>(3);
  const [primary, setPrimary] = useState('#000000');
  const [secondary, setSecondary] = useState('#ffffff');
  const [zoom, setZoom] = useState<number>(1);
  const [dimensions, setDimensions] = useState(DEFAULT_SIZE);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [file, setFile] = useState<VfsNode | null>(null);
  const [loading, setLoading] = useState(Boolean(fileId));
  const [saving, setSaving] = useState(false);

  /*
   * Unsaved means "the picture on screen is not the revision on disk". A counter would call an
   * undo back to the saved state unsaved; a revision id carried through undo and redo does not.
   */
  const [revision, setRevision] = useState(() => nextRevision());
  const [savedRevision, setSavedRevision] = useState(revision);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const [, setHistoryTick] = useState(0);

  const dirty = revision !== savedRevision;

  const context = useCallback(
    () => canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null,
    [],
  );

  const readAll = useCallback((): ImageData | null => {
    const ctx = context();
    const canvas = canvasRef.current;
    return ctx && canvas ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
  }, [context]);

  /** A fresh picture: every edit so far belongs to the one being replaced. */
  const reset = useCallback(
    (width: number, height: number, draw?: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = context();
      if (!ctx) return;
      // Transparency is flattened onto white, as this program always did: the fill and the eraser
      // would otherwise have to decide what "empty" looks like.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      draw?.(ctx);
      undo.current = [];
      redo.current = [];
      const fresh = nextRevision();
      setRevision(fresh);
      setSavedRevision(fresh);
      setDimensions({ width, height });
      setHistoryTick((tick) => tick + 1);
    },
    [context],
  );

  /* Open ------------------------------------------------------------------------------------- */

  useEffect(() => {
    if (!fileId) {
      reset(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { node, data } = await vfs.read(fileId);
        // An <img> rather than createImageBitmap, because only the element decodes SVG.
        const url = URL.createObjectURL(new Blob([data], { type: node.mime }));
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (cancelled) return;
          reset(
            image.naturalWidth || DEFAULT_SIZE.width,
            image.naturalHeight || DEFAULT_SIZE.height,
            (ctx) => ctx.drawImage(image, 0, 0),
          );
          setFile(node);
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (error) {
        if (cancelled) return;
        notifyError('Paint could not open that picture', error);
        reset(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, reset]);

  useEffect(() => {
    setWindowTitle(windowId, `${dirty ? '*' : ''}${file?.name ?? 'Untitled'} — Paint`);
  }, [windowId, file, dirty]);

  /* Save ------------------------------------------------------------------------------------- */

  const encode = useCallback(async (): Promise<ArrayBuffer | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? blob.arrayBuffer() : null;
  }, []);

  const picturesFolder = useCallback(async (): Promise<string> => {
    const children = await vfs.list(ROOT_ID);
    const existing = children.find(
      (node) => node.kind === 'directory' && node.name === PICTURES_FOLDER,
    );
    return (existing ?? (await vfs.createDirectory(ROOT_ID, PICTURES_FOLDER))).id;
  }, []);

  /**
   * Writes the picture. `copy` always makes a new file.
   *
   * A picture opened from a JPEG or a GIF is saved as a PNG beside it rather than over it: writing
   * PNG bytes under a .jpg name would make a file that lies about itself, and re-encoding it as a
   * JPEG would lose quality every time it was saved.
   */
  const save = useCallback(
    async ({ copy = false }: { copy?: boolean } = {}): Promise<VfsNode | null> => {
      const target = revision;
      setSaving(true);
      try {
        const data = await encode();
        if (!data) throw new Error('The canvas could not be encoded');
        const inPlace = !copy && file !== null && file.mime === 'image/png';
        const parentId = file?.parentId ?? (await picturesFolder());
        const stem = file ? file.name.replace(/\.[^.]+$/, '') : 'Untitled';
        const node = await vfs.writeFile({
          parentId,
          name: inPlace && file ? file.name : `${stem}.png`,
          data,
          mime: 'image/png',
          // Without overwrite the file system picks a free name, which is what a copy wants.
          ...(inPlace ? { overwrite: true } : {}),
        });
        setFile(node);
        setSavedRevision(target);
        return node;
      } catch (error) {
        notifyError('Could not save the picture', error);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [revision, file, encode, picturesFolder],
  );

  /*
   * The net under the explicit save. Reads the latest state through a ref so the cleanup runs only
   * when the window really closes, not on every stroke.
   */
  const latest = useRef({ dirty, save });
  useEffect(() => {
    latest.current = { dirty, save };
  });
  useEffect(
    () => () => {
      if (latest.current.dirty) void latest.current.save();
    },
    [],
  );

  const newPicture = useCallback(async () => {
    if (dirty) {
      const saved = await save();
      if (saved) notify({ title: `Saved ${saved.name}`, level: 'info' });
    }
    setFile(null);
    reset(DEFAULT_SIZE.width, DEFAULT_SIZE.height);
  }, [dirty, save, reset]);

  const setAsWallpaper = useCallback(async () => {
    const node = dirty || !file ? await save() : file;
    if (node) setWallpaperFromFile(node.id, node.name);
  }, [dirty, file, save]);

  /* History ---------------------------------------------------------------------------------- */

  /** Records the picture as it is now, before an edit changes it. */
  const checkpoint = useCallback(() => {
    const image = readAll();
    if (!image) return;
    undo.current.push({ image, revision });
    if (undo.current.length > HISTORY_LIMIT) undo.current.shift();
    redo.current = [];
  }, [readAll, revision]);

  const commit = useCallback(() => {
    setRevision(nextRevision());
    setHistoryTick((tick) => tick + 1);
  }, []);

  const step = useCallback(
    (from: React.RefObject<Snapshot[]>, to: React.RefObject<Snapshot[]>) => {
      const target = from.current.pop();
      const current = readAll();
      const ctx = context();
      if (!target || !current || !ctx) return;
      to.current.push({ image: current, revision });
      ctx.putImageData(target.image, 0, 0);
      setRevision(target.revision);
      setHistoryTick((tick) => tick + 1);
    },
    [readAll, context, revision],
  );

  const undoStep = useCallback(() => step(undo, redo), [step]);
  const redoStep = useCallback(() => step(redo, undo), [step]);

  /** Whole-picture operations: flips and inversion, as one undoable step each. */
  const transform = useCallback(
    (operation: 'flip-h' | 'flip-v' | 'invert' | 'clear') => {
      const ctx = context();
      const canvas = canvasRef.current;
      if (!ctx || !canvas) return;
      checkpoint();
      const { width, height } = canvas;
      if (operation === 'clear') {
        ctx.fillStyle = secondary;
        ctx.fillRect(0, 0, width, height);
      } else if (operation === 'invert') {
        const image = ctx.getImageData(0, 0, width, height);
        for (let i = 0; i < image.data.length; i += 4) {
          image.data[i] = 255 - image.data[i]!;
          image.data[i + 1] = 255 - image.data[i + 1]!;
          image.data[i + 2] = 255 - image.data[i + 2]!;
        }
        ctx.putImageData(image, 0, 0);
      } else {
        const copy = document.createElement('canvas');
        copy.width = width;
        copy.height = height;
        copy.getContext('2d')?.drawImage(canvas, 0, 0);
        ctx.save();
        if (operation === 'flip-h') ctx.setTransform(-1, 0, 0, 1, width, 0);
        else ctx.setTransform(1, 0, 0, -1, 0, height);
        ctx.drawImage(copy, 0, 0);
        ctx.restore();
      }
      commit();
    },
    [context, checkpoint, commit, secondary],
  );

  /* Drawing ---------------------------------------------------------------------------------- */

  const stamp = useCallback(
    (ctx: CanvasRenderingContext2D, points: Point[], colour: string, kind: Tool) => {
      ctx.fillStyle = colour;
      if (kind === 'eraser') {
        // Square and larger than the brush at the same setting, as it was: an eraser is for areas.
        const side = size * 2 + 2;
        const half = Math.floor(side / 2);
        for (const [x, y] of points) ctx.fillRect(x - half, y - half, side, side);
        return;
      }
      const spans = brushSpans(kind === 'pencil' ? 1 : size);
      for (const [x, y] of points) {
        for (const span of spans) ctx.fillRect(x + span.dx, y + span.dy, span.width, 1);
      }
    },
    [size],
  );

  const toCanvas = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const box = canvas.getBoundingClientRect();
    return [
      Math.floor(((event.clientX - box.left) * canvas.width) / box.width),
      Math.floor(((event.clientY - box.top) * canvas.height) / box.height),
    ];
  };

  const shapePixels = (kind: Tool, from: Point, to: Point): Point[] => {
    if (kind === 'line') return linePixels(from[0], from[1], to[0], to[1]);
    if (kind === 'rect') return rectPixels(from[0], from[1], to[0], to[1]);
    return ellipsePixels(from[0], from[1], to[0], to[1]);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    const ctx = context();
    if (!ctx || gesture.current) return;
    // preventDefault stops text selection starting mid-stroke, and with it the focus a click would
    // have given the canvas, so that is done by hand.
    event.preventDefault();
    event.currentTarget.focus();
    const point = toCanvas(event);
    const second = event.button === 2;
    const colour = tool === 'eraser' ? secondary : second ? secondary : primary;

    if (tool === 'picker') {
      const [r, g, b] = ctx.getImageData(point[0], point[1], 1, 1).data;
      const picked = rgbaToHex([r!, g!, b!, 255]);
      if (second) setSecondary(picked);
      else setPrimary(picked);
      setTool(lastTool);
      return;
    }

    if (tool === 'fill') {
      const image = readAll();
      if (!image) return;
      const before = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
      if (!floodFill(image.data, image.width, image.height, point[0], point[1], hexToRgba(colour)))
        return;
      undo.current.push({ image: before, revision });
      if (undo.current.length > HISTORY_LIMIT) undo.current.shift();
      redo.current = [];
      ctx.putImageData(image, 0, 0);
      commit();
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    checkpoint();
    if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
      const before = readAll();
      if (!before) return;
      gesture.current = { kind: 'shape', start: point, before, colour };
    } else {
      stamp(ctx, [point], colour, tool);
      gesture.current = { kind: 'freehand', last: point, colour };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toCanvas(event);
    setCursor(point);
    const current = gesture.current;
    const ctx = context();
    if (!current || !ctx) return;

    if (current.kind === 'freehand') {
      const [x0, y0] = current.last;
      stamp(ctx, linePixels(x0, y0, point[0], point[1]), current.colour, tool);
      current.last = point;
      return;
    }
    ctx.putImageData(current.before, 0, 0);
    const end = event.shiftKey
      ? constrain(tool === 'line' ? 'line' : 'box', current.start, point)
      : point;
    stamp(ctx, shapePixels(tool, current.start, end), current.colour, tool);
  };

  const endGesture = () => {
    if (!gesture.current) return;
    gesture.current = null;
    commit();
  };

  const chooseTool = (next: Tool) => {
    if (next === 'picker' && tool !== 'picker') setLastTool(tool);
    setTool(next);
  };

  const editColour = (target: 'primary' | 'secondary') => {
    colourTarget.current = target;
    const input = colourInput.current;
    if (!input) return;
    input.value = target === 'primary' ? primary : secondary;
    input.click();
  };

  /* Menus and keys --------------------------------------------------------------------------- */

  const canUndo = undo.current.length > 0;
  const canRedo = redo.current.length > 0;

  const menuBar: MenuBarMenu[] = [
    {
      id: 'file',
      label: 'File',
      items: () => [
        { id: 'file.new', label: 'New', run: () => void newPicture() },
        {
          // This desktop's file dialog is Files. Pictures open in Paint from its Open with menu.
          id: 'file.open',
          label: 'Open…',
          run: () =>
            void picturesFolder().then((directoryId) =>
              launchApp('files', { args: { directoryId }, title: PICTURES_FOLDER }),
            ),
        },
        {
          id: 'file.save',
          label: 'Save',
          shortcut: 'Ctrl+S',
          disabled: saving || (!dirty && file !== null),
          run: () => void save(),
        },
        {
          id: 'file.copy',
          label: 'Save a Copy',
          disabled: saving,
          run: () => void save({ copy: true }),
        },
        separator('file.s1'),
        { id: 'file.wallpaper', label: 'Set as Wallpaper', run: () => void setAsWallpaper() },
        {
          id: 'file.reveal',
          label: 'Show in Files',
          disabled: !file?.parentId,
          run: () => {
            if (!file?.parentId) return;
            launchApp('files', {
              args: { directoryId: file.parentId, selectId: file.id },
              title: 'Files',
            });
          },
        },
        separator('file.s2'),
        { id: 'file.close', label: 'Close', run: () => closeWindow(windowId) },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: () => [
        { id: 'edit.undo', label: 'Undo', shortcut: 'Ctrl+Z', disabled: !canUndo, run: undoStep },
        { id: 'edit.redo', label: 'Redo', shortcut: 'Ctrl+Y', disabled: !canRedo, run: redoStep },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: () =>
        ZOOMS.map((level) => ({
          id: `view.zoom${level}`,
          label: level === 1 ? 'Normal Size' : `Zoom ${level}×`,
          checked: zoom === level,
          run: () => setZoom(level),
        })),
    },
    {
      id: 'image',
      label: 'Image',
      items: () => [
        { id: 'image.flipH', label: 'Flip Horizontal', run: () => transform('flip-h') },
        { id: 'image.flipV', label: 'Flip Vertical', run: () => transform('flip-v') },
        { id: 'image.invert', label: 'Invert Colours', run: () => transform('invert') },
        separator('image.s1'),
        { id: 'image.clear', label: 'Clear Image', run: () => transform('clear') },
      ],
    },
    {
      id: 'colours',
      label: 'Colours',
      items: () => [
        { id: 'colours.primary', label: 'Edit First Colour…', run: () => editColour('primary') },
        {
          id: 'colours.secondary',
          label: 'Edit Second Colour…',
          run: () => editColour('secondary'),
        },
        {
          id: 'colours.swap',
          label: 'Swap Colours',
          run: () => {
            setPrimary(secondary);
            setSecondary(primary);
          },
        },
      ],
    },
  ];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      // Otherwise the browser offers to save the page.
      event.preventDefault();
      void save();
    } else if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoStep();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      redoStep();
    }
  };

  /* Render ----------------------------------------------------------------------------------- */

  return (
    <div className={styles.app} onKeyDown={onKeyDown}>
      <MenuBar menus={menuBar} label="Paint" />

      <div className={styles.workspace}>
        <div className={styles.toolbox}>
          <div className={styles.tools} role="toolbar" aria-label="Tools">
            {TOOLS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`${styles.tool} ${tool === entry.id ? styles.toolActive : ''}`}
                aria-pressed={tool === entry.id}
                aria-label={entry.label}
                title={entry.label}
                onClick={() => chooseTool(entry.id)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d={entry.glyph} />
                </svg>
              </button>
            ))}
          </div>

          {SIZED.has(tool) ? (
            <div className={styles.sizes} role="group" aria-label="Size">
              {SIZES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.size} ${size === value ? styles.toolActive : ''}`}
                  aria-pressed={size === value}
                  aria-label={`${value} pixel${value === 1 ? '' : 's'}`}
                  title={`${value} px`}
                  onClick={() => setSize(value)}
                >
                  <span style={{ height: value }} />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.stage}>
          <canvas
            ref={attachCanvas}
            className={styles.canvas}
            // Focusable so Ctrl+Z and Ctrl+S reach the app after a stroke; drawing itself is pointer-only.
            tabIndex={0}
            style={{ width: dimensions.width * zoom, height: dimensions.height * zoom }}
            aria-label={`Drawing area, ${dimensions.width} by ${dimensions.height} pixels`}
            role="img"
            hidden={loading}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={(event) => event.preventDefault()}
          />
          {loading ? <p className={styles.loading}>Opening…</p> : null}
        </div>
      </div>

      <div className={styles.colourBox}>
        <div className={styles.current} aria-label="Current colours">
          <button
            type="button"
            className={styles.secondarySwatch}
            style={{ background: secondary }}
            aria-label={`Second colour ${secondary}. Edit`}
            title="Second colour (right button)"
            onClick={() => editColour('secondary')}
          />
          <button
            type="button"
            className={styles.primarySwatch}
            style={{ background: primary }}
            aria-label={`First colour ${primary}. Edit`}
            title="First colour (left button)"
            onClick={() => editColour('primary')}
          />
        </div>
        <div className={styles.palette} role="group" aria-label="Colours">
          {PALETTE.map((colour) => (
            <button
              key={colour}
              type="button"
              className={styles.swatch}
              style={{ background: colour }}
              aria-label={colour}
              title="Left click for the first colour, right click for the second"
              onClick={() => setPrimary(colour)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSecondary(colour);
              }}
            />
          ))}
        </div>
        <input
          ref={colourInput}
          type="color"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) =>
            colourTarget.current === 'primary'
              ? setPrimary(event.target.value)
              : setSecondary(event.target.value)
          }
        />
      </div>

      <div className={styles.statusBar}>
        <span>
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : file ? 'Saved' : 'New picture'}
        </span>
        <span className={styles.cell}>{cursor ? `${cursor[0]}, ${cursor[1]} px` : ''}</span>
        <span className={styles.cell}>
          {dimensions.width} × {dimensions.height} px
        </span>
      </div>
    </div>
  );
}

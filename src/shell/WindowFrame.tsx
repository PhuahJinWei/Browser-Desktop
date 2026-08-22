import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { getApp } from '../kernel/apps';
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  closeWindow,
  focusWindow,
  minimizeWindow,
  setWindowRect,
  snapWindow,
  toggleMaximize,
  type SnapZone,
  type WindowState,
} from '../kernel/windows';
import { Icon } from './Icon';
import styles from './WindowFrame.module.css';

/**
 * A window.
 *
 * The performance decision worth reading: while dragging or resizing, pointer moves write
 * `transform` and size straight to the DOM node and never touch React state. Committing to the
 * store on pointer-up means one render per gesture instead of one per frame, which is what keeps
 * eight open windows at 60 fps. Everything else about a window is ordinary state.
 */

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Which snap zone a drag would land in, or null. Mirrors the zones a desktop user expects. */
export function zoneForPointer(
  x: number,
  y: number,
  viewport: { width: number; height: number },
): SnapZone | null {
  const edge = 24;
  const corner = 120;

  if (y <= edge) {
    if (x <= corner) return 'top-left';
    if (x >= viewport.width - corner) return 'top-right';
    return 'maximized';
  }
  if (x <= edge) return y > viewport.height - corner ? 'bottom-left' : 'left';
  if (x >= viewport.width - edge) return y > viewport.height - corner ? 'bottom-right' : 'right';
  return null;
}

interface WindowFrameProps {
  window: WindowState;
  focused: boolean;
  viewport: { width: number; height: number };
  onSnapPreview: (zone: SnapZone | null) => void;
}

export function WindowFrame({ window: win, focused, viewport, onSnapPreview }: WindowFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const app = getApp(win.appId);

  /* Drag ------------------------------------------------------------------------------------- */

  const onTitlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Buttons inside the title bar handle their own clicks.
      if ((event.target as HTMLElement).closest('button')) return;

      const element = frameRef.current;
      if (!element) return;

      focusWindow(win.id);
      event.currentTarget.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { x: win.x, y: win.y };

      /**
       * Capture the inline styles React set, and put exactly those back when the gesture ends.
       *
       * Clearing them instead looks equivalent and is not: React diffs against its previous style
       * object, sees the same width and height it rendered last time, and skips re-applying them —
       * leaving the element with no size at all. Restoring the captured values keeps the DOM and
       * React's picture of it in agreement.
       */
      const inline = {
        transform: element.style.transform,
        width: element.style.width,
        height: element.style.height,
      };
      // A snapped window being dragged returns to its free size, grabbed proportionally along
      // the title bar so the cursor stays where the user grabbed it.
      const wasSnapped = win.snap !== null;
      const freeWidth = win.restore?.width ?? win.width;
      const grabRatio = wasSnapped ? (startX - win.x) / Math.max(1, win.width) : 0;

      let moved = false;
      let zone: SnapZone | null = null;
      let nextX = origin.x;
      let nextY = origin.y;

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;

        if (!moved) {
          moved = true;
          setDragging(true);
          if (wasSnapped) {
            // Detach from the snap zone at the free size, under the cursor.
            element.style.width = `${freeWidth}px`;
            element.style.height = `${win.restore?.height ?? win.height}px`;
          }
        }

        if (wasSnapped) {
          nextX = moveEvent.clientX - freeWidth * grabRatio;
          nextY = moveEvent.clientY - 18;
          element.style.transform = `translate(${nextX - win.x}px, ${nextY - win.y}px)`;
        } else {
          nextX = origin.x + dx;
          nextY = origin.y + dy;
          element.style.transform = `translate(${dx}px, ${dy}px)`;
        }

        const candidate = zoneForPointer(moveEvent.clientX, moveEvent.clientY, viewport);
        if (candidate !== zone) {
          zone = candidate;
          onSnapPreview(candidate);
        }
      };

      const onUp = () => {
        globalThis.removeEventListener('pointermove', onMove);
        globalThis.removeEventListener('pointerup', onUp);
        element.style.transform = inline.transform;
        element.style.width = inline.width;
        element.style.height = inline.height;
        onSnapPreview(null);
        setDragging(false);

        if (!moved) return;
        if (zone) {
          snapWindow(win.id, zone);
        } else if (wasSnapped) {
          setWindowRect(win.id, {
            x: nextX,
            y: nextY,
            width: freeWidth,
            height: win.restore?.height ?? win.height,
          });
        } else {
          setWindowRect(win.id, { x: nextX, y: nextY });
        }
      };

      globalThis.addEventListener('pointermove', onMove);
      globalThis.addEventListener('pointerup', onUp);
    },
    [win, viewport, onSnapPreview],
  );

  /* Resize ----------------------------------------------------------------------------------- */

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, edge: ResizeEdge) => {
      if (event.button !== 0) return;
      const element = frameRef.current;
      if (!element) return;

      event.stopPropagation();
      focusWindow(win.id);
      event.currentTarget.setPointerCapture(event.pointerId);

      const start = { x: event.clientX, y: event.clientY };
      const origin = { x: win.x, y: win.y, width: win.width, height: win.height };
      let next = { ...origin };
      // Same reasoning as the drag handler: restore React's inline styles, never clear them.
      const inline = {
        transform: element.style.transform,
        width: element.style.width,
        height: element.style.height,
      };

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - start.x;
        const dy = moveEvent.clientY - start.y;

        let { x, y, width, height } = origin;
        if (edge.includes('e')) width = Math.max(MIN_WIDTH, origin.width + dx);
        if (edge.includes('s')) height = Math.max(MIN_HEIGHT, origin.height + dy);
        if (edge.includes('w')) {
          // Dragging the west edge moves the origin as well as the size, and must stop rather
          // than invert when it reaches the minimum width.
          width = Math.max(MIN_WIDTH, origin.width - dx);
          x = origin.x + (origin.width - width);
        }
        if (edge.includes('n')) {
          height = Math.max(MIN_HEIGHT, origin.height - dy);
          y = origin.y + (origin.height - height);
        }

        next = { x, y, width, height };
        element.style.transform = `translate(${x - origin.x}px, ${y - origin.y}px)`;
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
      };

      const onUp = () => {
        globalThis.removeEventListener('pointermove', onMove);
        globalThis.removeEventListener('pointerup', onUp);
        element.style.transform = inline.transform;
        element.style.width = inline.width;
        element.style.height = inline.height;
        setWindowRect(win.id, next);
      };

      globalThis.addEventListener('pointermove', onMove);
      globalThis.addEventListener('pointerup', onUp);
    },
    [win],
  );

  /* Keyboard --------------------------------------------------------------------------------- */

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Window management lives on Ctrl+Alt so it never competes with an app's own keys.
      if (!event.ctrlKey || !event.altKey) return;
      const step = event.shiftKey ? 10 : 40;

      switch (event.key) {
        case 'ArrowLeft':
          snapWindow(win.id, win.snap === 'left' ? null : 'left');
          break;
        case 'ArrowRight':
          snapWindow(win.id, win.snap === 'right' ? null : 'right');
          break;
        case 'ArrowUp':
          toggleMaximize(win.id);
          break;
        case 'ArrowDown':
          if (win.snap) snapWindow(win.id, null);
          else minimizeWindow(win.id);
          break;
        case 'w':
        case 'W':
          closeWindow(win.id);
          break;
        default:
          return;
      }
      event.preventDefault();
      void step;
    },
    [win.id, win.snap],
  );

  /* Render ----------------------------------------------------------------------------------- */

  useEffect(() => {
    if (focused) frameRef.current?.focus({ preventScroll: true });
  }, [focused]);

  if (win.minimized) return null;
  const AppComponent = app?.component;

  return (
    <div
      ref={frameRef}
      className={`${styles.frame} ${focused ? styles.focused : ''} ${dragging ? styles.dragging : ''}`}
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
      }}
      role="dialog"
      aria-label={win.title}
      aria-modal={false}
      tabIndex={-1}
      onPointerDownCapture={() => focusWindow(win.id)}
      onKeyDown={onKeyDown}
    >
      <div
        className={styles.titleBar}
        onPointerDown={onTitlePointerDown}
        onDoubleClick={() => toggleMaximize(win.id)}
      >
        <span className={styles.titleIcon}>
          <Icon name={app?.icon ?? 'file'} size={15} />
        </span>
        <span className={styles.title}>{win.title}</span>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.control}
            onClick={() => minimizeWindow(win.id)}
            aria-label={`Minimise ${win.title}`}
            title="Minimise"
          >
            <Icon name="minimize" size={14} />
          </button>
          <button
            type="button"
            className={styles.control}
            onClick={() => toggleMaximize(win.id)}
            aria-label={win.snap === 'maximized' ? `Restore ${win.title}` : `Maximise ${win.title}`}
            title={win.snap === 'maximized' ? 'Restore' : 'Maximise'}
          >
            <Icon name={win.snap === 'maximized' ? 'restore-window' : 'maximize'} size={13} />
          </button>
          <button
            type="button"
            className={`${styles.control} ${styles.close}`}
            onClick={() => closeWindow(win.id)}
            aria-label={`Close ${win.title}`}
            title="Close"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <Suspense fallback={<div className={styles.loading}>Loading {app?.name ?? 'app'}…</div>}>
          {AppComponent ? (
            <AppComponent windowId={win.id} args={win.args} />
          ) : (
            <div className={styles.loading}>Unknown app: {win.appId}</div>
          )}
        </Suspense>
      </div>

      {win.snap === 'maximized'
        ? null
        : EDGES.map((edge) => (
            <div
              key={edge}
              className={`${styles.handle} ${styles[`handle-${edge}`]}`}
              onPointerDown={(event) => onResizePointerDown(event, edge)}
              aria-hidden
            />
          ))}
    </div>
  );
}

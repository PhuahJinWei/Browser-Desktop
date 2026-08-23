import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { launchApp, launchInstalledApp, launcherApps } from '../kernel/apps';
import {
  ICON_CELL,
  arrangeIcons,
  cellToPixels,
  hideIcon,
  layoutIcons,
  moveIcons,
  resetIconLayout,
  rowsForHeight,
  showAllIcons,
} from '../kernel/desktop';
import { listInstalledApps, useInstalledApps } from '../kernel/installedApps';
import { useSettings } from '../kernel/settings';
import { useViewport } from '../kernel/windows';
import { ContextMenu, isMenuKey, separator, useContextMenu, type MenuSpec } from './ContextMenu';
import type { IconName } from './Icon';
import { AppIcon } from './PixelIcon';
import { useCoarsePointer } from './useMediaQuery';
import styles from './DesktopIcons.module.css';

/**
 * Shortcuts on the desktop surface.
 *
 * **One click selects; two clicks open.** An earlier version of this file opened on a single click,
 * on the reasoning that this is a web page and web pages open things on one click. That argument
 * held right up until the icons could also be selected, dragged and right-clicked — at which point
 * a single click has to mean "this one", or there is no way to pick an icon without launching it.
 * See ADR 16. Touch is the exception: a tap opens, because a touch device has no hover, no
 * right-click and no reliable double-tap, and every touch platform opens on one tap.
 *
 * Positions are grid cells in the settings store, so an arrangement survives a reload, a resize and
 * an export (`kernel/desktop.ts`).
 */

interface Shortcut {
  key: string;
  name: string;
  icon: IconName;
  description: string;
  open: () => void;
  /** Built-ins can be put back with "Show all"; an uninstalled app simply disappears. */
  builtIn: boolean;
}

export function DesktopIcons() {
  const settings = useSettings();
  const viewport = useViewport();
  const installed = useInstalledApps();
  const coarse = useCoarsePointer();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());

  const shortcuts = useMemo<Shortcut[]>(() => {
    const hidden = new Set(settings.hiddenIcons);
    const builtIn: Shortcut[] = launcherApps()
      .filter((app) => !hidden.has(app.id))
      .map((app) => ({
        key: app.id,
        name: app.name,
        icon: app.icon,
        description: app.description,
        open: () => void launchApp(app.id),
        builtIn: true,
      }));

    const third: Shortcut[] = installed
      .filter((app) => !hidden.has(`app:${app.id}`))
      .map((app) => ({
        key: `app:${app.id}`,
        name: app.manifest.name,
        icon: 'apps' as IconName,
        description: app.manifest.description,
        open: () =>
          void launchInstalledApp(app.id, app.manifest.name, {
            ...(app.manifest.defaultSize ? { size: app.manifest.defaultSize } : {}),
          }),
        builtIn: false,
      }));

    return [...builtIn, ...third];
  }, [settings.hiddenIcons, installed]);

  const rows = rowsForHeight(viewport.height);
  const layout = useMemo(
    () =>
      layoutIcons(
        shortcuts.map((shortcut) => shortcut.key),
        settings.iconPositions,
        rows,
      ),
    [shortcuts, settings.iconPositions, rows],
  );

  /* Icons in reading order, which is what the arrow keys and the tab order follow. */
  const ordered = useMemo(
    () =>
      [...shortcuts].sort((a, b) => {
        const left = layout.get(a.key) ?? { col: 0, row: 0 };
        const right = layout.get(b.key) ?? { col: 0, row: 0 };
        return left.col - right.col || left.row - right.row;
      }),
    [shortcuts, layout],
  );

  /* A click on anything that is not an icon drops the selection, the same as a real desktop. */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // Not every pointerdown targets an element — one dispatched at the window does not — and a
      // listener on the window must survive whatever reaches it rather than throwing there.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-desktop-icon]')) return;
      setSelection((current) => (current.size === 0 ? current : new Set()));
    };
    globalThis.addEventListener('pointerdown', onPointerDown);
    return () => globalThis.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const select = useCallback((key: string, additive: boolean) => {
    setSelection((current) => {
      if (!additive) return new Set([key]);
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /* Drag ------------------------------------------------------------------------------------- */

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, shortcut: Shortcut) => {
      if (event.button !== 0) return;
      setFocusKey(shortcut.key);

      const additive = event.ctrlKey || event.metaKey;
      const alreadySelected = selection.has(shortcut.key);
      if (!alreadySelected || additive) select(shortcut.key, additive);

      // Dragging one of several selected icons moves the whole group, which is the only reading
      // of the gesture that does not silently discard the selection the user just made.
      const moving = alreadySelected && selection.size > 1 ? [...selection] : [shortcut.key];

      const startX = event.clientX;
      const startY = event.clientY;
      const nodes = moving
        .map((key) => elements.current.get(key))
        .filter((node): node is HTMLElement => Boolean(node));
      // React owns `left`/`top` here and never sets `transform`, but ADR 9's rule is to restore
      // what was there rather than clear it, and the rule is cheaper to keep than to reason about.
      const inline = nodes.map((node) => node.style.transform);

      let dragging = false;
      let dx = 0;
      let dy = 0;

      const onMove = (moveEvent: PointerEvent) => {
        dx = moveEvent.clientX - startX;
        dy = moveEvent.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < 5) return;
        dragging = true;
        for (const node of nodes) node.style.transform = `translate(${dx}px, ${dy}px)`;
      };

      const onUp = () => {
        globalThis.removeEventListener('pointermove', onMove);
        globalThis.removeEventListener('pointerup', onUp);
        nodes.forEach((node, index) => {
          node.style.transform = inline[index] ?? '';
        });
        if (!dragging) {
          // A plain click on one of several selected icons narrows the selection to that one,
          // which is the only way back to a single icon without clearing and starting again.
          if (alreadySelected && !additive && selection.size > 1) select(shortcut.key, false);
          return;
        }

        const delta = {
          cols: Math.round(dx / ICON_CELL.width),
          rows: Math.round(dy / ICON_CELL.height),
        };
        if (delta.cols !== 0 || delta.rows !== 0) moveIcons(moving, delta, layout, rows);
      };

      globalThis.addEventListener('pointermove', onMove);
      globalThis.addEventListener('pointerup', onUp);
    },
    [selection, select, layout, rows],
  );

  /* Keyboard --------------------------------------------------------------------------------- */

  const focusAt = useCallback((key: string) => {
    setFocusKey(key);
    elements.current.get(key)?.focus();
  }, []);

  const moveFocus = useCallback(
    (from: Shortcut, direction: 'up' | 'down' | 'left' | 'right') => {
      const origin = layout.get(from.key);
      if (!origin) return;

      const horizontal = direction === 'left' || direction === 'right';
      const sign = direction === 'up' || direction === 'left' ? -1 : 1;

      // Prefer the nearest icon in that direction; a gap in a column should not stop the cursor.
      const candidates = shortcuts
        .map((shortcut) => ({ shortcut, cell: layout.get(shortcut.key) }))
        .filter((entry) => entry.cell !== undefined)
        .map((entry) => ({ shortcut: entry.shortcut, cell: entry.cell! }))
        .filter((entry) => {
          const along = horizontal ? entry.cell.col - origin.col : entry.cell.row - origin.row;
          return Math.sign(along) === sign;
        })
        .sort((a, b) => {
          const across = (cell: { col: number; row: number }) =>
            Math.abs(horizontal ? cell.row - origin.row : cell.col - origin.col);
          const along = (cell: { col: number; row: number }) =>
            Math.abs(horizontal ? cell.col - origin.col : cell.row - origin.row);
          return along(a.cell) - along(b.cell) || across(a.cell) - across(b.cell);
        });

      const next = candidates[0]?.shortcut;
      if (next) focusAt(next.key);
    },
    [layout, shortcuts, focusAt],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLLIElement>, shortcut: Shortcut) => {
    if (isMenuKey(event)) {
      if (!selection.has(shortcut.key)) select(shortcut.key, false);
      openMenu(event, iconMenu(shortcut));
      return;
    }

    switch (event.key) {
      case 'Enter':
        shortcut.open();
        break;
      case ' ':
        select(shortcut.key, event.ctrlKey || event.metaKey);
        break;
      case 'ArrowUp':
        moveFocus(shortcut, 'up');
        break;
      case 'ArrowDown':
        moveFocus(shortcut, 'down');
        break;
      case 'ArrowLeft':
        moveFocus(shortcut, 'left');
        break;
      case 'ArrowRight':
        moveFocus(shortcut, 'right');
        break;
      case 'Home':
        if (ordered[0]) focusAt(ordered[0].key);
        break;
      case 'End':
        if (ordered.at(-1)) focusAt(ordered.at(-1)!.key);
        break;
      case 'Escape':
        setSelection(new Set());
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  /* Menu ------------------------------------------------------------------------------------- */

  const iconMenu = (shortcut: Shortcut): MenuSpec => [
    { id: 'open', label: `Open ${shortcut.name}`, run: shortcut.open },
    separator('s1'),
    {
      id: 'sort',
      label: 'Sort icons by name',
      run: () =>
        arrangeIcons(
          [...shortcuts].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => entry.key),
          rows,
        ),
    },
    { id: 'reset', label: 'Reset icon layout', run: resetIconLayout },
    separator('s2'),
    {
      id: 'hide',
      label: selection.size > 1 ? `Remove ${selection.size} icons` : 'Remove from desktop',
      run: () => {
        const keys = selection.has(shortcut.key) ? [...selection] : [shortcut.key];
        for (const key of keys) hideIcon(key);
        setSelection(new Set());
      },
    },
  ];

  /* Render ----------------------------------------------------------------------------------- */

  const activeKey = focusKey ?? ordered[0]?.key ?? null;

  return (
    <>
      <ul
        className={styles.list}
        role="listbox"
        aria-label="Desktop shortcuts"
        aria-multiselectable
        aria-orientation="vertical"
      >
        {shortcuts.map((shortcut) => {
          const cell = layout.get(shortcut.key) ?? { col: 0, row: 0 };
          const { x, y } = cellToPixels(cell);
          const selected = selection.has(shortcut.key);

          return (
            <li
              key={shortcut.key}
              ref={(node) => {
                if (node) elements.current.set(shortcut.key, node);
                else elements.current.delete(shortcut.key);
              }}
              data-desktop-icon={shortcut.key}
              className={`${styles.item} ${selected ? styles.selected : ''}`}
              style={{ left: x, top: y }}
              role="option"
              aria-selected={selected}
              tabIndex={shortcut.key === activeKey ? 0 : -1}
              title={shortcut.description}
              onPointerDown={(event) => onPointerDown(event, shortcut)}
              onClick={() => {
                // No hover, no right-click, no reliable double-tap: touch opens on one tap.
                if (coarse) shortcut.open();
              }}
              onDoubleClick={() => !coarse && shortcut.open()}
              onContextMenu={(event) => {
                if (!selection.has(shortcut.key)) select(shortcut.key, false);
                openMenu(event, iconMenu(shortcut));
              }}
              onKeyDown={(event) => onKeyDown(event, shortcut)}
              onFocus={() => setFocusKey(shortcut.key)}
            >
              <span className={styles.icon}>
                <AppIcon name={shortcut.icon} size={24} selected={selected} />
              </span>
              <span className={styles.label}>{shortcut.name}</span>
            </li>
          );
        })}
      </ul>

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </>
  );
}

/**
 * The icon half of the desktop's own context menu.
 *
 * Lives here because every entry is about the icons; Desktop supplies the rest of the background
 * menu and splices this in.
 */
export function iconLayoutMenu(rows: number, hiddenCount: number): MenuSpec {
  const byName = [
    ...launcherApps().map((app) => ({ key: app.id, name: app.name })),
    ...listInstalledApps().map((app) => ({ key: `app:${app.id}`, name: app.manifest.name })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return [
    {
      id: 'desktop.sort',
      label: 'Sort icons by name',
      run: () =>
        arrangeIcons(
          byName.map((entry) => entry.key),
          rows,
        ),
    },
    { id: 'desktop.reset', label: 'Reset icon layout', run: resetIconLayout },
    hiddenCount > 0 && {
      id: 'desktop.showAll',
      label: `Show ${hiddenCount} hidden icon${hiddenCount === 1 ? '' : 's'}`,
      run: showAllIcons,
    },
  ];
}

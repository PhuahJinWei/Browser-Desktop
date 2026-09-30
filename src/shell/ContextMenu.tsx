import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isTypingTarget } from '../kernel/commands';
import { Icon, type IconName } from './Icon';
import styles from './ContextMenu.module.css';

/**
 * The context menu, for the whole desktop.
 *
 * There was one of these inside Files and nowhere else, which is the difference between an app that
 * has a right-click menu and a desktop that does. Everything that can be acted on — the desktop
 * itself, an icon, a taskbar button, a title bar, a file — opens this one component with a
 * different list.
 *
 * Right-click is not the only way in: `Shift+F10` and the menu key raise the same menu from the
 * keyboard, and the menu is arrow-navigable once open, because a menu that only a mouse can reach
 * is a feature half the users do not have.
 *
 * It renders through a portal to `document.body`, and that is a correctness fix rather than tidiness.
 * A window frame carries `contain: layout paint` so an app's contents can never reflow the desktop;
 * a side effect nobody asks for is that the frame then becomes the containing block for `position:
 * fixed` descendants. This menu is fixed and positioned in viewport coordinates, so every menu
 * raised inside a window — in Files, in Notepad, on any file row — was landing offset by exactly
 * that window's top-left corner. Escaping to the body is what makes "at the pointer" mean the same
 * thing everywhere; React events still bubble through the React tree, so nothing else moves.
 */

interface MenuRowBase {
  id: string;
  label: string;
  /** Rendered in the danger colour. Destructive, not merely important. */
  danger?: boolean;
  disabled?: boolean;
  /**
   * A leading glyph, in the same gutter the check mark uses.
   *
   * The gutter is always there whether or not anything is in it, so a menu where only some entries
   * carry an icon still has every label starting at the same place.
   */
  icon?: IconName;
}

export interface MenuAction extends MenuRowBase {
  run: () => void;
  /** Present makes this a checkable item; the value is its state. */
  checked?: boolean;
  /** Accelerator text, right-aligned. Display only — the binding lives in the command registry. */
  shortcut?: string;
  /**
   * The default action: what a double-click on the same thing would do.
   *
   * Drawn bold, which is how this era said it. Worth having as a flag rather than a convention,
   * because a menu whose first entry is merely the topmost one and a menu whose first entry is the
   * one already bound to double-click look identical otherwise.
   */
  primary?: boolean;
}

/**
 * A row that opens rather than runs.
 *
 * Separate from `MenuAction` rather than an optional `items` beside an optional `run`, because the
 * two are genuinely exclusive: a submenu has nothing to do when chosen, and an action has nothing
 * to open. Splitting them means the compiler rejects the half-built row instead of the menu
 * silently doing nothing when someone clicks it.
 */
export interface MenuSubmenu extends MenuRowBase {
  items: MenuSpec;
}

export interface MenuSeparator {
  id: string;
  separator: true;
}

export type MenuItem = MenuAction | MenuSubmenu | MenuSeparator;

/** Call sites build menus with conditionals, so falsy entries are expected and dropped. */
export type MenuSpec = (MenuItem | false | null | undefined)[];

export interface MenuRequest {
  x: number;
  y: number;
  items: MenuSpec;
}

export const separator = (id: string): MenuSeparator => ({ id, separator: true });

function isSeparator(item: MenuItem): item is MenuSeparator {
  return 'separator' in item;
}

function isSubmenu(item: MenuItem): item is MenuSubmenu {
  return 'items' in item;
}

/**
 * Drops falsy entries, then tidies the separators they leave behind: none at either edge, and a run
 * of them collapsed to one.
 *
 * Collapsed to one, not removed. When conditional rows empty out a middle group, the separators on
 * both sides of it end up adjacent, and what they still mean is "the group above ends here". Dropping
 * every separator that touches another threw that away, and the groups either side ran together —
 * which is how the Recycle Bin's Empty Recycle Bin came to sit flush against Select all.
 */
export function normalise(spec: MenuSpec): MenuItem[] {
  const kept: MenuItem[] = [];
  for (const item of spec) {
    if (!item) continue;
    if (isSeparator(item) && (kept.length === 0 || isSeparator(kept[kept.length - 1]!))) continue;
    kept.push(item);
  }
  while (kept.length > 0 && isSeparator(kept[kept.length - 1]!)) kept.pop();
  return kept;
}

/**
 * One level of the menu.
 *
 * Recursive, because a submenu is the same thing as the menu that opened it — same rows, same
 * keyboard, same skin — and the alternative is two components that have to be kept in agreement
 * forever. Each panel owns only which of its own children is open, so closing one never reaches
 * past its own level.
 */
function MenuPanel({
  items: spec,
  onDismiss,
  onCloseSelf,
  autoFocus = false,
  panelRef,
  className,
  style,
}: {
  items: MenuSpec;
  /** Tear the whole menu down: an item ran, or the root was dismissed. */
  onDismiss: () => void;
  /** Close this level only, handing focus back to the row that opened it. Absent at the root. */
  onCloseSelf?: (() => void) | undefined;
  autoFocus?: boolean;
  panelRef?: React.RefObject<HTMLDivElement | null> | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? own;
  const items = normalise(spec);
  const [open, setOpen] = useState<{ id: string; focusChild: boolean } | null>(null);

  /*
   * This panel's own rows, never a child's.
   *
   * `querySelectorAll` reaches straight through the nested panels, so without the `closest` test
   * the arrow keys would walk out of the menu the user is in and into the one it just opened.
   */
  const rows = useCallback(
    () =>
      [...(ref.current?.querySelectorAll<HTMLButtonElement>('[data-menu-row]') ?? [])].filter(
        (button) => button.closest('[data-menu-panel]') === ref.current && !button.disabled,
      ),
    [ref],
  );

  const focusRow = useCallback(
    (id: string) => {
      ref.current
        ?.querySelector<HTMLButtonElement>(`[data-menu-row][data-row-id="${id}"]`)
        ?.focus();
    },
    [ref],
  );

  useLayoutEffect(() => {
    if (autoFocus) rows()[0]?.focus();
  }, [autoFocus, rows]);

  const move = (from: HTMLElement, direction: 1 | -1) => {
    const list = rows();
    if (list.length === 0) return;
    const index = list.indexOf(from as HTMLButtonElement);
    list[(index + direction + list.length) % list.length]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const rowId = target.dataset['rowId'];
    const item = items.find((entry) => entry.id === rowId);

    switch (event.key) {
      case 'Escape':
        // An open submenu takes the first Escape; the menu itself takes the next one.
        if (open) setOpen(null);
        else if (onCloseSelf) onCloseSelf();
        else onDismiss();
        break;
      case 'ArrowDown':
        move(target, 1);
        break;
      case 'ArrowUp':
        move(target, -1);
        break;
      case 'ArrowRight':
        if (item && isSubmenu(item)) setOpen({ id: item.id, focusChild: true });
        else return;
        break;
      case 'ArrowLeft':
        if (onCloseSelf) onCloseSelf();
        else return;
        break;
      case 'Home':
        rows()[0]?.focus();
        break;
      case 'End': {
        const list = rows();
        list[list.length - 1]?.focus();
        break;
      }
      case 'Tab':
        // Tabbing out of a context menu means dismissing it, not walking into the page behind.
        onDismiss();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={ref}
      data-menu-panel
      className={`${styles.menu} ${className ?? ''}`}
      style={style}
      role="menu"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => {
        if (isSeparator(item)) return <hr key={item.id} className={styles.separator} />;

        const submenu = isSubmenu(item);
        const expanded = open?.id === item.id;
        const checked = isSubmenu(item) ? undefined : item.checked;

        return (
          <div key={item.id} className={styles.row}>
            <button
              type="button"
              data-menu-row
              data-row-id={item.id}
              role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              {...(checked === undefined ? {} : { 'aria-checked': checked })}
              {...(submenu ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': expanded } : {})}
              className={`${styles.item} ${item.danger ? styles.danger : ''} ${
                !isSubmenu(item) && item.primary ? styles.primary : ''
              } ${expanded ? styles.itemOpen : ''}`}
              disabled={item.disabled ?? false}
              /*
               * Hovering any row settles what is open at this level: a submenu opens, and every
               * other row closes whichever one was. Without the second half, sliding down past a
               * submenu leaves it hanging over the rows underneath it.
               */
              onPointerEnter={() => {
                if (item.disabled) return;
                setOpen(submenu ? { id: item.id, focusChild: false } : null);
              }}
              onClick={() => {
                if (isSubmenu(item)) {
                  setOpen(expanded ? null : { id: item.id, focusChild: true });
                  return;
                }
                onDismiss();
                item.run();
              }}
            >
              <span className={styles.lead} aria-hidden>
                {checked ? (
                  <Icon name="check" size={13} />
                ) : item.icon ? (
                  <Icon name={item.icon} size={14} />
                ) : null}
              </span>
              <span className={styles.label}>{item.label}</span>
              {isSubmenu(item) ? (
                <span className={styles.chevron} aria-hidden />
              ) : item.shortcut ? (
                <kbd className={styles.shortcut}>{item.shortcut}</kbd>
              ) : null}
            </button>

            {isSubmenu(item) && expanded ? (
              <Submenu
                items={item.items}
                onDismiss={onDismiss}
                autoFocus={open?.focusChild ?? false}
                onCloseSelf={() => {
                  setOpen(null);
                  focusRow(item.id);
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A child panel, placed beside the row that opened it.
 *
 * CSS puts it at the parent's right edge; this corrects only the two cases CSS cannot see. A panel
 * that would run off the right of the screen flips to the other side of its parent, and one that
 * would run off the bottom is lifted by however much it overhangs — never past the top of the
 * screen, which would trade one clipped edge for the other.
 */
function Submenu({
  items,
  onDismiss,
  onCloseSelf,
  autoFocus,
}: {
  items: MenuSpec;
  onDismiss: () => void;
  onCloseSelf: () => void;
  autoFocus: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const margin = 8;
    const box = element.getBoundingClientRect();
    if (box.right > globalThis.innerWidth - margin) setFlipped(true);
    const overhang = box.bottom - (globalThis.innerHeight - margin);
    if (overhang > 0) setLift(Math.min(overhang, Math.max(0, box.top - margin)));
  }, []);

  return (
    <MenuPanel
      panelRef={ref}
      items={items}
      onDismiss={onDismiss}
      onCloseSelf={onCloseSelf}
      autoFocus={autoFocus}
      className={`${styles.submenu} ${flipped ? styles.submenuFlipped : ''}`}
      style={lift ? { marginTop: -lift } : undefined}
    />
  );
}

export function ContextMenu({ request, onClose }: { request: MenuRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: request.x, y: request.y });

  /*
   * Flip rather than clamp: a menu opened near the right edge should grow left, not straddle it.
   *
   * Measured in a layout effect, which runs before the browser paints, so the corrected position is
   * the only one ever seen. The obvious alternative — render it hidden, measure, then reveal — is
   * wrong here for a reason that is easy to miss: a `visibility: hidden` element cannot take focus,
   * so the first item would silently fail to receive it and the menu would open with focus still
   * outside it, unreachable by the arrow keys.
   */
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 8;
    const x =
      request.x + width > globalThis.innerWidth - margin
        ? Math.max(margin, request.x - width)
        : request.x;
    const y =
      request.y + height > globalThis.innerHeight - margin
        ? Math.max(margin, request.y - height)
        : request.y;
    setPosition({ x, y });
  }, [request.x, request.y]);

  /* Dismissal. Attached a tick late so the gesture that opened the menu cannot also close it. */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // A target that is not a node cannot be inside the menu, and `contains` throws on one.
      const target = event.target;
      if (!(target instanceof Node) || !ref.current?.contains(target)) onClose();
    };
    const onBlur = () => onClose();
    const timer = setTimeout(() => {
      globalThis.addEventListener('pointerdown', onPointerDown, true);
      globalThis.addEventListener('blur', onBlur);
      globalThis.addEventListener('resize', onBlur);
    }, 0);

    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener('pointerdown', onPointerDown, true);
      globalThis.removeEventListener('blur', onBlur);
      globalThis.removeEventListener('resize', onBlur);
    };
  }, [onClose]);

  /* Hand focus back to whatever had it when the menu goes away; the panel takes it from there. */
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <MenuPanel
      panelRef={ref}
      items={request.items}
      onDismiss={onClose}
      autoFocus
      style={{ left: position.x, top: position.y }}
    />,
    document.body,
  );
}

/* -------------------------------------------------------------------------------------------- */

export interface ContextMenuController {
  menu: MenuRequest | null;
  /** Opens at the pointer, or at the element's corner when raised from the keyboard. */
  open: (event: React.MouseEvent | React.KeyboardEvent, items: MenuSpec) => void;
  /**
   * Opens flush under an element, ignoring the pointer entirely.
   *
   * What a menu bar needs: a menu dropped from "Edit" belongs under the word Edit, whether it was
   * reached by click, by keyboard, or by sliding along an already-open bar — and in none of those
   * cases is where the pointer happens to be the right answer.
   */
  openUnder: (anchor: HTMLElement, items: MenuSpec) => void;
  close: () => void;
}

export function useContextMenu(): ContextMenuController {
  const [menu, setMenu] = useState<MenuRequest | null>(null);

  const open = useCallback((event: React.MouseEvent | React.KeyboardEvent, items: MenuSpec) => {
    event.preventDefault();
    event.stopPropagation();

    // A keyboard-raised menu has no pointer position; anchor it to the element instead.
    if ('clientX' in event && (event.clientX !== 0 || event.clientY !== 0)) {
      setMenu({ x: event.clientX, y: event.clientY, items });
      return;
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: Math.round(box.left + 8), y: Math.round(box.bottom - 4), items });
  }, []);

  const openUnder = useCallback((anchor: HTMLElement, items: MenuSpec) => {
    const box = anchor.getBoundingClientRect();
    setMenu({ x: Math.round(box.left), y: Math.round(box.bottom), items });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, open, openUnder, close };
}

/**
 * Whether the browser's own menu should be left alone.
 *
 * Editable text and selected text are the two places where ours is strictly worse: cut, paste,
 * spell-check, look-up and translate are things a page cannot offer, and replacing them with
 * "Minimise / Maximise / Close" takes function away in exchange for consistency nobody asked for.
 * A desktop-wide menu is right everywhere else, and wrong here.
 */
export function keepsNativeMenu(event: React.MouseEvent): boolean {
  if (isTypingTarget(event.target)) return true;
  const selection = globalThis.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
}

/** True for the keystrokes that mean "open the context menu here". */
export function isMenuKey(event: React.KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

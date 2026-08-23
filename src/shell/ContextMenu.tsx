import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
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
 */

export interface MenuAction {
  id: string;
  label: string;
  run: () => void;
  /** Rendered in the danger colour. Destructive, not merely important. */
  danger?: boolean;
  disabled?: boolean;
  /** Present makes this a checkable item; the value is its state. */
  checked?: boolean;
  /** Accelerator text, right-aligned. Display only — the binding lives in the command registry. */
  shortcut?: string;
}

export interface MenuSeparator {
  id: string;
  separator: true;
}

export type MenuItem = MenuAction | MenuSeparator;

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

/** Drops falsy entries, then any separator that would sit at an edge or next to another. */
function normalise(spec: MenuSpec): MenuItem[] {
  const items = spec.filter((item): item is MenuItem => Boolean(item));
  return items.filter((item, index) => {
    if (!isSeparator(item)) return true;
    const previous = items[index - 1];
    const next = items[index + 1];
    return Boolean(previous) && Boolean(next) && !isSeparator(previous!) && !isSeparator(next!);
  });
}

export function ContextMenu({ request, onClose }: { request: MenuRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: request.x, y: request.y });
  const items = normalise(request.items);

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

  /* Focus the first item, and hand focus back to whatever had it when the menu goes away. */
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const move = useCallback((from: HTMLElement, direction: 1 | -1) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])].filter(
      (button) => !button.disabled,
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(from as HTMLButtonElement);
    const next = buttons[(index + direction + buttons.length) % buttons.length];
    next?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    switch (event.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowDown':
        move(target, 1);
        break;
      case 'ArrowUp':
        move(target, -1);
        break;
      case 'Home':
        ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
        break;
      case 'End': {
        const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        buttons?.[buttons.length - 1]?.focus();
        break;
      }
      case 'Tab':
        // Tabbing out of a context menu means dismissing it, not walking into the page behind.
        onClose();
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
      className={styles.menu}
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) =>
        isSeparator(item) ? (
          <hr key={item.id} className={styles.separator} />
        ) : (
          <button
            key={item.id}
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })}
            className={`${styles.item} ${item.danger ? styles.danger : ''}`}
            disabled={item.disabled ?? false}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span className={styles.check} aria-hidden>
              {item.checked ? <Icon name="check" size={13} /> : null}
            </span>
            <span className={styles.label}>{item.label}</span>
            {item.shortcut ? <kbd className={styles.shortcut}>{item.shortcut}</kbd> : null}
          </button>
        ),
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */

export interface ContextMenuController {
  menu: MenuRequest | null;
  /** Opens at the pointer, or at the element's corner when raised from the keyboard. */
  open: (event: React.MouseEvent | React.KeyboardEvent, items: MenuSpec) => void;
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

  const close = useCallback(() => setMenu(null), []);

  return { menu, open, close };
}

/** True for the keystrokes that mean "open the context menu here". */
export function isMenuKey(event: React.KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { ContextMenu, useContextMenu, type MenuSpec } from './ContextMenu';
import styles from './MenuBar.module.css';

/**
 * A menu bar.
 *
 * The same `ContextMenu` the rest of the desktop drops at the pointer, anchored under a title
 * instead. Extracted once a second app wanted one: the drawing is the easy half, and the half worth
 * having in one place is the behaviour — a title that closes its own menu when clicked again, and a
 * bar that switches menus as the pointer slides along it without a second click.
 *
 * Menus are thunks, built at the moment one is opened. A memoised menu is a menu describing the
 * state the app was in when it was built, and every entry here reads live state to decide its
 * label, its checkmark, or whether it is greyed out.
 */

export interface MenuBarMenu {
  id: string;
  label: string;
  items: () => MenuSpec;
}

export function MenuBar({ menus, label }: { menus: MenuBarMenu[]; label: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { menu, openUnder, close } = useContextMenu();

  /*
   * Clicking an open title has to close it, and that is harder than it sounds.
   *
   * The menu's own outside-pointerdown listener runs first, in the capture phase, and has already
   * asked for a close by the time the title's click handler runs — so the handler would read null,
   * conclude the menu was shut, and open it straight back up. This ref still holds the pre-gesture
   * value at pointerdown, which is the only moment the question can be answered honestly.
   */
  const openRef = useRef<string | null>(null);
  const reopenGuard = useRef(false);
  useEffect(() => {
    openRef.current = openId;
  });

  const closeAll = useCallback(() => {
    close();
    setOpenId(null);
  }, [close]);

  const drop = (entry: MenuBarMenu, anchor: HTMLElement) => {
    setOpenId(entry.id);
    openUnder(anchor, entry.items());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const titles = [...(event.currentTarget.parentElement?.querySelectorAll('button') ?? [])];
    const index = titles.indexOf(event.currentTarget);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    titles[(index + step + titles.length) % titles.length]?.focus();
    event.preventDefault();
  };

  return (
    <>
      <div
        className={styles.bar}
        role="menubar"
        aria-label={label}
        /*
         * Sliding along an open bar moves the menu with it. One delegated handler rather than
         * `onPointerEnter` per title: `pointerover` bubbles, so this is an ordinary listener, while
         * enter and leave do not and React has to reconstruct them by diffing relatedTarget.
         */
        onPointerOver={(event) => {
          if (!openRef.current) return;
          const title = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-menu-id]');
          const id = title?.dataset.menuId;
          if (!title || !id || id === openRef.current) return;
          const entry = menus.find((candidate) => candidate.id === id);
          if (entry) drop(entry, title);
        }}
      >
        {menus.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={openId === entry.id}
            data-menu-id={entry.id}
            // One stop in the tab order for the whole bar; the arrow keys reach the rest.
            tabIndex={(openId ?? menus[0]?.id) === entry.id ? 0 : -1}
            className={`${styles.title} ${openId === entry.id ? styles.titleOpen : ''}`}
            onPointerDown={() => {
              reopenGuard.current = openRef.current === entry.id;
            }}
            onClick={(event) => {
              if (reopenGuard.current) {
                reopenGuard.current = false;
                return;
              }
              drop(entry, event.currentTarget);
            }}
            onKeyDown={onKeyDown}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/*
        Keyed so sliding from one menu to the next is a fresh mount rather than a re-render of the
        same one: the menu focuses its first item on mount and hands focus back on unmount, and
        reusing the instance would leave focus on a button that no longer exists.
      */}
      {menu ? <ContextMenu key={openId ?? 'bar'} request={menu} onClose={closeAll} /> : null}
    </>
  );
}

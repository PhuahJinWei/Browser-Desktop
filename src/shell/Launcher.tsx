import { useEffect, useRef, useState, type RefObject } from 'react';
import { launcherApps, launchApp, launchInstalledApp, searchFiles } from '../kernel/apps';
import { useInstalledApps } from '../kernel/installedApps';
import { hideIcon, isIconHidden, showIcon } from '../kernel/desktop';
import { useSetting } from '../kernel/settings';
import { vfs } from '../kernel/vfs/client';
import { ROOT_ID } from '../kernel/vfs/types';
import { closeAllWindows } from '../kernel/windows';
import { TabulaMark } from './ColorIcon';
import {
  ContextMenu,
  separator,
  useContextMenu,
  type MenuRequest,
  type MenuSpec,
} from './ContextMenu';
import type { IconName } from './Icon';
import { Icon } from './Icon';
import { AppIcon } from './PixelIcon';
import styles from './Launcher.module.css';

interface LauncherProps {
  onClose: () => void;
  /** Opens the command palette, which is what Run… is on this desktop. */
  onRun: () => void;
}

/**
 * The app launcher — the Start menu.
 *
 * Two menus rather than one restyled: the 1990s Start menu and a current one are different
 * structures, not different paint. Classic is a column of large rows with flyouts — Programs, Find,
 * Run…, Shut Down… — and modern is a panel with a search field over a grid of apps. Each is what
 * someone who used that desktop would reach for.
 */
export function Launcher(props: LauncherProps) {
  return useSetting('skin') === 'classic' ? (
    <ClassicStartMenu {...props} />
  ) : (
    <ModernStartMenu {...props} />
  );
}

/**
 * Clicking anywhere outside closes, which is what a popover is expected to do.
 *
 * Menus opened from inside render in a portal, outside the panel. Treating a click on one as a click
 * outside closed the launcher under the pointer, and the menu with it, before the item could run.
 */
function useDismissOnOutsidePointer(panelRef: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // A target that is not a node cannot be inside the panel, and `contains` throws on one.
      const target = event.target;
      if (!(target instanceof Node)) return onClose();
      if (panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[role="menu"]')) return;
      onClose();
    };
    // Deferred so the click that opened the launcher does not immediately close it.
    const timer = setTimeout(() => globalThis.addEventListener('pointerdown', onPointerDown), 0);
    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener('pointerdown', onPointerDown);
    };
  }, [panelRef, onClose]);
}

/* -------------------------------------------------------------------------------------------- */
/* Classic                                                                                        */
/* -------------------------------------------------------------------------------------------- */

interface StartRow {
  id: string;
  label: string;
  icon: IconName;
  /** Opens a flyout to the right. */
  items?: () => MenuSpec;
  run?: () => void;
}

/**
 * The 1990s Start menu: large-icon rows under the banner, with the apps one level in, under
 * Programs.
 *
 * There is no search box, because there was none: Find ▸ Files or Folders… is how this menu
 * searched, and it opens the same search in Files that the modern box hands its query to. Run… is
 * the command palette, which is what typing a command in had become. Shut Down… offers only what a
 * tab can honestly do — the tab stays open, so there is no "shut down" on it.
 *
 * The flyouts are the desktop's own menu component, so they get its keyboard handling, submenus
 * and focus return for nothing.
 */
function ClassicStartMenu({ onClose, onRun }: LauncherProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const installed = useInstalledApps();
  const [flyout, setFlyout] = useState<{ id: string; request: MenuRequest } | null>(null);
  useDismissOnOutsidePointer(panelRef, onClose);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  const then = (action: () => void) => () => {
    action();
    onClose();
  };

  const openDocuments = async () => {
    const children = await vfs.list(ROOT_ID);
    const folder = children.find((node) => node.kind === 'directory' && node.name === 'Documents');
    launchApp('files', {
      args: { directoryId: folder?.id ?? ROOT_ID },
      title: folder ? 'Documents' : 'Files',
    });
  };

  const rows: (StartRow | 'separator')[] = [
    {
      id: 'programs',
      label: 'Programs',
      icon: 'folder',
      items: () => [
        ...launcherApps().map((app) => ({
          id: `programs.${app.id}`,
          label: app.name,
          icon: app.icon,
          run: then(() => launchApp(app.id)),
        })),
        installed.length > 0 && separator('programs.installed'),
        ...installed.map((app) => ({
          id: `programs.installed.${app.id}`,
          label: app.manifest.name,
          icon: 'apps' as const,
          run: then(() =>
            launchInstalledApp(app.id, app.manifest.name, {
              ...(app.manifest.defaultSize ? { size: app.manifest.defaultSize } : {}),
            }),
          ),
        })),
      ],
    },
    { id: 'documents', label: 'Documents', icon: 'note', run: then(() => void openDocuments()) },
    { id: 'settings', label: 'Settings', icon: 'settings', run: then(() => launchApp('settings')) },
    {
      id: 'find',
      label: 'Find',
      icon: 'search',
      items: () => [
        {
          id: 'find.files',
          label: 'Files or Folders…',
          icon: 'folder',
          run: then(() => searchFiles()),
        },
      ],
    },
    { id: 'run', label: 'Run…', icon: 'apps', run: then(onRun) },
    'separator',
    {
      id: 'shutdown',
      label: 'Shut Down…',
      icon: 'computer',
      items: () => [
        { id: 'power.close', label: 'Close all windows', run: then(closeAllWindows) },
        { id: 'power.restart', label: 'Restart', run: () => location.reload() },
      ],
    },
  ];

  /* A flyout opens beside its row, level with it, the way this menu's always did. */
  const openFlyout = (row: StartRow, anchor: HTMLElement) => {
    if (!row.items) return;
    const box = anchor.getBoundingClientRect();
    setFlyout({
      id: row.id,
      request: { x: Math.round(box.right) - 2, y: Math.round(box.top) - 3, items: row.items() },
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (index: number) => items[(index + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') focus(current + 1);
    else if (event.key === 'ArrowUp') focus(current - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(items.length - 1);
    else if (event.key === 'ArrowRight' && current >= 0) {
      const row = rows.filter((entry) => entry !== 'separator')[current];
      const anchor = items[current];
      if (row && anchor) openFlyout(row, anchor);
    } else return;
    event.preventDefault();
  };

  return (
    <div
      className={`${styles.panel} ${styles.classicPanel}`}
      ref={panelRef}
      onKeyDown={onKeyDown}
      role="menu"
      aria-label="Start"
    >
      {rows.map((row, index) =>
        row === 'separator' ? (
          <div key={`separator-${index}`} className={styles.startSeparator} role="separator" />
        ) : (
          <button
            key={row.id}
            type="button"
            role="menuitem"
            aria-haspopup={row.items ? 'menu' : undefined}
            aria-expanded={row.items ? flyout?.id === row.id : undefined}
            className={`${styles.startRow} ${flyout?.id === row.id ? styles.startRowOpen : ''}`}
            onPointerEnter={(event) => {
              if (row.items) {
                if (flyout?.id !== row.id) openFlyout(row, event.currentTarget);
              } else if (flyout) setFlyout(null);
            }}
            onClick={(event) => {
              if (row.items) openFlyout(row, event.currentTarget);
              else row.run?.();
            }}
          >
            <AppIcon name={row.icon} size={32} />
            <span className={styles.startLabel}>{row.label}</span>
            {row.items ? <span className={styles.startArrow} aria-hidden /> : null}
          </button>
        ),
      )}

      {flyout ? <ContextMenu request={flyout.request} onClose={() => setFlyout(null)} /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Modern                                                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * A grid of apps under a search box. Typing narrows the apps by name; anything that is not an app
 * is handed to Files as a search inside every file, so the launcher adds a way in to search without
 * adding a second place results are shown. Running commands stays in the command palette.
 */
function ModernStartMenu({ onClose }: LauncherProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const iconSize = 32;
  const needle = query.trim().toLowerCase();
  const apps = launcherApps().filter((app) => app.name.toLowerCase().includes(needle));
  const installed = useInstalledApps().filter((app) =>
    app.manifest.name.toLowerCase().includes(needle),
  );
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  /* The launcher is where an app that was removed from the desktop can be put back. */
  const appMenu = (id: string, name: string, run: () => void) => {
    const hidden = isIconHidden(id);
    return [
      { id: 'launch.open', label: `Open ${name}`, run },
      separator('launch.s1'),
      hidden
        ? { id: 'launch.add', label: 'Add to desktop', run: () => showIcon(id) }
        : { id: 'launch.remove', label: 'Remove from desktop', run: () => hideIcon(id) },
    ];
  };

  // Focus starts in the search box, so opening the menu and typing is a search — as it is on the
  // desktops this imitates. The grid is one arrow key below it.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useDismissOnOutsidePointer(panelRef, onClose);

  const open = (appId: string) => {
    launchApp(appId);
    onClose();
  };

  const search = () => {
    searchFiles(query.trim());
    onClose();
  };

  /*
   * Arrow keys move through whatever is listed now, read from the DOM rather than from an index
   * into the app list: filtering changes what is listed, and the search row is not an app.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.target === searchRef.current) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === 'Enter' && needle) {
        // The best match is the first thing listed: an app if the name matches one, otherwise the
        // search itself.
        event.preventDefault();
        items[0]?.click();
      }
      return;
    }

    const columns =
      getComputedStyle(panelRef.current?.querySelector(`.${styles.grid}`) ?? document.body)
        .gridTemplateColumns.split(' ')
        .filter(Boolean).length || 1;
    const move = (delta: number) => {
      event.preventDefault();
      const next = current + delta;
      if (next < 0) searchRef.current?.focus();
      else items[Math.min(items.length - 1, next)]?.focus();
    };
    if (event.key === 'ArrowRight') move(1);
    else if (event.key === 'ArrowLeft') move(-1);
    else if (event.key === 'ArrowDown') move(columns);
    else if (event.key === 'ArrowUp') move(-columns);
  };

  return (
    <div
      className={styles.panel}
      ref={panelRef}
      onKeyDown={onKeyDown}
      role="menu"
      aria-label="Start"
    >
      <div className={styles.body}>
        <label className={styles.search}>
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps and files"
            aria-label="Search apps by name, or press Enter to search inside every file"
            type="search"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <p className={styles.heading}>Apps</p>
        <div className={styles.grid}>
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              role="menuitem"
              className={styles.app}
              title={app.description}
              onClick={() => open(app.id)}
              onContextMenu={(event) =>
                openMenu(
                  event,
                  appMenu(app.id, app.name, () => open(app.id)),
                )
              }
            >
              <span className={styles.appIcon}>
                <AppIcon name={app.icon} size={iconSize} />
              </span>
              <span className={styles.appName}>{app.name}</span>
            </button>
          ))}
        </div>

        {installed.length > 0 ? (
          <>
            <p className={styles.heading}>Installed apps</p>
            <div className={styles.grid}>
              {installed.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  role="menuitem"
                  className={styles.app}
                  title={app.manifest.description}
                  onClick={() => {
                    launchInstalledApp(app.id, app.manifest.name, {
                      ...(app.manifest.defaultSize ? { size: app.manifest.defaultSize } : {}),
                    });
                    onClose();
                  }}
                >
                  <span className={styles.appIcon}>
                    <AppIcon name="apps" size={iconSize} />
                  </span>
                  <span className={styles.appName}>{app.manifest.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {needle ? (
          <>
            <p className={styles.heading}>Files</p>
            <button type="button" role="menuitem" className={styles.searchRow} onClick={search}>
              <Icon name="search" size={16} />
              <span>Search inside every file for “{query.trim()}”</span>
            </button>
          </>
        ) : null}
      </div>

      {/*
        The strip along the foot: whose desktop this is on the left, Settings and power on the
        right. There is no account to show, so the left names the desktop rather than a person.

        Power offers what a tab can honestly do. "Shut down" would be a lie — the tab stays open —
        so it is "Close all windows", and Restart reloads the page, which is what restarting this
        desktop means.
      */}
      <div className={styles.footer}>
        <span className={styles.brand}>
          <TabulaMark size={28} />
          Tabula
        </span>
        <button
          type="button"
          className={styles.footerButton}
          aria-label="Settings"
          title="Settings"
          onClick={() => open('settings')}
        >
          <Icon name="settings" size={18} />
        </button>
        <button
          type="button"
          className={styles.footerButton}
          aria-label="Power"
          title="Power"
          aria-haspopup="menu"
          onClick={(event) =>
            openMenu(event, [
              {
                id: 'power.close',
                label: 'Close all windows',
                run: () => {
                  closeAllWindows();
                  onClose();
                },
              },
              { id: 'power.restart', label: 'Restart', run: () => location.reload() },
            ])
          }
        >
          <Icon name="power" size={18} />
        </button>
      </div>

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </div>
  );
}

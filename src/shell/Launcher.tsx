import { useEffect, useRef, useState } from 'react';
import { launcherApps, launchApp, launchInstalledApp, searchFiles } from '../kernel/apps';
import { useInstalledApps } from '../kernel/installedApps';
import { hideIcon, isIconHidden, showIcon } from '../kernel/desktop';
import { ContextMenu, separator, useContextMenu } from './ContextMenu';
import { Icon } from './Icon';
import { AppIcon } from './PixelIcon';
import styles from './Launcher.module.css';

/**
 * The app launcher — the Start menu, in the classic skin.
 *
 * A grid of apps under a search box. Typing narrows the apps by name; anything that is not an app
 * is handed to Files as a search inside every file, so the launcher adds a way in to search without
 * adding a second place results are shown. Running commands stays in the command palette.
 */
export function Launcher({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
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

  // Clicking anywhere outside closes, which is what a popover is expected to do.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // A target that is not a node cannot be inside the panel, and `contains` throws on one.
      const target = event.target;
      if (!(target instanceof Node) || !panelRef.current?.contains(target)) onClose();
    };
    // Deferred so the click that opened the launcher does not immediately close it.
    const timer = setTimeout(() => globalThis.addEventListener('pointerdown', onPointerDown), 0);
    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

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
      aria-label="Apps"
    >
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
            onClick={() => open(app.id)}
            onContextMenu={(event) =>
              openMenu(
                event,
                appMenu(app.id, app.name, () => open(app.id)),
              )
            }
          >
            <span className={styles.appIcon}>
              <AppIcon name={app.icon} size={22} />
            </span>
            <span className={styles.appName}>{app.name}</span>
            <span className={styles.appDescription}>{app.description}</span>
          </button>
        ))}
      </div>

      {installed.length > 0 ? (
        <>
          <p className={styles.heading} style={{ marginTop: 'var(--space-4)' }}>
            Installed apps
          </p>
          <div className={styles.grid}>
            {installed.map((app) => (
              <button
                key={app.id}
                type="button"
                role="menuitem"
                className={styles.app}
                onClick={() => {
                  launchInstalledApp(app.id, app.manifest.name, {
                    ...(app.manifest.defaultSize ? { size: app.manifest.defaultSize } : {}),
                  });
                  onClose();
                }}
              >
                <span className={styles.appIcon}>
                  <AppIcon name="apps" size={22} />
                </span>
                <span className={styles.appName}>{app.manifest.name}</span>
                <span className={styles.appDescription}>{app.manifest.description}</span>
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

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </div>
  );
}

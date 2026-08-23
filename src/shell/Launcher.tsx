import { useEffect, useRef, useState } from 'react';
import { launcherApps, launchApp, launchInstalledApp } from '../kernel/apps';
import { useInstalledApps } from '../kernel/installedApps';
import { Icon } from './Icon';
import styles from './Launcher.module.css';

/**
 * The app launcher.
 *
 * Deliberately small: a grid of apps and nothing else. Anything cleverer — searching files,
 * running commands — belongs in the command palette, and duplicating it here would create two
 * places to keep in step.
 */
export function Launcher({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const apps = launcherApps();
  const installed = useInstalledApps();

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
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

  const onKeyDown = (event: React.KeyboardEvent) => {
    const columns = 3;
    const move = (delta: number) => {
      event.preventDefault();
      const next = Math.max(0, Math.min(apps.length - 1, index + delta));
      setIndex(next);
      panelRef.current?.querySelectorAll('button')[next]?.focus();
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
      <p className={styles.heading}>Apps</p>
      <div className={styles.grid}>
        {apps.map((app, position) => (
          <button
            key={app.id}
            type="button"
            role="menuitem"
            className={styles.app}
            onClick={() => open(app.id)}
            onFocus={() => setIndex(position)}
          >
            <span className={styles.appIcon}>
              <Icon name={app.icon} size={22} />
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
                  <Icon name="apps" size={22} />
                </span>
                <span className={styles.appName}>{app.manifest.name}</span>
                <span className={styles.appDescription}>{app.manifest.description}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

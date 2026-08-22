import { launchApp, launcherApps } from '../kernel/apps';
import { Icon } from './Icon';
import styles from './DesktopIcons.module.css';

/**
 * Shortcuts on the desktop surface.
 *
 * Activated by a single click, not a double click: this is a web page, and every other web page
 * the user has ever used opens things on one click. Copying a desktop convention that fights the
 * medium would be imitation for its own sake.
 */
export function DesktopIcons() {
  const apps = launcherApps();

  return (
    <ul className={styles.list} aria-label="Desktop shortcuts">
      {apps.map((app) => (
        <li key={app.id}>
          <button
            type="button"
            className={styles.item}
            onClick={() => launchApp(app.id)}
            title={app.description}
          >
            <span className={styles.icon}>
              <Icon name={app.icon} size={24} />
            </span>
            <span className={styles.label}>{app.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

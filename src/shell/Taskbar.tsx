import { useEffect, useState } from 'react';
import { getApp } from '../kernel/apps';
import { focusWindow, minimizeWindow, useFocusedWindowId, useWindows } from '../kernel/windows';
import { useJobSummary } from '../kernel/jobs';
import { useUnreadCount } from '../kernel/notifications';
import { useCapabilities } from './capabilitiesContext';
import { Icon } from './Icon';
import { NotificationCenter } from './Notifications';
import styles from './Taskbar.module.css';

/**
 * The taskbar.
 *
 * Doubles as the system's honesty panel: the chips on the right report which inference backend is
 * live, whether background work is running, and whether the tab is online. The offline indicator
 * is not decoration — being able to point at it and say "still working" is the demo.
 */

function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Tick on the minute rather than the second: a repainting clock is a distraction, and this
    // costs one render per minute instead of sixty.
    const schedule = () => {
      const delay = (60 - new Date().getSeconds()) * 1000;
      return setTimeout(() => {
        setNow(new Date());
        timer = schedule();
      }, delay);
    };
    let timer = schedule();
    return () => clearTimeout(timer);
  }, []);

  return (
    <time className={styles.clock} dateTime={now.toISOString()}>
      {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </time>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    globalThis.addEventListener('online', update);
    globalThis.addEventListener('offline', update);
    return () => {
      globalThis.removeEventListener('online', update);
      globalThis.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

interface TaskbarProps {
  launcherOpen: boolean;
  onToggleLauncher: () => void;
  onOpenPalette: () => void;
}

export function Taskbar({ launcherOpen, onToggleLauncher, onOpenPalette }: TaskbarProps) {
  const windows = useWindows();
  const focusedId = useFocusedWindowId();
  const jobs = useJobSummary();
  const unread = useUnreadCount();
  const online = useOnline();
  const capabilities = useCapabilities();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  return (
    <div className={styles.bar} role="toolbar" aria-label="Taskbar">
      <button
        type="button"
        className={`${styles.launcher} ${launcherOpen ? styles.launcherOpen : ''}`}
        onClick={onToggleLauncher}
        aria-expanded={launcherOpen}
        aria-label="Open the app launcher"
      >
        <Icon name="apps" size={17} />
        <span className={styles.launcherLabel}>Apps</span>
      </button>

      <button type="button" className={styles.search} onClick={onOpenPalette}>
        <Icon name="search" size={15} />
        <span>Search commands…</span>
        <kbd className={styles.kbd}>Ctrl K</kbd>
      </button>

      <div className={styles.windows} role="group" aria-label="Open windows">
        {windows.map((window) => {
          const app = getApp(window.appId);
          const active = window.id === focusedId && !window.minimized;
          return (
            <button
              key={window.id}
              type="button"
              className={`${styles.task} ${active ? styles.taskActive : ''} ${
                window.minimized ? styles.taskMinimized : ''
              }`}
              onClick={() => (active ? minimizeWindow(window.id) : focusWindow(window.id))}
              aria-pressed={active}
              title={window.title}
            >
              <Icon name={app?.icon ?? 'file'} size={15} />
              <span className={styles.taskLabel}>{window.title}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.status}>
        {jobs.active > 0 || jobs.queued > 0 ? (
          <span
            className={`${styles.chip} ${styles.chipBusy}`}
            title={`${jobs.active} running, ${jobs.queued} queued`}
          >
            <span className={styles.spinner} aria-hidden />
            {jobs.active + jobs.queued}
          </span>
        ) : null}

        {!online ? (
          <span
            className={`${styles.chip} ${styles.chipOffline}`}
            title="Offline — everything still works"
          >
            <Icon name="offline" size={13} />
            offline
          </span>
        ) : null}

        <span
          className={styles.chip}
          title={
            capabilities
              ? `Inference backend: ${capabilities.backend}${
                  capabilities.gpu.vendor ? ` · GPU: ${capabilities.gpu.vendor}` : ''
                }`
              : 'Probing hardware…'
          }
        >
          <Icon name={capabilities?.backend === 'webgpu' ? 'bolt' : 'cpu'} size={13} />
          {capabilities?.backend ?? '…'}
        </span>

        <button
          type="button"
          className={`${styles.chip} ${styles.chipButton}`}
          onClick={() => setNotificationsOpen((open) => !open)}
          aria-expanded={notificationsOpen}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Icon name="bell" size={13} />
          {unread > 0 ? <span className={styles.badge}>{unread}</span> : null}
        </button>

        <Clock />
      </div>

      {notificationsOpen ? (
        <NotificationCenter onClose={() => setNotificationsOpen(false)} />
      ) : null}
    </div>
  );
}

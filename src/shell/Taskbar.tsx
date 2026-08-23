import { useEffect, useState } from 'react';
import { getApp } from '../kernel/apps';
import {
  closeAllWindows,
  closeWindow,
  focusWindow,
  minimizeAllWindows,
  minimizeWindow,
  snapWindow,
  toggleMaximize,
  useFocusedWindowId,
  useWindows,
} from '../kernel/windows';
import { launchApp } from '../kernel/apps';
import { clearNotifications } from '../kernel/notifications';
import { useJobSummary } from '../kernel/jobs';
import { useUnreadCount } from '../kernel/notifications';
import { useOnlineStatus } from '../kernel/network';
import { useCapabilities } from './capabilitiesContext';
import { ContextMenu, separator, useContextMenu, type MenuSpec } from './ContextMenu';
import { AppIcon } from './PixelIcon';
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
  const online = useOnlineStatus();
  const capabilities = useCapabilities();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const taskMenu = (id: string, minimized: boolean, snapped: boolean): MenuSpec => [
    {
      id: 'task.restore',
      label: minimized ? 'Restore' : 'Minimise',
      run: () => (minimized ? focusWindow(id) : minimizeWindow(id)),
    },
    { id: 'task.maximize', label: 'Maximise', run: () => toggleMaximize(id) },
    snapped && { id: 'task.unsnap', label: 'Free the window', run: () => snapWindow(id, null) },
    separator('task.s1'),
    { id: 'task.close', label: 'Close', run: () => closeWindow(id), danger: true },
  ];

  /*
   * The taskbar's own menu, for the strip between the buttons.
   *
   * A desktop where right-click works on the buttons but not the bar they sit in teaches the
   * gesture and then fails it, which is worse than never offering it — so the bar answers too.
   */
  const barMenu = (): MenuSpec => [
    {
      id: 'bar.showDesktop',
      label: 'Show desktop',
      disabled: windows.length === 0,
      run: minimizeAllWindows,
    },
    {
      id: 'bar.closeAll',
      label: `Close all windows${windows.length > 0 ? ` (${windows.length})` : ''}`,
      disabled: windows.length === 0,
      danger: true,
      run: closeAllWindows,
    },
    separator('bar.s1'),
    { id: 'bar.tasks', label: 'Task Manager', run: () => void launchApp('tasks') },
    {
      id: 'bar.settings',
      label: 'Settings',
      shortcut: 'Ctrl+,',
      run: () => void launchApp('settings'),
    },
  ];

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label="Taskbar"
      onContextMenu={(event) => {
        // Only the bar itself: a menu raised over a button belongs to that button.
        if (event.target !== event.currentTarget) return;
        openMenu(event, barMenu());
      }}
    >
      <button
        type="button"
        className={`${styles.launcher} ${launcherOpen ? styles.launcherOpen : ''}`}
        onClick={onToggleLauncher}
        aria-expanded={launcherOpen}
        aria-label="Open the app launcher"
      >
        <AppIcon name="apps" size={17} />
        <span className={styles.launcherLabel}>Apps</span>
      </button>

      <button type="button" className={styles.search} onClick={onOpenPalette}>
        <AppIcon name="search" size={15} />
        <span>Search commands…</span>
        <kbd className={styles.kbd}>Ctrl K</kbd>
      </button>

      <div
        className={styles.windows}
        role="group"
        aria-label="Open windows"
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) return;
          openMenu(event, barMenu());
        }}
      >
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
              onContextMenu={(event) =>
                openMenu(event, taskMenu(window.id, window.minimized, window.snap !== null))
              }
              aria-pressed={active}
              title={window.title}
            >
              <AppIcon name={app?.icon ?? 'file'} size={15} />
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
            <AppIcon name="offline" size={13} />
            offline
          </span>
        ) : null}

        <span
          onContextMenu={(event) =>
            openMenu(event, [
              { id: 'chip.about', label: 'About this machine', run: () => void launchApp('about') },
              { id: 'chip.tasks', label: 'Task Manager', run: () => void launchApp('tasks') },
              separator('chip.s1'),
              {
                id: 'chip.backend',
                label: 'Change the backend in Settings',
                run: () => void launchApp('settings'),
              },
            ])
          }
          className={styles.chip}
          title={
            capabilities
              ? `Inference backend: ${capabilities.backend}${
                  capabilities.gpu.vendor ? ` · GPU: ${capabilities.gpu.vendor}` : ''
                }`
              : 'Probing hardware…'
          }
        >
          <AppIcon name={capabilities?.backend === 'webgpu' ? 'bolt' : 'cpu'} size={13} />
          {capabilities?.backend ?? '…'}
        </span>

        <button
          type="button"
          className={`${styles.chip} ${styles.chipButton}`}
          onClick={() => setNotificationsOpen((open) => !open)}
          aria-expanded={notificationsOpen}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          onContextMenu={(event) =>
            openMenu(event, [
              {
                id: 'bell.open',
                label: notificationsOpen ? 'Hide notifications' : 'Show notifications',
                run: () => setNotificationsOpen((open) => !open),
              },
              { id: 'bell.clear', label: 'Clear all', run: clearNotifications },
            ])
          }
        >
          <AppIcon name="bell" size={13} />
          {unread > 0 ? <span className={styles.badge}>{unread}</span> : null}
        </button>

        <span
          onContextMenu={(event) =>
            openMenu(event, [
              {
                id: 'clock.about',
                label: 'About this machine',
                run: () => void launchApp('about'),
              },
            ])
          }
        >
          <Clock />
        </span>
      </div>

      {notificationsOpen ? (
        <NotificationCenter onClose={() => setNotificationsOpen(false)} />
      ) : null}
      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </div>
  );
}

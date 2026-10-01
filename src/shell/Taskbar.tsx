import { useCallback, useEffect, useRef, useState } from 'react';
import { getApp } from '../kernel/apps';
import {
  closeAllWindows,
  closeWindow,
  focusWindow,
  minimizeAllWindows,
  minimizeWindow,
  moveWindowToIndex,
  nudgeWindowOrder,
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
import { ContextMenu, separator, useContextMenu, type MenuSpec } from './ContextMenu';
import { useSetting } from '../kernel/settings';
import { TabulaMark } from './ColorIcon';
import { Icon } from './Icon';
import { AppIcon } from './PixelIcon';
import { NotificationCenter } from './Notifications';
import styles from './Taskbar.module.css';

/**
 * The taskbar.
 *
 * Doubles as the system's honesty panel: the chips on the right report whether background work is
 * running and whether the tab is online. The offline indicator is not decoration — being able to
 * point at it and say "still working" is the demo. The backend a job actually ran on is a detail
 * for System Report and Task Manager, not a permanent fixture of the bar.
 */

function Clock() {
  const [now, setNow] = useState(() => new Date());
  const classic = useSetting('skin') === 'classic';

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
      {/*
        `numeric`, not `2-digit`: the era's clock read 2:19 AM, and a padded 02:19 is one of those
        details that is wrong without being noticeably wrong. Locale still decides 12- or 24-hour,
        so this does not force an American clock onto anyone.
      */}
      <span>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      {/* A current tray shows the date under the time; 1995's showed it only on hover. */}
      {classic ? null : <span>{now.toLocaleDateString()}</span>}
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
  const classic = useSetting('skin') === 'classic';
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  /*
   * Dragging a task button to rearrange the bar.
   *
   * Pointer events rather than HTML5 drag-and-drop, which is the same choice the window drag and
   * the desktop icons made (ADR 9): the native API cannot follow the pointer without a drag image,
   * fires nothing useful on touch, and would need its own dance to be cancelled.
   *
   * The four-pixel threshold is what keeps this from stealing clicks — a button is only dragging
   * once the pointer has actually travelled, so a click that wobbles still activates the window.
   * `suppressClick` then swallows the click that a real drag would otherwise end with.
   *
   * Reordering happens live, on the button under the pointer, so the bar rearranges itself as the
   * cursor moves rather than jumping once on release.
   */
  const dragging = useRef<{ id: string; startX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onTaskPointerDown = useCallback((event: React.PointerEvent, id: string) => {
    // Left button only: the right one belongs to the context menu, and the middle to the browser.
    if (event.button !== 0) return;
    dragging.current = { id, startX: event.clientX, moved: false };

    const onMove = (move: PointerEvent) => {
      const state = dragging.current;
      if (!state) return;
      if (!state.moved && Math.abs(move.clientX - state.startX) < 4) return;
      state.moved = true;

      const over = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>('[data-task-id]');
      const overId = over?.dataset['taskId'];
      if (!overId || overId === state.id) return;

      const order = [...document.querySelectorAll<HTMLElement>('[data-task-id]')].map(
        (element) => element.dataset['taskId'],
      );
      const target = order.indexOf(overId);
      if (target !== -1) moveWindowToIndex(state.id, target);
    };

    const onUp = () => {
      suppressClick.current = dragging.current?.moved ?? false;
      dragging.current = null;
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
      globalThis.removeEventListener('pointercancel', onUp);
    };

    globalThis.addEventListener('pointermove', onMove);
    globalThis.addEventListener('pointerup', onUp);
    globalThis.addEventListener('pointercancel', onUp);
  }, []);

  const taskMenu = (id: string, minimized: boolean, snapped: boolean): MenuSpec => [
    {
      id: 'task.restore',
      label: minimized ? 'Restore' : 'Minimise',
      run: () => (minimized ? focusWindow(id) : minimizeWindow(id)),
    },
    { id: 'task.maximize', label: 'Maximise', run: () => toggleMaximize(id) },
    snapped && { id: 'task.unsnap', label: 'Free the window', run: () => snapWindow(id, null) },
    separator('task.s1'),
    // The keyboard's way to do what a drag does, so the taskbar is not the one arrangeable
    // surface here that needs a pointer.
    {
      id: 'task.left',
      label: 'Move left',
      disabled: windows[0]?.id === id,
      run: () => nudgeWindowOrder(id, -1),
    },
    {
      id: 'task.right',
      label: 'Move right',
      disabled: windows[windows.length - 1]?.id === id,
      run: () => nudgeWindowOrder(id, 1),
    },
    separator('task.s2'),
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
      {/*
        Start, search and the open windows are one group. Under modern it sits in the middle of the
        bar, which is the single most recognisable thing about a current taskbar; under classic the
        group dissolves (`display: contents`) and its members line up from the left as they did.
      */}
      <div className={styles.dock}>
        <button
          type="button"
          className={`${styles.launcher} ${launcherOpen ? styles.launcherOpen : ''}`}
          onClick={onToggleLauncher}
          aria-expanded={launcherOpen}
          aria-label="Start: open the app launcher"
          title={classic ? 'Click here to begin' : 'Start'}
        >
          {classic ? <AppIcon name="apps" size={17} /> : <TabulaMark size={24} />}
          {/* Visible under classic only; the accessible name above says "Start" in both. */}
          <span className={styles.launcherLabel}>Start</span>
        </button>

        {/*
        The accelerator moved from a visible chip to the tooltip. `title` describes rather than
        names, so the button still announces as "Search..." and the shortcut is not lost with it.
      */}
        <button
          type="button"
          className={styles.search}
          onClick={onOpenPalette}
          title="Search commands (Ctrl+K)"
        >
          {classic ? <AppIcon name="search" size={15} /> : <Icon name="search" size={16} />}
          <span>{classic ? 'Search...' : 'Search'}</span>
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
                data-task-id={window.id}
                onPointerDown={(event) => onTaskPointerDown(event, window.id)}
                onClick={() => {
                  // A drag ends in a click; that one is not the user asking to minimise.
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  if (active) minimizeWindow(window.id);
                  else focusWindow(window.id);
                }}
                onContextMenu={(event) =>
                  openMenu(event, taskMenu(window.id, window.minimized, window.snap !== null))
                }
                aria-pressed={active}
                // Hidden under modern, where a task is its icon; the name must not go with the label.
                aria-label={window.title}
                title={window.title}
              >
                <AppIcon name={app?.icon ?? 'file'} size={classic ? 15 : 24} />
                <span className={styles.taskLabel}>{window.title}</span>
              </button>
            );
          })}
        </div>
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
                label: 'My Computer',
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

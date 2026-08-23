import { useEffect, useRef } from 'react';
import {
  clearNotifications,
  dismissNotification,
  markAllRead,
  useNotifications,
  type Notification,
} from '../kernel/notifications';
import { Icon, type IconName } from './Icon';
import styles from './Notifications.module.css';

const ICONS: Record<Notification['level'], IconName> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  error: 'alert',
};

/** Toasts. Anything without a timeout — errors, and notices about a standing state — waits to be dismissed. */
export function NotificationLayer() {
  const items = useNotifications();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    for (const item of items) {
      if (item.timeout === undefined || timers.current.has(item.id)) continue;
      const timer = setTimeout(() => {
        dismissNotification(item.id);
        timers.current.delete(item.id);
      }, item.timeout);
      timers.current.set(item.id, timer);
    }

    // Clean up timers for notifications dismissed by hand before they expired.
    const live = new Set(items.map((item) => item.id));
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
  }, [items]);

  // Every notification is toasted; the timeout, or its absence, decides how long it stays. The
  // filter this replaces excluded anything without a timeout that was not an error, which quietly
  // meant a persistent notice at any other level was never shown at all.
  const toasts = items.slice(0, 4);
  if (toasts.length === 0) return null;

  return (
    // `role=status` with a polite live region: announced, but never interrupting.
    <div className={styles.toasts} role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`${styles.toast} ${styles[item.level]}`}>
          <span className={styles.toastIcon}>
            <Icon name={ICONS[item.level]} size={16} />
          </span>
          <div className={styles.toastBody}>
            <p className={styles.toastTitle}>{item.title}</p>
            {item.body ? <p className={styles.toastText}>{item.body}</p> : null}
          </div>
          {item.action ? (
            <button
              type="button"
              className={styles.toastAction}
              onClick={() => {
                item.action?.run();
                dismissNotification(item.id);
              }}
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.toastClose}
            onClick={() => dismissNotification(item.id)}
            aria-label="Dismiss"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** The history, opened from the taskbar. */
export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const items = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    markAllRead();
    const onPointerDown = (event: PointerEvent) => {
      // A target that is not a node cannot be inside the panel, and `contains` throws on one.
      const target = event.target;
      if (!(target instanceof Node) || !panelRef.current?.contains(target)) onClose();
    };
    const timer = setTimeout(() => globalThis.addEventListener('pointerdown', onPointerDown), 0);
    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  return (
    <div className={styles.center} ref={panelRef} role="dialog" aria-label="Notifications">
      <div className={styles.centerHeader}>
        <span>Notifications</span>
        {items.length > 0 ? (
          <button type="button" className={styles.clear} onClick={clearNotifications}>
            Clear all
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className={styles.centerEmpty}>Nothing to report.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.listItem}>
              <span className={`${styles.dot} ${styles[item.level]}`} aria-hidden />
              <div className={styles.listBody}>
                <p className={styles.listTitle}>{item.title}</p>
                {item.body ? <p className={styles.listText}>{item.body}</p> : null}
                <time className={styles.listTime} dateTime={new Date(item.createdAt).toISOString()}>
                  {new Date(item.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {/* The history is where a notice that outlived its toast gets acted on. */}
                {item.action ? (
                  <button
                    type="button"
                    className={styles.listAction}
                    onClick={() => {
                      item.action?.run();
                      dismissNotification(item.id);
                    }}
                  >
                    {item.action.label}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

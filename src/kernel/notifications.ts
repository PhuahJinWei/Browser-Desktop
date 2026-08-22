import { createStore, useStoreSelector } from './store';

/**
 * Notifications.
 *
 * The rule that shapes this: anything that fails in a worker must surface somewhere the user can
 * see it. An import that skipped four files, a model that would not load, an index that stalled —
 * all of it lands here rather than in a console nobody has open.
 */

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  level: NotificationLevel;
  title: string;
  body?: string;
  createdAt: number;
  /** Milliseconds before auto-dismiss; errors stay until dismissed. */
  timeout?: number;
  action?: { label: string; run: () => void };
  read: boolean;
}

interface NotificationState {
  items: Notification[];
}

const store = createStore<NotificationState>({ items: [] });

/** Keeps the centre from growing without bound in a long session. */
const MAX_ITEMS = 100;

let counter = 0;

export function notify(options: {
  level?: NotificationLevel | undefined;
  title: string;
  body?: string | undefined;
  timeout?: number | undefined;
  action?: { label: string; run: () => void } | undefined;
}): string {
  const level = options.level ?? 'info';
  const id = `note-${++counter}`;
  const notification: Notification = {
    id,
    level,
    title: options.title,
    ...(options.body ? { body: options.body } : {}),
    createdAt: Date.now(),
    // Errors are never auto-dismissed: a message that vanishes before it is read is not a message.
    ...(options.timeout !== undefined
      ? { timeout: options.timeout }
      : level === 'error'
        ? {}
        : { timeout: level === 'warning' ? 8000 : 4500 }),
    ...(options.action ? { action: options.action } : {}),
    read: false,
  };

  store.set((state) => ({ items: [notification, ...state.items].slice(0, MAX_ITEMS) }));
  return id;
}

export const notifyError = (title: string, error: unknown): string =>
  notify({
    level: 'error',
    title,
    body: error instanceof Error ? error.message : String(error),
  });

export function dismissNotification(id: string): void {
  store.set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
}

export function clearNotifications(): void {
  store.set({ items: [] });
}

export function markAllRead(): void {
  store.set((state) => ({ items: state.items.map((item) => ({ ...item, read: true })) }));
}

export function useNotifications(): Notification[] {
  return useStoreSelector(store, (state) => state.items);
}

export function useUnreadCount(): number {
  return useStoreSelector(store, (state) => state.items.filter((item) => !item.read).length);
}

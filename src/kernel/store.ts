import { useSyncExternalStore } from 'react';

/**
 * The kernel's state primitive.
 *
 * Roughly forty lines instead of a state library, for three reasons: the window manager needs
 * synchronous reads from non-React code (drag loops, the scheduler, workers), a dependency here
 * would sit in the hot path of every window drag, and `useSyncExternalStore` is the sanctioned
 * React 19 way to bind external state without tearing under concurrent rendering.
 *
 * Revisit if cross-store transactions or devtools time-travel become worth the weight.
 */
export interface Store<T> {
  get(): T;
  set(next: T | ((previous: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      // Copy first: a listener may unsubscribe during notification.
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribe a component to the whole store value. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Subscribe to a slice.
 *
 * The selector must return a primitive or a stable reference — returning a fresh object each
 * call makes React re-render forever, since `useSyncExternalStore` compares with Object.is.
 */
export function useStoreSelector<T, S>(store: Store<T>, selector: (state: T) => S): S {
  const snapshot = () => selector(store.get());
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

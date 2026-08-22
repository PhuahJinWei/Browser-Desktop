import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

describe('createStore', () => {
  it('returns the initial value and updates it', () => {
    const store = createStore({ count: 0 });
    expect(store.get().count).toBe(0);
    store.set({ count: 1 });
    expect(store.get().count).toBe(1);
  });

  it('supports functional updates', () => {
    const store = createStore(1);
    store.set((previous) => previous + 41);
    expect(store.get()).toBe(42);
  });

  it('notifies subscribers on change', () => {
    const store = createStore('a');
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('b');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the value is unchanged', () => {
    const value = { same: true };
    const store = createStore(value);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(value);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('tolerates a listener unsubscribing during notification', () => {
    // The window manager does exactly this when a window closes in response to a state change.
    const store = createStore(0);
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(() => unsubscribeFirst());
    store.subscribe(second);
    expect(() => store.set(1)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

import { createStore, useStoreSelector } from './store';

/**
 * Asking the browser not to evict the user's files.
 *
 * By default an origin's storage is "best-effort": the browser may clear it when the disk gets
 * tight, and it is under no obligation to warn anyone first. For a page that keeps a copy of a
 * cat photo that is worth losing. This desktop holds the *only* copy of everything imported into
 * it, so best-effort is the wrong default and `navigator.storage.persist()` is the way to say so.
 *
 * Kept out of `capabilities.ts` deliberately. That module probes; this one asks for something. A
 * probe with a side effect is a probe you cannot run twice to check an answer.
 *
 * Two things worth knowing about the request:
 *
 * - **It is usually not up to us.** Chromium decides from engagement heuristics — installed as an
 *   app, bookmarked, notifications granted, visited often — and answers without asking anyone. A
 *   first visit to a site the user has never seen is normally denied, and that is the expected
 *   answer rather than a failure. Firefox instead shows the user a prompt.
 * - **It is not a repair.** Persistence stops future eviction; it cannot bring back bytes that are
 *   already gone. `vfs.findBrokenFiles()` is what reports those.
 */

export interface PersistenceState {
  /** Whether storage is currently protected from eviction. */
  persisted: boolean;
  /** Whether this session has asked. False means the answer below came from a probe. */
  requested: boolean;
  supported: boolean;
}

const store = createStore<PersistenceState>({
  persisted: false,
  requested: false,
  supported: typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function',
});

export function usePersistence(): PersistenceState {
  return useStoreSelector(store, (state) => state);
}

export function persistenceState(): PersistenceState {
  return store.get();
}

let pending: Promise<boolean> | null = null;

/**
 * Requests durable storage, once per session.
 *
 * Never awaited on the boot path: in Firefox this can put a permission prompt on screen, and a
 * desktop that will not finish starting until someone answers a dialog about storage policy is a
 * worse desktop than one that asks quietly while it carries on.
 */
export function ensurePersistentStorage(): Promise<boolean> {
  pending ??= (async () => {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (typeof storage?.persist !== 'function' || typeof storage.persisted !== 'function') {
      store.set((state) => ({ ...state, supported: false }));
      return false;
    }

    try {
      // Already granted is the common case on a return visit, and asking again is pointless — in
      // Firefox it would mean prompting someone who has already said yes.
      if (await storage.persisted()) {
        store.set((state) => ({ ...state, persisted: true, supported: true }));
        return true;
      }

      const granted = await storage.persist();
      store.set((state) => ({ ...state, persisted: granted, requested: true, supported: true }));
      return granted;
    } catch {
      // Some privacy modes reject rather than answering. Absence of an answer is not an error
      // worth showing anyone: the desktop works either way, it is simply more fragile.
      store.set((state) => ({ ...state, persisted: false, requested: true }));
      return false;
    }
  })();

  return pending;
}

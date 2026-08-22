import { createStore, useStoreSelector } from './store';
import type { AppManifest, Capability } from '../sdk/protocol';

/**
 * The capability broker.
 *
 * An installed app declares what it wants; the user decides what it gets; the broker remembers
 * the answer and the host checks it on every single call. Grants are per app, per capability, and
 * revocable at any time from Settings — a decision made once is not a decision made forever.
 *
 * Declaring a permission in a manifest grants nothing. That distinction is the whole point: the
 * manifest is the app's request, and this store is the user's answer.
 */

export type GrantState = 'granted' | 'denied' | 'unasked';

interface PermissionState {
  /** appId -> capability -> decision. */
  grants: Record<string, Partial<Record<Capability, 'granted' | 'denied'>>>;
  pending: PermissionRequest | null;
}

export interface PermissionRequest {
  manifest: AppManifest;
  capability: Capability;
  /** Why the app is asking now — the method it tried to call. */
  method: string;
  resolve: (granted: boolean, remember: boolean) => void;
}

const STORAGE_KEY = 'tabula:permissions';

function load(): PermissionState['grants'] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PermissionState['grants']) : {};
  } catch {
    return {};
  }
}

const store = createStore<PermissionState>({
  grants: typeof localStorage === 'undefined' ? {} : load(),
  pending: null,
});

function persist(grants: PermissionState['grants']): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grants));
  } catch {
    /* Private mode: the grant holds for this session and is asked for again next time. */
  }
}

export function grantState(appId: string, capability: Capability): GrantState {
  return store.get().grants[appId]?.[capability] ?? 'unasked';
}

export function setGrant(appId: string, capability: Capability, decision: 'granted' | 'denied'): void {
  store.set((state) => {
    const grants = {
      ...state.grants,
      [appId]: { ...state.grants[appId], [capability]: decision },
    };
    persist(grants);
    return { ...state, grants };
  });
}

export function revokeGrant(appId: string, capability: Capability): void {
  store.set((state) => {
    const app = { ...state.grants[appId] };
    delete app[capability];
    const grants = { ...state.grants, [appId]: app };
    persist(grants);
    return { ...state, grants };
  });
}

export function revokeAll(appId: string): void {
  store.set((state) => {
    const grants = { ...state.grants };
    delete grants[appId];
    persist(grants);
    return { ...state, grants };
  });
}

export function grantsFor(appId: string): Partial<Record<Capability, 'granted' | 'denied'>> {
  return store.get().grants[appId] ?? {};
}

/**
 * Asks the user about one capability, the first time an app actually uses it.
 *
 * Prompting on use rather than at install is deliberate: "this app wants to read files" means
 * little in the abstract, and a wall of switches at install time gets clicked through. Asking at
 * the moment the app tries to do the thing gives the question a context.
 */
export function requestPermission(
  manifest: AppManifest,
  capability: Capability,
  method: string,
): Promise<boolean> {
  const existing = grantState(manifest.id, capability);
  if (existing === 'granted') return Promise.resolve(true);
  if (existing === 'denied') return Promise.resolve(false);

  // An app that did not declare a capability cannot be granted it, whatever it asks at runtime.
  if (!manifest.permissions.includes(capability)) return Promise.resolve(false);

  return enqueue(manifest, capability, method);
}

/**
 * Prompts are shown one at a time, in order.
 *
 * The first version denied any request that arrived while another prompt was open, which looked
 * like caution and was not: an app that needs two permissions would have its second silently
 * refused without the user ever being asked. A queue costs a few lines and means every request
 * gets its question.
 */
const queue: (() => void)[] = [];
let showing = false;

function enqueue(
  manifest: AppManifest,
  capability: Capability,
  method: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const show = () => {
      // The answer may have arrived while this request waited in the queue — a user granting
      // "read files" once should not be asked again because two calls raced.
      const decided = grantState(manifest.id, capability);
      if (decided !== 'unasked') {
        resolve(decided === 'granted');
        next();
        return;
      }

      showing = true;
      store.set((state) => ({
        ...state,
        pending: {
          manifest,
          capability,
          method,
          resolve: (granted, remember) => {
            store.set((current) => ({ ...current, pending: null }));
            if (remember) setGrant(manifest.id, capability, granted ? 'granted' : 'denied');
            resolve(granted);
            next();
          },
        },
      }));
    };

    queue.push(show);
    if (!showing) next();
  });
}

function next(): void {
  showing = false;
  const show = queue.shift();
  if (show) show();
}

export function usePendingPermission(): PermissionRequest | null {
  return useStoreSelector(store, (state) => state.pending);
}

export function useGrants(): PermissionState['grants'] {
  return useStoreSelector(store, (state) => state.grants);
}

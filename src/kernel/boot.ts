/**
 * Boot: register the service worker and, if necessary, reload once to gain cross-origin isolation.
 *
 * The first visit to a static host is never isolated — there is no service worker yet to add the
 * COOP/COEP headers, and those headers must be present on the document *as it loads*. So the
 * sequence is: load → register → wait for control → reload once → isolated.
 *
 * The reload is guarded by a sessionStorage flag, so a browser that refuses isolation (or a
 * failed registration) costs one extra load and then runs single-threaded rather than looping.
 * WebGPU does not require isolation, so the degraded path is slower, not broken.
 */

export type IsolationState =
  'isolated' | 'isolated-dev' | 'reloading' | 'unsupported' | 'degraded' | 'skipped-dev';

export interface BootResult {
  isolation: IsolationState;
  serviceWorkerRegistered: boolean;
  /** Set when a newer build is waiting to take over (drives "Restart OS to update"). */
  updateWaiting: boolean;
  detail: string;
}

const RELOAD_FLAG = 'tabula:coi-reload-attempted';

export async function boot(): Promise<BootResult> {
  const isolated = globalThis.crossOriginIsolated === true;

  // In dev, Vite sends the real headers, so there is nothing for the service worker to fix.
  if (!import.meta.env.PROD) {
    return {
      isolation: isolated ? 'isolated-dev' : 'skipped-dev',
      serviceWorkerRegistered: false,
      updateWaiting: false,
      detail: isolated
        ? 'Dev server is sending COOP/COEP directly; the service worker is a production concern.'
        : 'Dev server did not send COOP/COEP. Restart `npm run dev` to pick up vite.config.ts.',
    };
  }

  if (!('serviceWorker' in navigator)) {
    return {
      isolation: 'unsupported',
      serviceWorkerRegistered: false,
      updateWaiting: false,
      detail: 'No service worker support: WASM stays single-threaded. WebGPU is unaffected.',
    };
  }

  try {
    const base = import.meta.env.BASE_URL;
    const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });

    if (isolated) {
      return {
        isolation: 'isolated',
        serviceWorkerRegistered: true,
        updateWaiting: registration.waiting !== null,
        detail: 'Cross-origin isolated: SharedArrayBuffer and multi-threaded WASM are available.',
      };
    }

    // Not isolated yet. Once a worker controls the page, one reload makes the headers apply.
    await navigator.serviceWorker.ready;
    if (!sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      location.reload();
      return {
        isolation: 'reloading',
        serviceWorkerRegistered: true,
        updateWaiting: false,
        detail: 'Service worker installed; reloading once to apply isolation headers.',
      };
    }

    return {
      isolation: 'degraded',
      serviceWorkerRegistered: true,
      updateWaiting: registration.waiting !== null,
      detail:
        'Service worker is active but the page is still not isolated. Running single-threaded; ' +
        'WebGPU is unaffected.',
    };
  } catch (error) {
    return {
      isolation: 'degraded',
      serviceWorkerRegistered: false,
      updateWaiting: false,
      detail: `Service worker registration failed: ${
        error instanceof Error ? error.message : String(error)
      }. Running single-threaded.`,
    };
  }
}

/** Applies a waiting update. The page reloads when the new worker takes control. */
export async function restartForUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.waiting) {
    location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
    once: true,
  });
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
}

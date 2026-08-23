/// <reference lib="webworker" />
/**
 * Tabula service worker — one worker, two jobs.
 *
 * 1. CROSS-ORIGIN ISOLATION.
 *    GitHub Pages cannot send response headers, so `Cross-Origin-Opener-Policy` and
 *    `Cross-Origin-Embedder-Policy` are injected here instead. Without them
 *    `crossOriginIsolated` is false, `SharedArrayBuffer` is unavailable and the WASM
 *    inference backend is stuck on a single thread. (WebGPU itself does not need this,
 *    so a failed registration degrades rather than breaks — see the fallback in boot.ts.)
 *
 * 2. OFFLINE SHELL.
 *    Precaches the built app shell so a repeat visit works with the network off, which is
 *    the project's headline privacy demo. The model weights are cached the first time they are
 *    asked for rather than precached: they are 23 MB, and paying that during service-worker
 *    install would mean the first visit waits on a download before anything is cached at all.
 *
 * These cannot be two separate service workers: both need the root scope, and a second
 * registration at the same scope replaces the first. Hence one worker doing both.
 *
 * Update policy: a new worker waits until the user chooses "Restart OS to update", which
 * posts SKIP_WAITING. Nothing is swapped underneath a running desktop.
 */

// `export {}` makes this file a module, which scopes the `self` declaration below to it instead
// of clashing with the global `self` from the worker lib. Standard service-worker TS boilerplate.
export {};

declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE__: string[];
declare const __BUILD_ID__: string;

const CACHE = `tabula-shell-${__BUILD_ID__}`;

/**
 * Model weights, kept separately from the shell.
 *
 * Not keyed by build id: the weights are pinned by digest and do not change when the app does, so
 * rebuilding the desktop should not cost the user a 23 MB re-download. Filled on first request
 * rather than at install — see above.
 */
const WEIGHTS_CACHE = 'tabula-weights';
const WEIGHTS_PATH = '/models/';

/**
 * `credentialless` lets the page embed cross-origin resources that do not send CORP headers,
 * as long as they are fetched without credentials. That is what makes consent-gated model
 * downloads from a public CDN work while staying cross-origin isolated.
 */
const COEP_VALUE = 'credentialless';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` bypasses the HTTP cache so a fresh deploy never precaches stale bytes.
      await cache.addAll(__PRECACHE__.map((url) => new Request(url, { cache: 'reload' })));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('tabula-shell-') && n !== CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

/** Re-emits a response with the isolation headers attached. Opaque responses pass through. */
function withIsolationHeaders(response: Response): Response {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', COEP_VALUE);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Chromium raises a TypeError for `only-if-cached` requests that are not same-origin;
  // letting them fall through to the network stack avoids it.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  event.respondWith(
    (async () => {
      // Cache-first for anything precached: this is what makes the desktop boot offline.
      const cached = await caches.match(request, { ignoreSearch: false });
      if (cached) return withIsolationHeaders(cached);

      // Model weights: serve from their own cache, and fill it on the way past. This is what
      // makes search work with the network off, and it survives the HTTP cache being evicted.
      const url = new URL(request.url);
      if (url.origin === self.location.origin && url.pathname.includes(WEIGHTS_PATH)) {
        const weights = await caches.open(WEIGHTS_CACHE);
        const hit = await weights.match(request);
        if (hit) return withIsolationHeaders(hit);
        try {
          const response = await fetch(request);
          if (response.ok) await weights.put(request, response.clone());
          return withIsolationHeaders(response);
        } catch {
          return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' });
        }
      }

      // Under `credentialless`, cross-origin no-cors subresources must be fetched without
      // credentials, otherwise the browser blocks them in an isolated context.
      const outbound =
        request.mode === 'no-cors' && new URL(request.url).origin !== self.location.origin
          ? new Request(request, { credentials: 'omit' })
          : request;

      try {
        return withIsolationHeaders(await fetch(outbound));
      } catch {
        // Offline and not precached: navigations still resolve to the cached shell.
        if (request.mode === 'navigate') {
          const shell = await caches.match(__PRECACHE__[0] ?? '/');
          if (shell) return withIsolationHeaders(shell);
        }
        return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' });
      }
    })(),
  );
});

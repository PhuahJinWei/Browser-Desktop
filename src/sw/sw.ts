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
declare const __RUNTIME_ID__: string;
declare const __WEIGHTS_ID__: string;

const CACHE = `tabula-shell-${__BUILD_ID__}`;

/**
 * The inference stack: 13 MB of ONNX runtime and 23 MB of model weights.
 *
 * Three things are deliberate here.
 *
 * **Not precached.** Paying 36 MB during service-worker install would mean a first visit that
 * downloads the whole inference stack before anything at all is cached, for a visitor who may
 * never run a search. These fill on first use instead.
 *
 * **Cached at all.** Without this, semantic search worked only while online — the weights were
 * held by the ML library's own cache but the runtime binaries were not cached anywhere, so
 * offline the WASM 404'd and every query silently fell back to keyword-only. That was the state
 * this comment was written to end.
 *
 * **Keyed by their own versions, not the build id.** The shell cache is rebuilt on every deploy;
 * making a CSS change cost every user a 36 MB re-download would be absurd. `__RUNTIME_ID__` is
 * the onnxruntime version and `__WEIGHTS_ID__` is a digest of the digests in `models.json`, so
 * these invalidate exactly when their contents change.
 */
const RUNTIME_CACHE = `tabula-runtime-${__RUNTIME_ID__}`;
const WEIGHTS_CACHE = `tabula-weights-${__WEIGHTS_ID__}`;

/** Request paths that belong in those caches, and which one. */
function heavyAssetCache(pathname: string): string | null {
  if (pathname.includes('/runtime/')) return RUNTIME_CACHE;
  if (pathname.includes('/models/')) return WEIGHTS_CACHE;
  return null;
}

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
      const current = new Set([CACHE, RUNTIME_CACHE, WEIGHTS_CACHE]);
      await Promise.all(
        names
          .filter((n) => n.startsWith('tabula-') && !current.has(n))
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

      // Runtime and weights: serve from their own caches, filling them on the way past. This is
      // what makes search work with the network off, and it survives HTTP-cache eviction.
      const url = new URL(request.url);
      const heavyCache = url.origin === self.location.origin ? heavyAssetCache(url.pathname) : null;
      if (heavyCache) {
        const store = await caches.open(heavyCache);
        const hit = await store.match(request);
        if (hit) return withIsolationHeaders(hit);
        try {
          const response = await fetch(request);
          // Range requests answer 206 and must never be stored as if they were the whole file.
          if (response.ok && response.status === 200) {
            await store.put(request, response.clone());
          }
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

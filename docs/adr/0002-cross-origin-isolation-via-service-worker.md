# 2. Earn cross-origin isolation with our own service worker

Status: accepted (M0)

## Context

Multi-threaded WebAssembly needs `SharedArrayBuffer`, which needs cross-origin isolation, which
needs `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` response headers. GitHub
Pages cannot send headers. The usual answer is the `coi-serviceworker` library, but this app also
wants a service worker of its own for offline support — and two registrations at the same scope
do not coexist: the second replaces the first.

## Decision

Write one service worker that does both jobs: inject the isolation headers on every response, and
precache the app shell. `src/sw/sw.ts`, built to `dist/sw.js` by `tools/vite-plugin-sw.ts`.

Use `credentialless` COEP so consent-gated cross-origin model downloads still work.

## Consequences

- The first visit is not isolated (no worker yet), so boot reloads once, guarded by a
  sessionStorage flag so a browser that refuses isolation costs one load and then runs
  single-threaded instead of looping.
- Verified: served with no COOP/COEP headers at all, `crossOriginIsolated === true` after that
  one reload. This is the M0 acceptance test.
- WebGPU does not require isolation, so the degraded path is slower, not broken.
- The update path is explicit: a new worker waits until the user chooses "Restart to update".
  Nothing is swapped underneath a running desktop.
- Rejected: `vite-plugin-pwa` + `coi-serviceworker` together. Two workers cannot share one scope,
  and model caching needs custom policy anyway.

# Architecture

Version 0.1 — reflects what exists after M0. The layers below the shell are real; the shell layer
is a single diagnostic app until M1 replaces it with the desktop.

## The shape

```
┌───────────────────────── Browser tab (static files only) ──────────────────────────┐
│ SHELL (main thread, React)                                                          │
│   M0: System Report  ·  M1: desktop, window manager, taskbar, launcher, apps        │
│                                                                                     │
│ KERNEL (TypeScript, main thread)                                                    │
│   capabilities · boot/service-worker lifecycle · store · worker RPC                 │
│   M1 adds: window manager · VFS · job scheduler · model registry · permissions      │
│                                                                                     │
│ SERVICES (workers)                                                                  │
│   probe worker · benchmark worker (ML runtime)                                      │
│   M1 adds: file I/O (OPFS sync handles) · indexer · media · pdf                     │
│                                                                                     │
│ STORAGE                                                                             │
│   OPFS: content-addressed blobs, derived data, index shards                         │
│   IndexedDB: VFS tree, settings, grants   ·   Cache API: app shell (service worker)  │
└─────────────────────────────────────────────────────────────────────────────────────┘
   ▲ serving origin — code, runtime, bundled models      ▲ huggingface.co — on consent only
```

## Boot

1. `boot()` registers the service worker.
2. If the page is not cross-origin isolated, it reloads **once** (guarded by a sessionStorage
   flag) so the worker's COOP/COEP headers apply to the document.
3. `probeCapabilities()` answers what this machine can do; `probeWorkerCapabilities()` answers the
   questions only a worker can (see below).
4. The result classifies the machine into tier A, B or C, which decides which models are offered
   and which backend runs them.

A failed registration is not fatal: WebGPU needs no isolation, so the system runs single-threaded
instead of not at all.

## Threading

The main thread renders and coordinates; everything expensive runs in a worker, because the
window manager must stay at 60 fps while models load and files index.

`src/kernel/rpc.ts` is a ~90-line typed RPC over `postMessage`: promises for calls, a `report`
channel for progress (model downloads and indexing runs are too long to be silent), transferables
for buffers, and room for the cancellation tokens the M1 scheduler needs.

Rule: file bytes cross the boundary only for display. Everything else passes ids and transferable
buffers.

## Capability probing, and a lesson

A capability probe must run in the context that will use the capability.

The first version asked whether `FileSystemFileHandle.prototype.createSyncAccessHandle` existed —
on the main thread, where it never does, because the API is worker-only. It confidently reported
"no" while the OPFS benchmark was using it successfully from a worker at 591 MB/s.

Now `probeCapabilities()` returns `null` for "not knowable from here", and `probe.worker.ts`
answers from inside a worker. Cheap fix; the interesting part is that a probe can be _confidently
wrong_, which is worse than absent.

## Inference

`src/services/ai/runtime.ts` is the single place the ML runtime is configured. Two settings matter:

- **`wasmPaths` points at `/runtime/`**, files vendored from `onnxruntime-web` by
  `tools/sync-runtime.mjs`. The default is a public CDN, which would break the two-hosts promise,
  violate `script-src 'self'`, and stop the app working offline.
- **`numThreads`** is 1 unless the page is cross-origin isolated, because without
  `SharedArrayBuffer` asking for more throws rather than degrading. Capped at 4: beyond that,
  memory bandwidth dominates and the extra workers fight the UI for cores.

Backend choice is per task, from measurement rather than assumption — see
[ADR 8](./adr/0008-backend-selection-is-measured.md).

## The service worker

One worker, two jobs, because two registrations cannot share a scope:

1. **Isolation.** It rewrites every response with COOP and COEP (`credentialless`, so consented
   cross-origin model downloads still work). This is the only way to get `SharedArrayBuffer` on a
   host that cannot send headers.
2. **Offline.** It precaches the app shell, keyed by a build hash, and serves cache-first.

Updates wait for an explicit "Restart to update" rather than swapping under a running desktop.
Built separately from the app bundle by `tools/vite-plugin-sw.ts` so it lands at a stable,
unhashed `/sw.js` with the precache list inlined.

## Content-Security-Policy

Injected as a `<meta>` tag at build time (`tools/vite-plugin-csp.ts`), production only — the dev
server needs inline scripts for Fast Refresh.

`connect-src` is the interesting directive: it is the enforceable version of the two-hosts
promise. `frame-ancestors` is deliberately absent because browsers ignore it in a meta policy;
that protection needs a real header and is listed as a known limitation.

## Storage

Content-addressed blobs in OPFS, metadata in IndexedDB — see
[ADR 6](./adr/0006-content-addressed-opfs.md). Implemented in M1.

## What M1 adds

Window manager, VFS and import pipeline, job scheduler with priorities and cancellation, model
registry with LRU unloading, and the first real apps (Files, Viewer, Notes, Search, Settings, Task
Manager). The System Report becomes the About/Stats app inside the desktop rather than the whole
page.

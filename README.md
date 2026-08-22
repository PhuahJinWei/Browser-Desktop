# Tabula

**A local-first AI desktop that runs entirely in a browser tab. Static files, no backend, no
accounts, no uploads.**

Windows, files, apps and a task manager, with machine-learning models running on your own GPU as
system services — so the desktop can search photos by what is in them, documents by what they
mean, and audio by what was said. Nothing you drop in leaves the tab.

> **Status: M0 — foundations.** What exists today is the boot layer: a capability probe, an
> inference benchmark harness, the storage and worker plumbing, the deploy pipeline. The desktop
> itself is M1. See [`plan v2.md`](./plan%20v2.md) for the roadmap and
> [`docs/benchmarks/`](./docs/benchmarks/) for what M0 measured.

---

## Why this exists

In 2026 a complete, offline-capable, GPU-accelerated AI desktop is just static files. This is the
demonstration.

## The two hosts

This page contacts exactly two hosts, ever:

1. the origin serving it (code, bundled models, sample data);
2. `huggingface.co`, only after you explicitly approve a specific model download.

No analytics, no telemetry, no third-party scripts, no CDN fonts. The ML runtime is self-hosted
rather than pulled from a CDN. The Task Manager will show every request the system makes; until
then, the network panel is the proof.

## What M0 measured

Real numbers from the reference machine (Windows 11, AMD RDNA-3, 16 cores), served with **no**
COOP/COEP headers to imitate GitHub Pages:

| Result                                         | Value                                         |
| ---------------------------------------------- | --------------------------------------------- |
| Cross-origin isolation, headers unavailable    | **achieved** via the app's own service worker |
| all-MiniLM-L6-v2 int8, threaded WASM           | **6.54 ms/chunk** median (4.24–6.83)          |
| all-MiniLM-L6-v2 int8, WebGPU                  | 14.43 ms/chunk median (14.36–15.25)           |
| OPFS, 64 MB, sync access handle                | **591 MB/s write, 781 MB/s read**             |
| App shell                                      | 216 KB raw, **68 KB gzipped**                 |
| ONNX runtime (asyncify build, the one fetched) | 22.5 MB raw, **5.4 MB gzipped**               |

The headline surprise: **threaded WASM beat WebGPU by about 2.2x** for small embedding models. The
plan had assumed the opposite, so the code changed — backend choice is now per task and cites the
measurement. That is the entire reason M0 exists.

## Running it

```bash
npm install
npm run dev
```

To check what actually ships, build and serve it the way GitHub Pages does — no special headers,
served from a subpath:

```bash
npm run build && npm run serve:pages
```

Then open `http://localhost:4180/tabula/` and run the benchmarks.

### Scripts

| Command                | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run dev`          | Dev server (sends COOP/COEP directly, so it matches production behaviour) |
| `npm run build`        | Typecheck, then build to `dist/`                                          |
| `npm run verify`       | Typecheck, lint, test, build — what CI runs                               |
| `npm run serve:pages`  | Serve `dist/` with no headers, imitating GitHub Pages                     |
| `npm run sync:runtime` | Copy the ONNX runtime into `public/runtime/` (runs automatically)         |
| `npm run sync:models`  | Regenerate `models.json` from the Hugging Face API                        |

## How it is built

```
src/shell      desktop UI, design tokens, boot
src/kernel     capability probe, store, worker RPC, boot/service-worker lifecycle
src/services   ai/ (runtime config) · bench/ (benchmark worker)
src/apps       system apps — currently the System Report
src/sw         the service worker: cross-origin isolation + offline shell
tools          build plugins and generators (registry, runtime sync, Pages simulator)
docs/adr       architecture decision records
```

Design notes worth the click:

- [ADR 2 — one service worker doing two jobs](./docs/adr/0002-cross-origin-isolation-via-service-worker.md):
  isolation headers on a host that cannot send headers.
- [ADR 8 — backend selection is measured](./docs/adr/0008-backend-selection-is-measured.md): why
  the GPU is not always the answer.
- [ADR 3 — model weights in tiers](./docs/adr/0003-model-weights-in-tiers.md): keeping a first
  visit small while still offering big models.

## Browser support

| Browser               | Status                                                                           |
| --------------------- | -------------------------------------------------------------------------------- |
| Chrome / Edge desktop | Primary target. Folder picker, persisted directory handles, optional built-in AI |
| Firefox 147+ desktop  | Supported. Drag-and-drop import; no folder re-linking                            |
| Safari 26 (macOS)     | Supported. Drag-and-drop import; no folder re-linking                            |
| Mobile                | Best effort. Tiny models only                                                    |

Desktop-first and Chromium-first, degrading explicitly rather than silently.

## Limitations

Stated plainly, because a portfolio piece that hides these is worth less:

- **M0 is not a desktop yet.** No windows, no file manager, no search. That is M1.
- **One benchmark machine.** Tier-A desktop, Chromium only. Tier-B and other engines are pending.
- **`frame-ancestors` cannot be enforced.** Browsers ignore it in a `<meta>` policy and GitHub
  Pages cannot send headers.
- **First visit that uses AI costs ~28 MB** (5.4 MB runtime + 22.6 MB model), cached thereafter.
- **Storage quota is browser-granted**, roughly 3 GB on the reference machine. Large model
  collections will hit it.
- **The Node-side dependencies of the ML library** (`sharp`, `onnxruntime-node`) are installed but
  never shipped; CI asserts they stay out of the browser bundle.

## Licence

Code: MIT (see [LICENSE](./LICENSE)). Models and third-party components keep their own licences —
see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). MobileCLIP is Apple ASCL; check it before
any commercial use.

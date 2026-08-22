# Tabula

**A local-first AI desktop that runs entirely in a browser tab. Static files, no backend, no
accounts, no uploads.**

Windows, files, notes and a task manager, with machine-learning models running on your own
hardware as system services — so you can search your documents by what they _mean_, not just by
what they are called. Nothing you open leaves the tab.

> **Status: M2 — it sees and hears.** The desktop, file system and search from M1, plus photo
> search by description and on-device transcription. See [`plan v2.md`](./plan%20v2.md) for the
> roadmap and [`docs/benchmarks/`](./docs/benchmarks/) for what has actually been measured.

---

## The 30-second demo

1. Open the page. A small set of sample documents is generated on your device — including two real
   PDFs, written by the app itself.
2. Open **Search** and click the example _invoice for the monitor_. The top result is the invoice,
   and you get the passage, not just the file name.
3. Open **Photos** and enable image search. Then type "a hot drink" and watch it pick out the cup
   of coffee — from a picture nobody tagged, captioned or named.
4. Open **Notes**, type a heading and a sentence. It saves as a Markdown file, renames itself from
   the heading, and is searchable seconds later.
5. Open **Task Manager → Network**. Every request the page has made is listed. Your documents are
   not among them.
6. Turn off your network and reload. The desktop still boots and keyword search still works.

## Why this exists

In 2026 a complete, offline-capable, GPU-accelerated AI desktop is just static files. This is the
demonstration.

## The two hosts

This page contacts exactly two hosts, ever:

1. the origin serving it — code, and nothing else;
2. `huggingface.co`, for the embedding model on first use.

The sample documents are **generated in your browser**, not downloaded. There is no analytics, no
telemetry, no third-party script and no CDN font. The ML runtime is self-hosted. The Task Manager
shows the whole request log so you can check all of this rather than take it on trust.

## What it does

|                  |                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Files**        | Browse, import by drag-and-drop or picker, rename, move, trash, restore, permanently delete. Virtualised, so a folder of thousands scrolls like a folder of ten. |
| **Search**       | Hybrid semantic + keyword search over your documents, with snippets, highlights, and a label on every result saying how it was found.                            |
| **Notes**        | Markdown notes stored as ordinary files, auto-titled from the first heading, indexed as you write.                                                               |
| **Viewer**       | Text, Markdown, images and PDFs. Opens a search hit at the exact passage and marks it.                                                                           |
| **Task Manager** | Every job with progress and a cancel button, model and index statistics, storage use, and the full network log.                                                  |
| **Settings**     | Theme, accent, wallpaper, text size, motion, backend override, indexing, and every destructive operation clearly labelled.                                       |
| **Desktop**      | Drag, resize from eight edges, snap to halves and quarters, minimise, maximise, keyboard window management, session restore, command palette, notifications.     |

## Measured, not asserted

From the reference machine (Windows 11, AMD RDNA-3, 16 cores), in the deployed build:

| Result                                                    | Value                                               |
| --------------------------------------------------------- | --------------------------------------------------- |
| Cross-origin isolation on a host that cannot send headers | **achieved**, via the app's own service worker      |
| Pointer-move cost while dragging, 14 windows open         | **0.01 ms** median (one 5.4 ms commit per gesture)  |
| Hybrid search over the sample corpus                      | **2–5 ms**                                          |
| Embeddings: threaded WASM vs WebGPU                       | **6.5 vs 14.4 ms** per passage — WASM 2.2× faster   |
| OPFS, 64 MB, sync access handle                           | **591 MB/s write, 781 MB/s read**                   |
| Desktop shell at boot                                     | **~90 KB gzipped** (apps and pdf.js load on demand) |

The WASM result contradicted the plan's assumption that the GPU would always win, so the code
changed: backend selection is per task and cites the measurement. That is what the benchmark
harness in **About** is for — it is still there, and you can re-run it on your own machine.

## Running it

```bash
npm install
npm run dev
```

To check what actually ships, build and serve it the way GitHub Pages does — no special headers,
from a subpath:

```bash
npm run build:pages && npm run serve:pages
```

Then open `http://localhost:4180/tabula/`.

### Scripts

| Command                | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `npm run dev`          | Dev server (sends COOP/COEP directly, matching production behaviour) |
| `npm run build`        | Typecheck, then build to `dist/`                                     |
| `npm run build:pages`  | Build with the GitHub Pages base path                                |
| `npm run verify`       | Typecheck, lint, test, build — what CI runs                          |
| `npm run serve:pages`  | Serve `dist/` with no headers, imitating GitHub Pages                |
| `npm run sync:runtime` | Copy the ONNX runtime into `public/runtime/` (runs automatically)    |
| `npm run sync:models`  | Regenerate `models.json` from the Hugging Face API                   |

## How it is built

```
src/shell      desktop, window frames, taskbar, launcher, command palette, boot, design tokens
src/kernel     window manager · VFS · job scheduler · commands · settings · notifications ·
               capability probe · worker RPC · network monitor
src/services   ai/ (runtime config) · index/ (embeddings, vectors, BM25) · extract/ · bench/
src/apps       files · viewer · notes · search · settings · tasks · system-report
src/sw         the service worker: cross-origin isolation + offline shell
tools          build plugins and generators (registry, runtime sync, Pages simulator)
docs/adr       architecture decision records
```

Design notes worth the click:

- [ADR 2 — one service worker doing two jobs](./docs/adr/0002-cross-origin-isolation-via-service-worker.md):
  isolation headers on a host that cannot send headers.
- [ADR 8 — backend selection is measured](./docs/adr/0008-backend-selection-is-measured.md): why
  the GPU is not always the answer.
- [ADR 9 — direct-DOM dragging](./docs/adr/0009-direct-dom-drag.md): how the drag loop stays at
  0.01 ms, and the bug that design creates if you tidy up carelessly.
- [ADR 6 — content-addressed storage](./docs/adr/0006-content-addressed-opfs.md): why renaming and
  copying are free.
- [ADR 10 — models are tested, not assumed](./docs/adr/0010-model-choices-are-tested-not-assumed.md):
  the plan's smaller image model ranked correctly 0 times out of 6, and what that cost to find out.

## Browser support

| Browser               | Status                                                                           |
| --------------------- | -------------------------------------------------------------------------------- |
| Chrome / Edge desktop | Primary target. Folder picker, persisted directory handles, optional built-in AI |
| Firefox 147+ desktop  | Supported. Drag-and-drop and file-picker import; no folder picker                |
| Safari 26 (macOS)     | Supported. Drag-and-drop and file-picker import; no folder picker                |
| Mobile                | Best effort. Tiny models only                                                    |

Desktop-first and Chromium-first, degrading explicitly rather than silently.

## Limitations

Stated plainly, because a portfolio piece that hides these is worth less:

- **Photo search costs a 150 MB download**, and transcription a further 69 MB. Both are asked
  for first, shown with their size, and removable in Settings. Nothing downloads on its own.
- **The sample pictures are drawn, not photographed.** They are illustrations generated in your
  browser, which is enough to show the model working and avoids shipping image bytes or fetching
  them from a third host. Drag in your own photos for the real test.
- **No speech sample ships.** Speech cannot be synthesised without a voice model, so the Audio app
  offers recording and import instead of pretending. The transcription real-time factor is
  therefore reported by the app but not yet recorded in the benchmarks.
- **One benchmark machine.** Tier-A desktop, Chromium only. Tier-B and other engines are pending.
- **Search quality is honest, not tuned.** Ranking is reciprocal rank fusion over cosine
  similarity and BM25, with no learned reranking. Short generic documents can outrank better ones.
- **Offline, the first search is keyword-only** until the model has been downloaded once.
- **`frame-ancestors` cannot be enforced.** Browsers ignore it in a `<meta>` policy and GitHub
  Pages cannot send headers.
- **Files above 256 MB are refused**, because hashing needs the whole buffer in memory.
- **Storage quota is browser-granted**, roughly 3 GB on the reference machine.
- **No multi-window drag-and-drop between apps yet**, and no folder re-sync after import.

## Licence

Code: MIT (see [LICENSE](./LICENSE)). Models and third-party components keep their own licences —
see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). All sample content, icons and wallpapers
are original to this project.

# Changelog

## [Unreleased] — M1, the desktop

Added

- **Window manager**: drag, resize from eight edges, snap to halves and quarters with a live
  preview, minimise, maximise, z-order, keyboard window management on Ctrl+Alt, and session
  restore across reloads.
- **Virtual file system**: content-addressed blobs in OPFS with reference counting, a metadata
  tree in IndexedDB, trash with restore and undo, and deduplication. Runs in a worker so hashing
  never blocks the UI.
- **Files**: import by drag-and-drop, file picker or (Chromium) folder picker; rename, move,
  trash, restore, permanent delete; list and grid views; virtualised rows; context menu; keyboard
  navigation.
- **Search**: hybrid semantic and keyword retrieval — MiniLM embeddings fused with BM25 by
  reciprocal rank — with snippets, term highlighting, and a label on each result saying how it was
  found. Index persists across reloads.
- **Notes**: Markdown notes stored as ordinary files, auto-titled from the first heading, indexed
  as you type.
- **Viewer**: text, Markdown (hand-written renderer, no HTML injection), images, media playback,
  and PDFs; opens a search hit at the exact passage and marks it.
- **Task Manager**: every job with progress and cancellation, model and index statistics, storage
  use, and a full network log so the privacy claim can be checked rather than believed.
- **Settings**: theme, accent, wallpaper, text size, motion, backend override, indexing options,
  and clearly-labelled destructive operations.
- Job scheduler with priorities, cancellation and concurrency limits; command registry driving the
  palette, the launcher and the keyboard shortcuts from one source; notification centre;
  multi-tab-aware file system events.
- Sample dataset generated in the browser at first boot, including two real PDFs produced by a
  hand-written PDF writer — no downloads, no third-party content, removable in one click.

Measured

- Pointer-move handling during a drag with 14 windows open: 0.01 ms median, one 5.4 ms React
  commit per gesture.
- Hybrid search over the sample corpus: 2–5 ms.
- Desktop shell at boot: ~90 KB gzipped; apps and pdf.js load on demand.

Fixed

- Clearing inline styles after a drag wiped width and height that React believed it had already
  set, collapsing windows to their CSS minimum. The gesture now restores the captured styles.
- Offline, the first search waited 6.3 s for a model fetch that could not succeed before falling
  back to keyword results; it now checks `navigator.onLine` and answers immediately.
- Chunk offsets were rebuilt by concatenation and no longer addressed the source text, which would
  have broken search highlighting.
- `useTrash` and `usePath` declared a cancellation flag they never set.

Known gaps

- Photos and audio search (M2). Second benchmark machine and second browser engine still pending.

## [Unreleased] — M0, foundations

Added

- Vite + React 19 + TypeScript (strict) scaffold, deploying to GitHub Pages via GitHub Actions.
- Capability probe: WebGPU adapter and limits, WASM SIMD/threads, OPFS, File System Access,
  Chrome built-in AI, WebNN, media APIs, plus a hardware tier classification (A/B/C).
- Worker-context probe for capabilities the main thread cannot honestly answer.
- Single service worker providing both cross-origin isolation (COOP/COEP injection) and offline
  shell precaching, with an explicit "restart to update" flow.
- Content-Security-Policy injected at build time; ML runtime self-hosted rather than CDN-loaded.
- Benchmark harness (System Report): embedding throughput per backend and OPFS throughput, with
  JSON export.
- `models.json` generated from the Hugging Face API with exact sizes and SHA-256 digests.
- GitHub Pages simulator (`npm run serve:pages`) that sends no headers, for honest local testing.
- Eight architecture decision records; first machine's benchmarks committed.

Measured

- Threaded WASM is 2.26x faster than WebGPU for all-MiniLM-L6-v2 int8 on the reference machine
  (6.39 vs 14.43 ms per chunk), which changed backend selection to be per-task.
- OPFS sync access handles: ~591 MB/s write, ~781 MB/s read.
- Tier-0 model bundle: 64.2 MB of an 80 MB budget.

Known gaps

- Benchmarks from a second machine and a second browser engine are outstanding.
- No desktop yet: window manager, VFS and apps are M1.

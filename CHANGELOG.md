# Changelog

## [Unreleased] — M3, the app platform

Added

- **Third-party apps**, running in a sandbox with an opaque origin and no network. An app is one
  JavaScript file with its manifest in a leading comment: no build step, no package format, and
  nothing to inspect but the file itself.
- **Capability broker.** An app declares what it wants; declaring grants nothing. The user is asked
  the first time the app actually calls a method, and every grant is revocable in Settings → Apps.
- **Scoped file access.** An app reaches `Apps/<its name>/` and the one file it was opened with.
  Nothing else, whatever it was granted.
- **SDK** (`docs/sdk.md`): files, embeddings, search, notifications, clipboard, per-app storage —
  and no network capability, by design.
- **Install from a file, or from a link.** A shared app travels in the URL fragment, which browsers
  never send to a server, so sharing needs no backend.
- Three bundled apps written only against the SDK: Calculator (no permissions at all), Find
  (search), Scratchpad (scoped files, with a button that deliberately gets refused).

Verified

- A sandboxed app cannot reach localStorage, sessionStorage, cookies, IndexedDB, the Cache API,
  OPFS, the parent document, or the network; its `location.origin` is `null`. Results in
  `docs/benchmarks/`.

Fixed

- Permission requests arriving while another prompt was open were silently denied rather than
  queued, so an app needing two permissions had its second refused without the user being asked.
- Two concurrent calls could each create an app's folder, leaving `App` and `App (2)`. The lookup
  now caches the in-flight promise rather than the resolved id.
- The host could send an app its code before the frame was listening. The sandbox now announces
  itself, and the host retries.

## [Unreleased] — M2, photos and audio

Added

- **Photos**: find pictures by describing them, using CLIP image and text embeddings in one vector
  space. Grid, detail panel, "find similar", and example queries. No tags, captions or filenames
  involved.
- **Audio**: waveform player, microphone recording, on-device transcription with timestamps,
  click-to-seek transcript, lexical-cohesion chapter detection, and .srt export.
- **Transcripts are ordinary files.** Each one is written into the file system as Markdown, so it
  is indexed, searchable, viewable and deletable through machinery that already existed.
- **Model download manager**: nothing downloads without a dialog naming the model, its size, its
  host and its licence; every file is verified against a SHA-256 pinned in `models.json`; the
  download appears in the Task Manager and can be removed in Settings.
- Search now returns photos alongside documents, with a relevance cutoff relative to the best hit
  rather than a fixed threshold.
- Sample pictures are drawn in the browser at first boot — illustrations, not photographs, and no
  bytes in the repository or requests to a third host.
- Task Manager gained a Photos panel; Settings gained a model shelf.

Measured

- CLIP ViT-B/32 returned the intended picture first for 6 of 6 test queries; MobileCLIP-S0, the
  plan's smaller default, managed 0 of 6 and was rejected. See ADR 10.
- Whisper's quantised decoder exports fail to load on the current ONNX Runtime; fp16 is the
  smallest that works.

Changed

- Whisper moved from bundled to on-demand, returning the Tier-0 bundle to 22.6 MB.

Fixed

- CLIP text embeddings were padded to the longest phrase in the batch rather than CLIP's fixed
  77-token context, so every photo search failed on a broadcast error.
- The index and the file system could disagree about what was indexed — a lost snapshot left
  files marked "indexed" that no longer were, and search silently returned nothing. Startup now
  reconciles against what the index actually holds.
- Photo search switched itself off after a reload even with the model on disk; consent covers the
  download, not every session.

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

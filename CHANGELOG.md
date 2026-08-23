# Changelog

## [Unreleased] — a second skin

Added

- **A Classic skin**, in Settings → Appearance. A 1990s desktop: square corners, two-tone bevels,
  one grey, a navy title bar and a teal ground. Era-inspired rather than an impersonation — no
  vendor's logos, wordmarks or icons, and the font stack asks for faces the machine already has
  rather than downloading one, so the one-host rule is untouched.
- It is a fourth token axis (`data-skin`) beside theme, accent and wallpaper. **Classic is the
  default look**; Modern is one switch away and is unchanged by any of it. Classic supplies its own
  complete palette, so the theme and accent controls are disabled while it is on and say why, and
  the wallpapers become flat background colours — which is what the era's own Display Properties
  offered, and keeps the control doing something.
- **List views are a white well in a grey frame**, the way the era's file manager drew them: the
  toolbar and status bar are the chrome, the files sit on sunken paper between them. Selection is a
  solid navy fill with white text rather than a tint, which is both the period answer and, at 16:1,
  the highest-contrast state in either skin; the keyboard cursor stays a separate dotted rectangle,
  because a row can be focused without being selected. Files, Photos, Notes, Audio, Video, Search,
  Task Manager and the command palette.
- **Pixel-art desktop icons.** The line icons are the modern set and nothing tokens can do makes
  a 1.75px round-capped white stroke look like 1995 — the artwork was the tell. Classic now draws
  32×32 bitmaps in a sixteen-colour palette, stored as text (one character per pixel,
  `pixelIcons.ts`) and rasterised to crisp SVG at render time: no image files, no new hosts, and
  the art is reviewable in a diff. Original drawings of generic objects in the period idiom.
  Selection dithers the icon's own pixels navy, as the era did, rather than only the label.
- **Legible window controls.** Minimise, maximise, restore and close are pixel glyphs under
  Classic — one box-shadow per pixel, crisp by construction. The line icons rendered at under a
  pixel wide inside the 18×16 buttons and were close to invisible.

Fixed

- **Hover no longer eats the selection.** A rule like `.row:hover` is one pseudo-class more
  specific than `.rowSelected`, so moving the pointer over a selected row repainted it as merely
  hovered — the selection vanished under the cursor that was pointing at it, and came back when you
  moved away. It affected both skins and predates them: Files, Photos, Notes, Audio, Video, the
  Task Manager tabs, the Settings segments, the Files view toggle and the taskbar, where hovering a
  latched button flattened its dither. Hover states are now written `:hover:not(.theSelectedClass)`
  so the two cannot compete.
- The current line in Audio's transcript now inverts as its own comment claimed, instead of taking
  a grey one shade off the hover colour.

Two deliberate departures from the period, both because inaccessible detail is not authenticity
worth shipping: focus stays a visible dotted outline rather than the near-invisible original, and
the inactive title bar is two shades darker than the era's `#808080` — at the original grey its
text measured 2.9:1, the one place the palette failed WCAG. It is 5.1:1 now.

## [Unreleased] — one host

Changed

- **The embedding model ships with the build.** It was fetched from `huggingface.co` on first use
  — silently, but still a second host and still a 23 MB wait before the first search worked, and
  nothing at all on a first visit without a network. `npm run sync:weights` now fetches it once at
  release time, checks every file against the SHA-256 digests in `models.json`, and writes it into
  `public/models/`; the runtime is set to `allowRemoteModels: false` so a missing file is a loud
  404 against our own origin rather than a quiet fetch from someone else's. **This page now
  contacts exactly one host: the origin serving it.**
- Verification moved from runtime to build time, so the download manager, the progress jobs and the
  consent dialog are gone — there is nothing left to download or agree to. Settings now states what
  ships instead of offering to fetch it.
- **Semantic search works offline** — verified in Chrome 151 with the server stopped: the desktop
  boots, an uncached request returns the service worker's own 503, and a query sharing no words
  with any document still returns results labelled "meaning". Two things had to change for that.
  A `navigator.onLine` guard skipped the model and returned keyword-only results, which was right
  when the weights lived on another host and wrong once they were local. And the **ONNX runtime was
  never cached at all**: the precache filter is `js|css|html`, so `runtime/*.wasm` 404'd offline
  and no model could run whatever else was available. The service worker now caches the runtime and
  the weights on first use, in caches keyed by the onnxruntime version and by a digest of the model
  digests — so upgrading either invalidates its own cache, and shipping a CSS change costs nobody a
  36 MB re-download.

## [Unreleased] — nothing to download

Removed

- **Every on-demand model, and the features that needed one.** Photo search by description and
  find-similar, video moment search, the near-duplicate finder, transcription with chapters and
  `.srt` export, and reading text out of pictures. With them go CLIP (150 MB), Whisper tiny
  (69 MB) and TrOCR (66 MB), and the consent dialog they appeared behind — there is nothing left to
  consent to. Reasoning, and what it cost, in [ADR 15](./docs/adr/0015-no-on-demand-models.md).

Kept

- **The apps.** Photos is a picture browser with a name filter, a detail pane and thumbnails still
  generated on this device. Audio plays, records and draws a waveform. Video plays, and still saves
  the frame you are looking at or cuts the section you are watching into its own file — both are
  canvas and `MediaRecorder`, and never needed a model.
- **Semantic document search**, unchanged. It runs on the bundled 23 MB embedding model, was never
  behind a dialog, and is still hybrid semantic + keyword with snippets and highlights.
- **The measurements.** ADRs 10, 12 and 13 and their benchmark sections are retired rather than
  deleted. They record what was built and what it measured — including the two occasions where a
  benchmark reversed a decision the plan had assumed — and losing the feature does not make the
  finding untrue.

## [Unreleased] — M4, more senses

Added

- **Video moment search.** Describe something you remember seeing and get the section of the video
  it is in — a start, an end, and a jump straight to it. Frames are sampled every two seconds and
  embedded with the same CLIP model Photos uses, so a moment and a photograph live in one index.
- **Video** app: browse videos, index one on request, play just the matching section, and see how
  sure the model was and how many frames agree.
- **Save a frame** as a PNG, or **export the section** as its own video file, both beside the
  original.
- **A sample video the desktop records for itself** — eight of the sample pictures, filmed at
  512×512 over 32 seconds, drawn and encoded on the device with nothing downloaded. You watch it
  being drawn, then search it.
- **Near-duplicate finder** in Photos. Groups pictures that are the same picture — a re-save, a
  crop, a frame exported from a video — and offers to keep the first and trash the rest together.
  Two deliberate copies now ship in the sample set so there is something to find.
- **Reading text out of pictures.** A scanned page had no text to extract and so could not be
  searched; now a recognition model reads it on the device and the words go into the ordinary
  document index, where they turn up in Search with a snippet like any other file. Available from
  both Photos and the Viewer, and a sample scanned delivery note ships so there is a page to read.

Verified

- Ten queries against the sample video: seven land exactly on the right scene, one lands inside
  it, and two queries with no answer in the video correctly return nothing. Timings, scores and
  the one weak case are in `docs/benchmarks/`.
- 4.7 s to make 32 seconds of video searchable, of which the model is 4.1 s and decoding is 0.6 s.
- Duplicate detection separates cleanly: copies score 0.95–0.98 and no two different pictures in
  the sample set exceed 0.79, so the 0.92 threshold sits in an empty band. The all-pairs scan
  skips 99.6% of full comparisons using an exact bound — 6.1× faster over 5,000 vectors, with
  identical results.
- The sample scanned page reads with **no character errors at all** (0 of 270, case-insensitive),
  all ten lines found and all ten read exactly, in 3.1 seconds.

Changed

- **The optional LLM tier is removed from the roadmap**, not deferred. M5 planned conversational
  search, summaries, a tool-calling agent and generated apps; it was never started, and four
  milestones of features turned out to be retrieval problems rather than generation ones — the
  headline "find the video where I showed my red keyboard" included. Nothing shipped is lost: the
  only source change was deleting an unused member of a type union. Reasoning in ADR 14; ADR 5,
  which made the language model optional, is extended rather than reversed.
- **Text recognition runs on the CPU, not the GPU**, because that is what the measurement said:
  3.1 s against 18.4 s for the same page, and more accurate with it. TrOCR's decoder emits about a
  dozen tokens per line, and a dozen tiny sequential dispatches cost more to launch than to
  compute. `preferredBackend` now puts `text-recognition` alongside `text-embedding` on the
  WASM side — two of five inference tasks in this project, both found by measuring.

Fixed

- **`VectorIndex.search` ignored its `minScore` floor** whenever the index held fewer vectors
  than the requested limit — it was only consulted once the result list was full. Latent since M1,
  hidden by the thresholds document and photo search apply afterwards. Now an absolute floor, with
  tests.
- The index could be saved before it had been restored, writing an empty snapshot over a good one
  if a background job finished first. Writes now wait for a restore to have been attempted.
- **Frames exported from a video were the last frame, not the one asked for.** Probing a
  `MediaRecorder` file for its duration leaves the element at the end, and its `seeked` event was
  still in flight when the real seek began — so the real seek caught the stale event and reported
  success without moving.
- Thumbnails kept showing the old picture after a file was overwritten: object URLs were pooled by
  file id and never invalidated.
- **Storage is now asked to be durable at boot.** An origin's storage is "best-effort" by
  default: the browser may clear it when a disk gets tight. This desktop holds the only copy of
  everything imported into it, so it calls `navigator.storage.persist()` once per session — not
  awaited, because Firefox answers by prompting and a desktop should not stall on a storage dialog.
  The browser decides, and on a site it has not seen before it usually says no; About reports
  whichever answer it gave rather than the one probed before the request went out.
- A file whose stored bytes were missing rejected with the platform's own
  `NotFoundError` — no filename, no explanation, straight to the console as an unhandled
  rejection. It now throws a `MissingContentError` naming the file and saying what the repair is,
  and **Settings → Check files** lists every such file on demand. Metadata and content live in two
  stores that are not transactional with each other, so the state is possible; what was missing was
  any way to see it. Photos and Video no longer let that error escape as an unhandled rejection
  either — the Video stage says what happened instead of showing a black rectangle.

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

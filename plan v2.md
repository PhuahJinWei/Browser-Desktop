# Browser AI Desktop — Plan v2

**Status:** draft v2 · 2026-08-22 · supersedes `initial plan.txt`
**Owner:** project owner (sole author — see §11 Authorship)
**Convention in this document:** numbers marked `~` are estimates to be measured in M0; "verify" means confirm before relying on it.

---

## 0. What this is (one paragraph)

A **genuine desktop environment** — windows, files, apps, settings, a task manager — that runs entirely inside a browser tab, delivered as **static files from GitHub Pages at zero cost**, with no backend, no accounts and no third-party services. One local machine-learning model is a kernel service: it turns documents into vectors so the OS can search them by meaning rather than by filename, and it **ships inside the build**. Nothing the user drops in ever leaves the tab, and nothing the desktop does waits on a download.

The plan below aimed wider — image, speech and text-recognition models, fetched on demand with consent. All of that was built, measured, and then removed; §6 and §7 keep the record. What survives is the part that needs nothing but the page you already loaded.

**Portfolio thesis:** _"In 2026 a complete, offline-capable, GPU-accelerated desktop is just static files."_

### Changes from v1 (`initial plan.txt`)

- Vision → execution plan: goals/non-goals, support matrix, architecture, model catalogue, milestones with definitions of done, quality bar, risks, conventions.
- The desktop is the **genuine centrepiece** (full/most functionality), not a skin; window manager built from scratch; original design.
- **Superseded, twice over.** v2 split AI into perception models (small, deterministic) plus an optional LLM tier in M5. M4 closed the LLM tier without building it, because four milestones of features turned out to be retrieval problems ([ADR 14](./docs/adr/0014-no-text-generation.md)). The perception models went next: photo search, video moment search, near-duplicate detection, transcription and OCR were built, measured and then **removed**, because a page that opens with "Download a model? 150 MB" is asking a visitor for a commitment they have no reason to make ([ADR 15](./docs/adr/0015-no-on-demand-models.md)). **One model remains, and it is in the repository.** Everything below describing the others is a record of what was planned and built, not of what ships.
- **Hybrid app model** decided up front: system apps in-process, third-party apps in sandboxed iframes, one SDK.
- Hosting constraints baked in: GitHub Pages only, weights policy in tiers, cross-origin isolation via service worker, CSP via meta, self-hosted runtime.
- Stack references updated to 2026 (Transformers.js v4 WebGPU runtime; WebGPU baseline in all major browsers; WebNN as a progressive enhancement).

---

## 1. Goals and non-goals

**Goals**

- **G1 — A real desktop.** Window management, file system, app lifecycle, settings, notifications, clipboard, keyboard-first UX, session restore. Judged on polish.
- **G2 — Local AI as a system service.** Text embeddings as a kernel service any app can call; background indexing; instant search. _Narrowed after M4:_ image, speech and text-recognition services were built and removed (ADR 15); embeddings remain.
- **G3 — Zero cost, zero backend, verifiable privacy.** Static hosting; **exactly one host is ever contacted** — the origin serving the page, which carries the code, the model and the demo data. A network monitor inside the OS proves it. (v2 allowed a second host, `huggingface.co`, for consented weights; vendoring the one remaining model closed it.) _M7 added one exception, a YouTube frame for the Watch app; Watch was removed after M7 and the claim is absolute again_ ([ADR 23](./docs/adr/0023-a-default-desktop.md)).
- **G4 — Portfolio-grade.** 30-second demo with bundled sample data; Stats panel; architecture write-up with ADRs; benchmarks with hardware listed; honest limitations.
- **G5 — A platform.** Apps are built against an SDK; third-party apps run sandboxed with capability-based permissions.

**Non-goals**

- No servers, accounts, sync, telemetry, analytics, or third-party scripts/fonts/CDNs.
- No cloud AI, and no text generation at all — local or otherwise.
- **Nothing downloaded on demand.** No consent dialogs, no "enable this feature", no weights fetched at runtime. What the page can do, it can do the moment it loads.
- Not a Windows/macOS clone — no Microsoft/Apple assets, icons or wallpapers (also an IP issue).
- No networking apps (browser-in-browser, chat clients). The in-page browser is the most-asked-for feature and stays refused ([ADR 19](./docs/adr/0019-no-browser-inside-the-browser.md)). The Portfolio app and the M7 YouTube player were removed after M7 ([ADR 23](./docs/adr/0023-a-default-desktop.md)).
- Mobile is best-effort, not a milestone gate, and not a second repository ([ADR 18](./docs/adr/0018-mobile-is-a-visit-not-a-target.md)). Single user per browser profile.

---

## 2. Principles

- **P1 Local-first, verifiable privacy** — network monitor in Task Manager; "airplane mode" demo.
- **P2 Zero-cost static** — GitHub Pages, and nothing else: the model is part of the build rather than something fetched from a second host.
- **P3 Progressive enhancement** — detect capabilities at boot (WebGPU → WASM; File System Access where available); never hard-fail.
- **P4 Polished subsets per milestone** — every milestone is a shippable portfolio state.
- **P5 Deterministic demo first** — the first 30 seconds never wait on a download, and no answer the desktop gives is generated prose: every result points into a file you can open and check.
- **P6 The OS metaphor is real** — processes, kernel services, permissions, task manager, installation — not cosmetic.
- **P7 Keyboard-first, accessible, original design.**
- **P8 Minimal dependencies in the desktop core** — libraries for ML, PDF and media only.
- **P9 Honest docs** — limitations section; benchmarks list the hardware.

---

## 3. Audience and demo script (this defines "done")

**30-second path (recruiter, non-technical)**

1. Open the URL → desktop boots in < 2 s on a repeat visit; sample files are already there ("Sample data — clear anytime").
2. Press the launcher key (or click Search) → type _"invoice for the monitor"_ → ranked results with highlighted passages from the sample PDFs → Enter opens the PDF at that page.
3. Open **Video → Sample** → the desktop draws and encodes a short film in front of you, then save the frame you are looking at or cut ten seconds out of it. No model, no download.
4. Open Task Manager → model resident, backend, **"Network: 0 requests since boot."**
5. Switch the OS's airplane-mode toggle (or the browser offline) → search again → **still works, semantic half included** (verified with the server stopped).

**5-minute path (engineer)**

- About/Stats: GPU adapter, backend, model sizes, load times, embeddings/sec, search latency.
- DevTools → Network: empty after boot, no exceptions. → Application: OPFS, IndexedDB, service worker, and the caches holding the runtime and the weights.
- Import your own folder (Chromium: folder picker; others: drag-drop) → watch jobs queue with priorities and progress, cancel one, search while indexing continues.
- Open ≥ 8 windows, snap, keyboard window switcher; reload → session restored.
- Read `docs/architecture.md` and the ADRs; skim `models.json` and the CSP.

---

## 4. Support matrix and hardware tiers

| Browser                                | Import                                      | Re-link real folders        | WebGPU                               | AI                            | Status                                                                                    |
| -------------------------------------- | ------------------------------------------- | --------------------------- | ------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------- |
| Chrome / Edge desktop                  | drag-drop, `webkitdirectory`, folder picker | **yes** (persisted handles) | yes                                  | full                          | **primary target**                                                                        |
| Firefox desktop 147+                   | drag-drop, `webkitdirectory`                | no (re-import)              | yes on Windows/macOS (Linux pending) | full                          | supported                                                                                 |
| Safari 26 macOS                        | drag-drop, `webkitdirectory`                | no                          | yes                                  | full (verify OPFS throughput) | supported                                                                                 |
| Mobile (Chrome Android, iOS 26 Safari) | limited                                     | no                          | yes, memory-tight                    | works; 23 MB model            | best-effort; compact layout below 720 px, windows maximised, limited-mode notice (ADR 18) |

**Hardware tiers** (probed at boot from `navigator.gpu` adapter limits + `navigator.deviceMemory`; user-overridable in Settings). These were written to decide **which models a machine could afford**. With one 23 MB model left they no longer gate anything, and survive as a reported capability class and a throttling hint:

- **Tier A** — discrete GPU / Apple Silicon, ≥ 8 GB RAM.
- **Tier B** — integrated GPU with WebGPU.
- **Tier C** — no WebGPU (WASM only): background indexing throttled; speed warning shown.

Worth noting that the tier barely matters for the surviving model: M0 measured threaded WASM beating WebGPU by 2.2× on it, so a Tier C machine runs document search on the path the others also prefer.

---

## 5. Architecture

### 5.1 Layers

```
┌──────────────────────────── Browser tab (static files only) ─────────────────────────────┐
│ SHELL (main thread, React)                                                               │
│   desktop · window chrome · taskbar · launcher · command palette · notifications · boot  │
│   ├─ System apps (in-process React): Files · Viewer · Notes · Search · Settings ·        │
│   │  Task Manager · About · Photos · Audio · Video                                       │
│   └─ Sandboxed apps (iframe, opaque origin) ──── postMessage RPC ───┐                    │
│                                                                     │  ONE SDK surface   │
│ KERNEL (TypeScript; coordination on main thread)                    ▼                    │
│   window manager · app/process manager · VFS · IPC/event bus · job scheduler ·           │
│   model registry · settings · notifications · clipboard · multi-tab locks ·              │
│   capability/permission broker                                                           │
│                                                                                          │
│ SERVICES (workers)                                                                       │
│   index worker (WASM threads by default, WebGPU fallback) · file-IO (OPFS sync           │
│   access handles) · pdf (pdf.js) · thumbnails · benchmark                                │
│                                                                                          │
│ STORAGE                                                                                  │
│   OPFS: content-addressed blobs · derived data · index shards · model cache              │
│   IndexedDB: VFS tree + metadata · settings · permission grants · job log                │
│   Cache API (service worker): app shell · ONNX runtime · weights (keyed by version)      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
     ▲ the origin serving the page — code, runtime, the model, demo data.
       There is no second arrow: nothing else is ever contacted.
```

### 5.2 App model — hybrid (decision D04)

- **System apps** are React components registered with a manifest and run in-process for rich integration (drag-drop, theming, instant IPC). They still use only the SDK/kernel APIs — no back doors — so the SDK stays the single API.
- **Sandboxed apps** (third-party, user-installed, later generated) run in `<iframe sandbox="allow-scripts">` (no `allow-same-origin` → opaque origin → no access to the OS's storage or DOM). All capabilities go through postMessage RPC with a per-instance capability token. The permission broker prompts on first use of each capability. **There is no network capability at all.**
- **One SDK surface for both:** `os.fs`, `os.windows`, `os.ai`, `os.events`, `os.clipboard`, `os.notify`, `os.settings`, `os.apps` (Appendix B). Adapter layer: direct call (in-process) vs postMessage client (sandboxed).
- **App manifest:** id, name, icon, entry, permissions, file associations (open-with), window defaults.
- **CSP/sandbox detail to spike in M3:** `srcdoc`/`blob:` documents inherit the parent CSP, so the app runner is a same-origin HTML page loaded in a sandboxed iframe with app code delivered as `blob:` scripts (parent `script-src` gains `blob:` only then), _or_ the runner is hosted on a second free GitHub Pages origin (different org) for a fully independent CSP. Decide with a spike.

### 5.3 Threads and workers

- Main thread renders and coordinates (window manager state must be synchronous with the UI).
- **Inference workers:** one per backend; the WebGPU worker owns the device (handles `device.lost` → re-init → fallback).
- **Indexer worker:** chunking, hashing, embedding batches, index shards, search.
- **File-IO worker:** OPFS `createSyncAccessHandle` (worker-only) for fast reads/writes.
- **Media worker:** thumbnails (OffscreenCanvas/`createImageBitmap`), audio decode, WebCodecs (M4). **PDF:** pdf.js worker.
- Typed RPC over `postMessage` with transferables (Comlink or a ~100-line hand-rolled RPC — decide in M0). Rule: file bytes never cross to the main thread except for display; pass ids and transferable buffers.

### 5.4 Storage and VFS

- **Tree metadata in IndexedDB:** `node {id, parentId, name, kind, mime, size, mtime, hash, flags(trashed), indexState, thumbRef}`.
- **Content in OPFS, content-addressed** at `/blobs/<sha256>` → dedup, cheap copy, rename/move are metadata-only. Derived data (transcripts, thumbnails, extracted text) at `/derived/<hash>/…`.
- **Import always copies into OPFS** (works offline and identically across browsers). On Chromium, optionally keep a persisted directory handle for "linked folders" re-sync (M3, optional).
- **Trash:** flag + original parent; emptying removes blobs with zero references. **Undo/redo:** command log of VFS ops (in-session; persist later).
- **Quota:** request `navigator.storage.persist()`; show usage and "Export all (zip)" in Settings; everything except user files is rebuildable. _Built so far:_ `persist()`, the usage panel, and a **desktop setup export/import** (settings, icon layout, wallpaper, optionally the open windows) — the bulk file export is still open ([ADR 17](./docs/adr/0017-customisation-is-a-file.md)).
- **Import pipeline:** drag-drop (`webkitGetAsEntry` everywhere; `getAsFileSystemHandle` on Chromium), `<input webkitdirectory>`, `showDirectoryPicker()`. Streams to the file-IO worker; hash in worker (`crypto.subtle` for small files; streamed WASM hasher for large — decide in M0); thumbnails lazily.

### 5.5 Index

- **Text:** extract (txt/md direct; PDF via pdf.js text layer; a scanned page has no text layer and, since OCR was removed, stays unsearchable) → chunk (~200–300 tokens, ~15 % overlap, keep char offsets) → embed (normalized) → shard per modality as typed arrays in OPFS, held in memory for search. Plus a **full-text/BM25 index** for exact terms ("Samsung"). **Hybrid ranking** = reciprocal rank fusion of semantic + BM25. Snippets and highlights from offsets.
- ~~**Images / Audio / Video.**~~ All three were built — CLIP image embeddings, Whisper transcription with chaptering, sampled video frames in the image index — and all three were removed with their models (ADR 15). Pictures now get a thumbnail and nothing more; the index holds documents only.
- **Search:** brute-force dot product in the indexer worker over typed arrays — target < 100 ms for ~50k vectors; upgrade path: WebGPU compute-shader search (depth pocket) or HNSW-in-WASM beyond ~200k.
- **Incremental:** per-file index state (pending/done/failed/modelVersion); re-index on model version change; pause/resume; background priority below interactive work.

### 5.6 Inference kernel

- **Backends:** `wasm` (multi-thread when `crossOriginIsolated` — the service worker in §5.10 makes this true — and the measured default for the one model here), `webgpu` (fallback when threads are unavailable), `webnn` (experimental toggle, off by default). The `builtin` and `sideload` backends were never built and are not planned: the first meant Chrome's Prompt/Summarizer APIs (ADR 14 rules out generation) and the second meant users installing models (ADR 15 rules out installing anything).
- **Scheduler:** priority queue (interactive 0 · user batch 1 · background indexing 2); one GPU job per model at a time; batching for embeddings; cancellation tokens; progress events; yields between batches to keep the UI fluid; throttles when the tab is hidden (configurable).
- **Model registry (`models.json`):** id, task, source, files + sizes + sha256, license. It described a download manager — lifecycle, LRU unload by memory budget, per-file integrity at runtime — and is now a description of what ships: one model, verified at **build** time by `tools/sync-model.mjs` against the same digests.
- **Transformers.js v4 configuration:** self-hosted runtime/WASM under `/runtime/` (no jsDelivr), and self-hosted weights under `/models/` with `allowRemoteModels: false`, so a missing file is a 404 against our own origin rather than a silent fetch from someone else's. The service worker caches both on first use, keyed by the runtime version and by a digest of the model digests.

### 5.7 Weights policy (decision D05)

| Tier            | Source                                      | Rule                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 Bundled**   | in repo, same-origin                        | **The only tier.** 22.6 MB against the ~80 MB budget. Fetched and digest-checked at build time by `tools/sync-model.mjs`, committed, served from this origin, and marked `linguist-vendored` so 30k lines of tokenizer vocabulary do not read as source. |
| ~~1 On-demand~~ | ~~Hugging Face Hub~~                        | **Removed (ADR 15.)** Consent dialog, progress, resume, runtime integrity checking — all built, all deleted with the models they served.                                                                                                                 |
| ~~2 Built-in~~  | ~~Chrome Prompt / Summarizer / Translator~~ | **Never built; ruled out** by ADR 14.                                                                                                                                                                                                                    |
| ~~3 Sideload~~  | ~~user drops model files in~~               | **Never built.** "Install a model like an app" is the thing ADR 15 exists to prevent.                                                                                                                                                                    |

The README states the host list: one. The Task Manager's network monitor lists every request.

### 5.8 Security

- **CSP via `<meta http-equiv>`** (GitHub Pages cannot set headers) — draft in Appendix C; includes `'wasm-unsafe-eval'` for WebAssembly, and `connect-src` can now be `'self'` alone.
- **Cross-origin isolation** via the app's own service worker (credentialless mode) → `SharedArrayBuffer`/threads. There are no cross-origin fetches left to satisfy.
- **Sandboxed apps:** `sandbox="allow-scripts"` only; opaque origin; child CSP with no `connect-src`; capability tokens random per instance; messages schema-validated; grants persisted and revocable in Settings → Apps; folder-scoped file capabilities.
- **OS code:** no `eval`, no third-party scripts, sanitized Markdown rendering.
- **No model output is ever executed**, because no model here produces anything executable. The tool-calling agent that would have needed that rule was removed with the M5 tier ([ADR 14](./docs/adr/0014-no-text-generation.md)); file content is still treated as untrusted input everywhere it is parsed.

### 5.9 Multi-tab

Web Locks `os-leader`; non-leader tabs offer "take over" or run read-only; BroadcastChannel syncs VFS events; only the leader runs the job scheduler.

### 5.10 Offline, PWA and hosting specifics

- Bundler `base: '/<repo>/'`; hash routing; service-worker scope `/<repo>/`.
- Service worker precaches the shell; the runtime (13 MB) and the weights (23 MB) are cached on first use instead, because 36 MB during install would make a first visit pay for an inference stack it may never use. "Restart OS to update" flow; `navigator.storage.persist()` at boot; storage usage in Settings.
- **`coi-serviceworker`** (one automatic reload on first visit; app works single-threaded if registration fails).
- GitHub Actions builds and deploys (bypasses the 10-builds/hour limit); Pages limits: 1 GB site, 100 GB/month soft bandwidth, 100 MB per file in git.
- **Shared origin:** all project sites live on `user.github.io` → storage namespace and quota are shared with any other page you host. Namespace keys, or publish from a free GitHub organization (`org.github.io`) for a dedicated origin (decide in M0).
- GitHub Release assets are **not** CORS-fetchable from a page (tested 2026-08-22) — not an option for weights.

---

## 6. Model catalogue

### What ships

| Task            | Model                             | Size    | Tier    | Notes                                                                               |
| --------------- | --------------------------------- | ------- | ------- | ----------------------------------------------------------------------------------- |
| Text embeddings | `Xenova/all-MiniLM-L6-v2` (384-d) | 22.6 MB | bundled | English; in the repository; runs on threaded WASM, measured 2.2× faster than WebGPU |

That is the whole catalogue. One model, one task, in the build.

### What was considered, built, and removed

The original catalogue listed candidates for eight more tasks. Three of them shipped and were then
removed with the on-demand tier ([ADR 15](./docs/adr/0015-no-on-demand-models.md)); the rest were
never started. Kept here because the sizes are the argument — this is what "just add photo search"
actually costs a visitor.

| Task                     | Candidates considered                                    | ~Size                 | Outcome                                                                                                                            |
| ------------------------ | -------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Image–text               | `clip-vit-base-patch32` · MobileCLIP-S0/S1 · SigLIP-base | 150 MB · small · 200+ | **Built, removed.** CLIP chosen by measurement over MobileCLIP ([ADR 10](./docs/adr/0010-model-choices-are-tested-not-assumed.md)) |
| Visual similarity        | CLIP image embeddings (reuse) · DINOv2-small             | 0 · ~25 MB            | **Built, removed.** Reused CLIP; no second model needed                                                                            |
| ASR                      | `whisper-tiny`/`base`/`small` · Moonshine                | 40–250 MB · 30–60 MB  | **Built, removed.** whisper-tiny, fp16 decoder                                                                                     |
| OCR                      | tesseract.js · TrOCR · Florence-2-base                   | 15 · 65 · 250 MB      | **Built, removed.** TrOCR chosen over tesseract ([ADR 13](./docs/adr/0013-ocr.md))                                                 |
| Diarization              | pyannote segmentation-3.0                                | ~6 MB                 | Never started                                                                                                                      |
| Detection / auto-tags    | yolos-tiny · detr-resnet-50                              | 25 · 42 MB            | Never started                                                                                                                      |
| Background removal       | MODNet · BiRefNet · RMBG-1.4                             | 25 · 200+ · 45 MB     | Never started (RMBG-1.4 is non-commercial)                                                                                         |
| Translation              | opus-mt · NLLB-600M · Chrome Translator API              | 80 MB/pair · 600 MB   | Never started                                                                                                                      |
| TTS                      | Kokoro-82M                                               | 90–330 MB             | Never started                                                                                                                      |
| Higher-quality embedding | `bge-small-en-v1.5` · `multilingual-e5-small`            | 34 · 120 MB           | Never started; MiniLM is good enough at a third the size                                                                           |

**Never in this catalogue, deliberately:** language models and vision-language captioners — Gemini
Nano through the Chrome Prompt API, Qwen via Transformers.js or WebLLM, SmolVLM, Florence-2. v2
listed them as an optional M5 tier; M4 closed it without building it
([ADR 14](./docs/adr/0014-no-text-generation.md)). The surviving model answers a question about a
file the user already has, which is why it cannot invent an answer.

**Document text** still comes from the pdf.js text layer, which is a library rather than a model. A
scanned page has no text layer and — since OCR went — stays unsearchable. That is a real
limitation, stated rather than papered over.

## 7. Milestones

Effort is in **FTE-weeks** (~35–40 focused hours). Scale to your weekly hours and **re-estimate after M1** — it calibrates everything. Each milestone ends with a tagged release and is a complete, polished portfolio state.

### M0 — Foundations (~1 FTE-week)

**Scope:** repo scaffold (Vite + React + TypeScript strict); GitHub Actions → Pages deploy with base path; `coi-serviceworker`; CSP meta; PWA skeleton; design tokens + light/dark theme + placeholder name/logo; capability probe (WebGPU adapter, device memory, OPFS, File System Access); **benchmark harness page** (load + run candidate models on WASM and WebGPU; sizes, load time, throughput; OPFS read/write throughput); pick the Tier-0 bundle within budget; ADRs 01–05.
**Done when:** `crossOriginIsolated === true` on the deployed Pages site; benchmark JSON from ≥ 2 machines (your dev box + a weaker iGPU laptop or throttled profile) committed under `docs/benchmarks/`; `models.json` v0; open decisions in §13 resolved and recorded.

### M1 — A real desktop · v0.1 · first public portfolio state (~5–7 FTE-weeks)

**Platform:** window manager (create/move/resize with 8 handles, snap halves + quarters, minimize/maximize/restore/close, z-order, focus management, keyboard move/resize and window switcher; 60 fps budget); desktop + wallpaper; taskbar (running apps, clock, status chips: backend/GPU/offline); launcher; command palette (apps, files, commands, settings); notifications centre; settings store; **session restore**; shortcut registry; theming (light/dark/system, accent, reduced motion, font size); **boot sequence** (capability probe shown as a splash — doubles as the flex — then restore); kernel job scheduler + **Task Manager** (jobs, models, memory, backend, **network monitor**); VFS + file-IO worker + import pipeline; multi-tab lock.
**Apps:** **Files** (tree + list/grid, virtualized, breadcrumbs, rename/move/copy/delete/trash/restore/undo, properties, sort/filter, context menus, drag-drop within/between windows, open-with); **Viewer** (text/markdown/images/PDF via pdf.js); **Notes** (plain/markdown, autosave → instantly searchable); **Search** (semantic + full-text over txt/md/pdf; snippets, highlights, open at location); **Settings**; **Task Manager**; **About/Stats**.
**AI:** embeddings service (bundled model) on WebGPU with WASM fallback; indexer worker with priorities, cancel, progress; hybrid ranking.
**Demo:** bundled sample dataset auto-imported on first boot (with "Clear sample data"); 3-step welcome tour.
**Done when (measurable):** ≥ 8 windows dragged/resized at 60 fps (performance marks); keyboard-only run of the demo script; import of 1,000 files without UI jank (measured); search < 200 ms over 10k chunks; session restores after reload; PWA installable and fully functional offline on repeat visit; network monitor shows 0 requests post-boot; axe clean on shell/Files/Search; CI green (typecheck, lint, unit, Playwright smoke on WASM path); README with GIF, `docs/architecture.md` v1, ADRs; tagged `v0.1.0`.
**Out:** photo/audio AI, sandboxed apps, LLM.

### M2 — Sees and hears · v0.2 (~4–5 FTE-weeks) · **the seeing and hearing has since been removed**

**Platform:** model download manager for Tier 1 (consent, progress, resume, integrity); model lifecycle (LRU unload, memory budget); adaptive tier defaults + Settings override; derived-data store; drag-drop between apps (photo → Search, audio → Search). _All of this was built and then deleted with the tier it served: with one model in the build there is nothing to download, consent to, or unload._
**Apps:** **Photos** (virtualized grid, viewer, EXIF, albums/tags, natural-language search, similar images, "find in Search"); **Audio** (player with waveform, transcription with timestamps, click-to-seek transcript, transcript search, chapters, export .srt/.txt); Search upgraded to multimodal results.
**AI:** CLIP-family image/text embeddings; Whisper tiny/base (small on Tier A); chaptering via embedding-shift segmentation + keyphrases; optional diarization.
**Done when:** sample photos searchable by natural language on Tier B within a measured, documented time after boot; a 5-minute clip transcribes faster than real-time on Tier A and < 2× real-time on Tier B (measured); background indexing never drops the UI below 50 fps; every download consented and visible in Task Manager; offline still works after caching; tagged `v0.2.0`.
**Out:** LLM, video, sandboxed apps.
**Since removed:** everything in this milestone that needed a downloaded model — natural-language photo search, similar images, transcription, chapters, `.srt` export — along with the download manager itself. Photos remains a picture browser with on-device thumbnails; Audio remains a player and recorder with a waveform ([ADR 15](./docs/adr/0015-no-on-demand-models.md)).

### M3 — Platform for apps · v0.3 (~4–5 FTE-weeks)

**Platform:** SDK package (types + in-process adapter + postMessage client); sandboxed iframe runtime (after the CSP spike in §5.2); app manifests; capability broker + permission prompts + Settings → Apps (grants, revoke, uninstall); install apps from a local folder/zip or a URL-fragment package (no backend); file associations/open-with; clipboard service; inter-app events; optional: linked folders re-sync (Chromium), terminal/console app (power-user VFS shell).
**Apps:** 2–3 sample third-party apps built **only** against the SDK (e.g. Calculator, a "Gallery wall" using `os.ai.embed`, a markdown tool) to prove the API.
**Done when:** a sandboxed app demonstrably cannot touch OPFS/IndexedDB/DOM (tested); permission prompts and revocation work; a sample app installed from a file runs offline; SDK docs published with an API-stability note; tagged `v0.3.0`.
**Out:** LLM, video, OCR.

### M4 — More senses · pool (pick by value; ~1–2 FTE-weeks each) · **the senses have since been removed**

Video moment search (WebCodecs frame sampling → CLIP index → clip export via WebCodecs encode/remux; fallback: export frame range); OCR (tesseract.js) for scanned PDFs/images; Photos tools (background removal, auto-tags, near-duplicate finder); translation (opus-mt or Chrome Translator API); read-aloud (Kokoro); WebNN experimental backend + benchmark; WebGPU compute-shader vector search (depth pocket). Each behind consented downloads with its own DoD.

**Picked, and delivered:** video moment search, the near-duplicate finder, and OCR — **all three since removed** with the rest of the on-demand models ([ADR 15](./docs/adr/0015-no-on-demand-models.md)). What survived from this milestone is the part that never needed a model: the sample video the desktop records for itself, and exporting a frame or a section from a video. The design notes below are kept as the record of what was built and measured.

### Video moment search

Two departures from the sketch above, both for stated reasons:

- **`<video>` seeking rather than WebCodecs.** WebCodecs decodes encoded chunks but does not demux, so MP4/WebM would need a container parser shipped alongside. Measured, seeking is not the bottleneck anyway: 40 ms to sample a frame against 257 ms to embed it. [ADR 12](./docs/adr/0012-video-moments.md).
- **Clip export re-encodes in real time** (play the section, record the element's stream) rather than remuxing. A lossless cut needs a muxer per container; re-encoding starts the clip exactly where asked rather than at the nearest keyframe.

Moments live in the existing CLIP image index rather than a third index — a frame is an image, and the model does not distinguish them. The sample video is recorded by the desktop itself from the sample pictures, which satisfies the "20–40 s self-made video featuring the red keyboard" in Appendix A without adding bytes to the repository.

### Near-duplicate finder

No new model and no new index: the CLIP vectors were already there, and a duplicate is a pair with a very high cosine. The all-pairs scan is quadratic, so an exact prefix bound skips 99.6% of the full comparisons — 6.1× faster over 5,000 vectors, with results a test asserts are identical to the naive scan. The 0.92 threshold is measured: copies score 0.95–0.98, no two different sample pictures exceed 0.79.

### OCR

**TrOCR rather than tesseract.js**, which the plan named. The reasons are about this project rather than about OCR: no new dependency, no megabytes of binary committed, and no second answer to "where do the weights come from" — it is a model like the others, under the same consent, integrity and lifecycle machinery. The cost is that TrOCR reads a line rather than a page, so the desktop does its own layout analysis with a projection profile, handles upright single-column text, and refuses photographs rather than pretending. [ADR 13](./docs/adr/0013-ocr.md).

Measured: all ten lines of the sample scanned page found and read with **zero character errors**, in 3.1 s — and text recognition turned out to be **six times faster on threaded WASM than on WebGPU**, and more accurate, which moved `preferredBackend` again.

### Still in the pool, unpicked

Photos tools (background removal, auto-tags), translation, read-aloud, WebNN, WebGPU compute-shader vector search. **None of these can be picked up as written**: every one needs a downloaded model, which ADR 15 rules out. WebGPU compute-shader vector search is the exception — it needs no model, and is the only item here still open.

### M5 — Optional intelligence · **removed, not deferred**

v2 planned an LLM plug-in here: conversational search over the index, summaries, a tool-calling
agent across apps, and app generation with an auto-test loop. It was always gated on M1–M3 and was
never started. At the end of M4 it was **removed from the roadmap** rather than left open.

The short version: nothing wanted it. Every feature that looked like it needed generation turned
out to be retrieval — including the plan's own headline aspiration, "find the video where I showed
my red keyboard and extract that section", which M4 answered with embeddings, a score floor and a
grouping rule. A 0.5–2.5 GB model would also have been the one workload WASM cannot rescue on a
machine without WebGPU, and the only part of the system that can answer differently twice. Full
reasoning: [ADR 14](./docs/adr/0014-no-text-generation.md).

What this removes is a promise, not a feature: no code was written for it, and the only change to
the source was deleting one unused member of a type union.

### M6 — Making it yours · v0.5 (~1 FTE-week)

The number after M5 rather than M4.5: M5's slot stays retired, as the record of a tier that was
removed rather than deferred.

The desktop it follows was arrangeable in exactly one way — icons where the CSS put them, a
wallpaper from a list of four, no menu on anything but a file row, and nothing that survived the
machine it was set up on. Every item here is polish rather than capability, which is the point:
G1 says the desktop is judged on polish, and this is the milestone that takes that literally.

**Platform:** desktop icons become a real selection model — click selects, double click opens
([ADR 16](./docs/adr/0016-one-click-selects-two-clicks-open.md)), multi-select, drag to arrange,
positions stored as grid cells that survive a resize; one context-menu component behind **every**
surface, reachable by `Shift+F10` as well as by right-click — see the rule below; wallpaper from any picture in the
file system, with a fit setting; desktop setup export and import as a JSON file the user carries
([ADR 17](./docs/adr/0017-customisation-is-a-file.md)); a compact layout below 720 px with a stated
limited mode ([ADR 18](./docs/adr/0018-mobile-is-a-visit-not-a-target.md)).

**Apps:** **Portfolio** _(removed after M7, ADR 23)_ — the author's other work, opened in a real browser tab. This is the answer
to "put a browser in the desktop", and the reasoning for the answer being no is
[ADR 19](./docs/adr/0019-no-browser-inside-the-browser.md).

**Done when:** an arrangement survives a reload, a resize and a round trip through an exported
file; **every** surface answers a right-click — including the ones with nothing specific to say —
and every menu is reachable from the keyboard, while text fields still get the browser's own; a setup file written
by hand cannot put an invalid value into the settings store (tested); the desktop is usable on a
390 px viewport with the limitation stated rather than discovered; `npm run verify` green.

#### The context-menu rule (applies to everything built from here on)

**Every surface answers a right-click. No surface is silent.** A desktop where the gesture works on
some things and not others is worse than one where it never works: each miss unteaches what the
last hit taught. The first pass covered the shell only — desktop, icons, title bars, taskbar
buttons, Files — and the gap was obvious the moment anyone right-clicked a photo.

Three rules, in order of precedence:

1. **Editable text and selected text keep the browser's own menu.** Cut, paste, spell-check,
   look-up and translate are things a page cannot reproduce, and replacing them with
   "Minimise / Maximise / Close" removes function in exchange for consistency nobody asked for.
   `keepsNativeMenu(event)` in `shell/ContextMenu.tsx` is the single test; every handler that could
   sit over text calls it first.
2. **The most specific surface wins.** A menu raised on a file row is the file's; on the window
   body it is the window's. `useContextMenu().open()` stops propagation, so specificity falls out
   of the DOM rather than being coordinated.
3. **Whatever is left answers anyway.** The window body and the taskbar strip carry fallback menus,
   so an app that has not been given one — Settings, About, anything new — still responds with
   something true rather than nothing.

**A file's menu is written once.** `shell/nodeMenu.ts` builds it from a `VfsNode`: open, open with
each app that claims the type, show in Files, copy name, set as wallpaper when it is an image, move
to trash. Files, Photos, Search, Notes, Viewer, Audio and Video all use it, so a file behaves the
same wherever it is shown and gaining a verb is one edit rather than seven.

**New surfaces are not done until they have one.** The check belongs with the accessibility check
it doubles as: the shared component takes `Shift+F10` and the menu key, so "every surface has a
menu" is also "every menu is reachable without a mouse."

**Out:** anything that fetches. The Portfolio app draws its own initials rather than favicons, for
the same reason everything else here does not phone home.

---

### M6.5 — A second skin · **shipped**

Not in the original plan; recorded here because it shipped and the plan is meant to describe what
this is, not only what was foreseen.

The desktop had one design language and it was entirely of 2026, which undercut the thesis: the
sentence "in 2026 a complete desktop is just static files" is about the machinery, and nothing on
screen said so. A **classic** skin — a 1990s desktop, square, bevelled, one grey — makes the
contrast the first thing a visitor sees rather than something they have to be told.

It is a token axis beside accent and wallpaper, and **it is the default**; Modern is one control
away. It began as a fourth axis beside a light/dark theme, which has since been removed outright
([ADR 22](./docs/adr/0022-one-palette-no-dark-mode.md)) — the skin is what makes this desktop look
like more than one desktop, and a brightness switch under it was answering a question nobody was
asking twice. Homage rather than impersonation: the visual grammar is reproduced in detail, and
nothing identifying a vendor is — no logo, no wordmark, no copied artwork, no font file, and the
Start menu's banner reads Tabula ([ADR 21](./docs/adr/0021-a-second-skin-and-why-it-is-the-default.md),
[ADR 1](./docs/adr/0001-static-hosting-zero-backend.md)).

**Done when:** every surface has a classic treatment, including new ones; both skins pass the same
contrast bar, with any departure named; switching is instant and neither skin regresses the other.

---

### M7 — Watch · v0.6 (~1 FTE-week) · **shipped, then removed** ([ADR 23](./docs/adr/0023-a-default-desktop.md))

**What it is.** A YouTube player in a window, and deliberately not a browser. The distinction is
the whole design: a browser-in-browser fails the first time a visitor types `google.com` (sites
refuse to be framed, and our cross-origin isolation blocks any frame that does not opt in — see
[ADR 19](./docs/adr/0019-no-browser-inside-the-browser.md)), whereas YouTube's **embed** endpoint
exists to be framed, and plays any video by id. Paste a link; it plays. That is a demo that works
every time someone tries it, which is the only kind worth building.

**Why do it at all, given G3.** Because "a desktop that plays video in a window" is legible to a
recruiter in two seconds in a way threaded WASM never will be, and because the one-host claim
survives it in a stronger form: _zero requests, except the one you just asked for — and here it is,
in the network panel, while you watch._ A privacy claim tested in the place it looks most likely
to break is worth more than one that is never tested.

**What it is not.**

- **No YouTube feed, no search, no recommendations.** Those pages refuse framing, and the only
  other route is the Data API: a key sitting in a public static site for anyone to lift, a second
  Google host, and Google's ranking inside a desktop whose thesis is that nothing is chosen _for_
  you. The home page is **yours** — Saved and Recent — and playlists pasted in play through with the
  player's own next/previous. Distraction-free by construction; that is the feature, not the cost.
- **No thumbnails.** Each is a request to Google's image host fired the moment the app opens,
  before the user chose anything. The rule of this app is _every network contact is one you just
  asked for._ Text rows, the way Portfolio draws its own initials.
- **No third-party script in our origin.** Title and channel come from the embed's own
  `postMessage` protocol once it loads — no `iframe_api` script, no `script-src` change.
- **Not named "YouTube".** The app is **Watch**; its description says YouTube. Someone else's
  trademark on the launcher is the same problem as Windows assets (ADR 1).

**The frame.** `https://www.youtube-nocookie.com/embed/<id>` in `<iframe credentialless>`. The
`credentialless` attribute is what makes this possible under COEP without YouTube opting in: the
frame loads in a throwaway, cookie-less context. It is also why the frame is always logged out —
no account, no history, no subscriptions — which is the privacy story as much as the limitation.

**How it looks.** Title bar → a single paste bar ("YouTube link or video id" · Play) → sidebar
(**Saved**, **Recent**; text rows of title · channel · when; right-click for play/save/copy/remove)
→ stage (the player, 16:9, letterboxed) → a row under it: title, channel, Save ★, Copy link,
Open on YouTube ↗, Stop. An **amber chip in the window's title bar — "talking to
youtube-nocookie.com" — that is live**: present while a frame is loaded, gone on Stop or close.
Closing the window tears the frame down; minimising keeps playing.

**States.**

- _Empty:_ "Paste a link to start. This is the only window in Tabula that talks to another site —
  youtube.com — and only while something is loaded."
- _First use:_ one consent card in the permission-prompt style, remembered, reversible in
  Settings: "Watch plays videos from YouTube. While a video is loaded, this window talks to
  youtube-nocookie.com and Google sees the request — no cookies, no account. Nothing else in Tabula
  changes."
- _Not Chromium:_ the stage explains that showing YouTube inside the desktop needs a credentialless
  frame, and offers Open on YouTube ↗. Saved and Recent still work as a list that opens outward.
- _Playing:_ as above.

**Where the data lives.** `Videos/Watched.md` — an ordinary Markdown file with `## Saved` and
`## Recent` sections, one line per video. So it is visible in Files, searchable by meaning with
everything else ("that talk about Rust" finds the title), deletable like anything else, and carried
by the setup export for free. The app is a view over a file, which is the rule everywhere else.

**What it changes, stated rather than smuggled.** G3 and D01 gain one exception, named; CLAUDE.md's
"two hosts" rule gains the same one (_one third-party frame, one app, user-initiated, visible_);
the CSP gains `frame-src https://www.youtube-nocookie.com` — `connect-src` stays empty, which is
the point: the desktop itself still cannot talk to anyone, it can only show a frame that does.
README paragraph one is rewritten to say so. A new ADR supersedes the YouTube half of ADR 19 and
keeps the browser half.

**Honest limits.**

1. **Chromium-only** — _assumption until the spike:_ Firefox and Safari have not shipped
   credentialless frames, and the alternative (dropping COEP) would cost threaded WASM for the whole
   desktop, which is not on the table.
2. **The network monitor sees the frame, not inside it.** Our document makes one request — the
   embed page. YouTube's player then makes dozens of its own within the frame, which Resource Timing
   cannot show us. The monitor's entry says so in as many words rather than implying it saw
   everything.
3. **Some videos will not play.** Owners can disable embedding ("watch on YouTube"); playlists skip
   those.
4. **Always logged out**, by construction of the frame.

**Order of work.**

1. **Spike, one hour, before anything else:** does the embed load _and play_ inside
   `<iframe credentialless>` under our COOP/COEP, on the dev server and in the Pages-simulation
   build? The project decides by measurement (ADR 8), and if this fails there is no fallback — COEP
   cannot be dropped for one window — so it is better to know in an hour than after a day. Record
   the result, pass or fail, in §13.
2. The app (~1 day): the Watch component, the consent card, the history file, the live chip, the
   Task Manager entry wording, the Chromium gate.
3. The documents: README, G3/D01, CLAUDE.md, CSP appendix, ADR 20.

**Done when:** paste a link → plays, on Chromium, in a fresh profile; the title-bar chip and the
Task Manager entry appear while a frame is loaded and disappear on Stop; Saved/Recent survive a
reload and round-trip through the setup export; on Firefox the app states its limitation and still
opens outward; the consent card shows once and is reversible; `npm run verify` green.

**Out:** anything beyond the embed — search, comments, feed, thumbnails, accounts — and a general
browser, which stays refused.

---

**Portfolio states:** after M1 "a real local-first desktop with semantic search"; after M2 "the AI desktop"; after M3 "a platform"; M4 adds depth; M6 makes it yours; M7 lets it play.
**Calendar reality:** M0–M3 ≈ 14–18 FTE-weeks → ~3.5–4.5 months full-time, ~9–12 months at ~15 h/week, plus M4 as a pool of self-contained additions. Each milestone is publicly valuable on its own, so value accrues even if the project stops early.

---

## 8. Quality bar (applies to every milestone)

- **Performance:** 60 fps window operations with ≥ 8 windows; interactions < 100 ms; no main-thread task > 50 ms during indexing; repeat-visit boot < 2 s; shell JS budget ~300 KB gzipped excluding the lazily loaded ML runtime.
- **Robustness:** every job cancellable; errors surface as notifications with retry; WebGPU device-lost recovery; quota errors handled; 5k-file import without jank.
- **Accessibility:** keyboard-only completion of the demo script; visible focus; ARIA roles for windows/menus/lists; reduced-motion and colour-scheme respected; axe clean on main surfaces; every context menu also opens on `Shift+F10`.
- **Context menus:** every surface answers a right-click, editable and selected text excepted (they keep the browser's own). A new app or panel is not finished until it does — see the rule under M6.
- **Both skins:** a new surface is not finished until it has a classic treatment as well as a modern one, and both meet the contrast bar. The failure mode is silent — a surface left unstyled still renders, just in the wrong century (ADR 21).
- **Offline:** repeat visit fully works with the network off.
- **Privacy:** network monitor shows **zero requests post-boot** — the single exception, a Watch frame, is user-initiated, labelled on the window while it exists and listed in the monitor (M7, ADR 20); CSP `connect-src` names no external host, so the browser enforces it; no third-party scripts.
- **Tests:** unit (window-manager reducers, VFS ops, scheduler); service tests in Node (Transformers.js v4 WASM path); Playwright smoke on the WASM path in CI; performance marks asserted.
- **Docs per milestone:** README, `docs/architecture.md`, ADRs, benchmarks, CHANGELOG, tagged release.

---

## 9. Portfolio deliverables

- **README:** hero GIF; "what is running in your tab right now"; exact host list; quick demo; support matrix; **limitations**.
- **`docs/architecture.md`** (diagram, data flows, threading, storage) + **ADRs** (hybrid app model; no text generation; content-addressed OPFS; brute-force vector search first; hosting constraints; weights tiers).
- **`docs/benchmarks.md`** auto-exported from the in-app Stats panel, hardware listed.
- 60–90 s video; blog post outline _"Static files, real OS"_.
- Talking points per audience: frontend/platform (WM, state, a11y, perf), systems (scheduler, workers, storage, sandboxing), ML (local inference, indexing, hybrid retrieval, backends).

---

## 10. Risks and mitigations

| Risk                                | Impact                  | Mitigation                                                                            |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Scope creep (genuine desktop)       | never ships             | milestone DoD gates; M4 a pool, not a list; polish over breadth                       |
| Time-to-first-result (downloads)    | visitors bounce         | **closed:** nothing is downloaded at all — the one model is in the build (ADR 15)     |
| Memory/VRAM exhaustion              | crashes                 | largely moot with one 23 MB quantized model resident                                  |
| WebGPU driver bugs / device lost    | broken demo             | WASM fallback; device-lost recovery; tested matrix                                    |
| Cross-browser gaps (FSA, OPFS perf) | confusing UX            | capability detection + explicit "limited mode" banner; Chromium-first messaging       |
| OPFS quota/eviction                 | data-loss fear          | `persist()`; usage UI; "Export all (zip)"                                             |
| Hugging Face outage / rate limit    | download fails          | **closed:** not contacted at runtime; only `npm run sync:weights` touches it          |
| COI service-worker quirks           | broken first load       | tested paths; single-thread fallback; WebGPU path does not require COI                |
| Pages bandwidth spike               | throttling              | lean bundle; SW caching; 23 MB of weights per first visit, well inside the budget     |
| Design/polish time                  | looks amateur           | design tokens early; one original visual language; empty/loading/error states written |
| Accessibility debt                  | senior reviewers notice | keyboard-first from M1, not retrofitted                                               |
| LLM rabbit hole                     | delays core             | **closed:** gated on M1–M3, never started, then removed outright (ADR 14)             |
| Licences (models/assets)            | takedown/embarrassment  | one Apache-2.0 model, redistributable; demo data is drawn by the app, not sourced     |

---

## 11. Repo, stack and conventions

**Stack (suggested; decide finally in M0):** Vite · React 19 · TypeScript (strict) · state: Zustand or hand-rolled stores · styling: CSS modules + CSS variables (design tokens) · workers: native `Worker` + typed RPC (Comlink or hand-rolled) · ML: `@huggingface/transformers` v4 (self-hosted runtime) · PDF: `pdfjs-dist` · EXIF: `exifr` · media: WebCodecs/OffscreenCanvas · full-text: own BM25 or MiniSearch · PWA: `vite-plugin-pwa` (Workbox) or hand-rolled SW · `coi-serviceworker` · tests: Vitest, Playwright, axe · lint/format: ESLint + Prettier (or Biome) · CI: GitHub Actions.

**Layout**

```
/shell        desktop UI: window chrome, taskbar, launcher, palette, theming, boot
/kernel       wm, vfs, apps, ipc, scheduler, models, settings, notifications, clipboard, locks, permissions
/services     ai/ (runtime config) · index/ (embeddings, chunking, BM25) · audio/ · video/ · extract/
/sdk          SDK types + in-process adapter + postMessage client
/apps         system apps (files, viewer, notes, search, settings, taskman, about, photos, audio)
/workers      worker entry points
/public/runtime   self-hosted ML runtime (WASM etc.)
/public/models    the bundled model, committed (marked linguist-vendored)
/public/demo      CC0 sample dataset + manifest
/models.json      model registry manifest
/docs             architecture.md, adr/, benchmarks/
```

**Workflow:** trunk-based; feature branches → squash merge; Conventional Commits; tag per milestone (`v0.1.0`, …); CHANGELOG; CI gates on every PR (typecheck, lint, unit, e2e smoke, build).

**Authorship (explicit rule):** All commits, pull requests, release notes and project credits are authored by the **project owner only**. Do **not** add AI co-author trailers (e.g. `Co-Authored-By: Claude …`) or "Generated with …" footers to commits, PR bodies, release notes or docs. AI tools may be used as assistants during development; they are **not** credited as authors or co-authors anywhere in the repository. Configure tooling accordingly (no commit templates with trailers; state this rule in any assistant instruction file such as `CLAUDE.md`/`AGENTS.md`).

**Licences:** code MIT (or your choice); `THIRD_PARTY_NOTICES.md` listing every model with its licence and every demo asset with its source (CC0/public domain/self-made). No analytics, no third-party scripts, no CDN fonts (system fonts or self-hosted).

**Naming:** `[OS name]` placeholder — decide in M0 together with the visual identity.

---

## 12. Decision log

- **D01** Browser-only, static, GitHub Pages, $0, no backend or other services. _Revised after M4:_ **one host**, full stop — the model is in the build, so Hugging Face is a build-time dependency and never contacted at runtime (ADR 15). _Revised again in M7:_ one host **plus one frame** — Watch may frame `youtube-nocookie.com` while a pasted video is loaded, named and revocable, with `connect-src` unchanged (ADR 20). A second such exception needs its own record; this one is not a precedent.
- **D02** Genuine desktop; window manager from scratch; original design (no Microsoft/Apple assets).
- **D03** Local AI as a system service. _Revised twice:_ the optional LLM tier was removed rather than deferred (ADR 14), and then the perception models — image, speech, text recognition — were removed as well, because each cost a visitor a download before it would do anything (ADR 15). What remains is text embeddings for document search.
- **D04** Hybrid app model: system apps in-process, third-party apps in sandboxed iframes, one SDK.
- **D05** Weights tiers: **bundled only**, ≤ ~80 MB, verified by digest at build time. The on-demand, built-in and sideload tiers are removed or were never built (ADR 15).
- **D06** Chromium-first, desktop-first; graceful degradation elsewhere; mobile best-effort. _Made concrete in M6:_ a compact layout below 720 px, a stated limited mode, and no separate mobile repository (ADR 18).
- **D07** `coi-serviceworker` for cross-origin isolation; CSP via meta; self-hosted runtime (no jsDelivr).
- **D08** Content-addressed OPFS blobs + IndexedDB tree; brute-force vector search in a worker first.
- **D09** Polished subsets per milestone; the demo is never gated on a download, and never answers with generated prose.
- **D10** No telemetry; privacy verifiable in-app.
- **D11** Authorship: owner only; no AI co-author trailers or generated-with footers.
- **D12** The desktop is arrangeable, and the arrangement is a file the user can read and carry — no account, no sync (ADR 17). Icons select on one click and open on two (ADR 16).
- **D13** No browser inside the browser, ever: it would break the one-host claim, need a CSP that costs cross-origin isolation, and be refused by most sites anyway. Links open in the real browser (ADR 19).
- **D14** A permission answer is remembered by default, and the prompt does not come back. Being asked the same question repeatedly trains people to stop reading it, and a re-askable denial is one a hostile app can raise in a loop until it gets its way. The two things that make that fair: Escape denies without remembering, and a call refused by a remembered "no" announces itself once with a route to Settings → Apps.
- **D15** _Shipped in M7, removed after it (ADR 23):_ a YouTube **player**, not a browser — one `credentialless` embed frame, user-initiated, visible on the window and in the monitor, history in a file the user owns. D13 stands: the general case stays refused.
- **D16** Right-click is answered everywhere, by one component, with the browser's own menu left alone over editable and selected text. Partial coverage is worse than none: each surface that stays silent unteaches the gesture. A file's menu is built once from its node, so it is identical in every app that shows it.

---

## 13. Open decisions (resolve in M0, with data)

Status after M0 — see `docs/benchmarks/` and `docs/adr/` for the evidence behind each.

1. **Resolved, then simplified.** M0 set the Tier-0 bundle at all-MiniLM-L6-v2 int8 (22.6 MB) + Whisper tiny int8 (41.6 MB) = 64.2 MB of the 80 MB budget, with CLIP on demand. After M4 the bundle is **MiniLM alone, 22.6 MB**, and there is no on-demand tier to be outside it. Sizes and SHA-256 digests are still generated into `models.json`, and now enforced at build time by `tools/sync-model.mjs`.
2. **Open.** Embedding precision (f32 vs f16) and shard format — decide with a real index in M1.
3. **Resolved.** Hand-rolled store (~40 lines over `useSyncExternalStore`) and hand-rolled RPC (~90 lines, progress streaming built in). MiniSearch vs own BM25 still open until M1 has a corpus. See ADR 7.
4. **Open.** A dedicated origin via a free GitHub organisation. Not blocking; decide before the first public link, since it changes the URL.
5. **Provisional.** Working name **Tabula** ("a desktop in a tab"), with a placeholder mark. Centralised so renaming is cheap; check name availability before publishing.
6. **Open.** Limited-mode wording for Safari/Firefox — needs the M1 import UI to exist first.
7. **Open.** Large-file hashing. Deferred to M1 with the import pipeline; OPFS measured at ~591 MB/s write, so hashing, not I/O, will be the bottleneck.
8. **Open, as planned.** Sandboxed-app runner placement — spike lands in M3.
9. **Resolved — the M7 gate. PASS.** Confirmed in a real Chrome on the project owner's machine,
   against the Pages-simulation build (`serve:pages`, no COOP/COEP headers, isolation supplied by
   our own service worker — the arrangement that actually ships). Harness kept at
   `docs/spikes/m7-credentialless-embed.html`, which is not part of the build.

   All four conditions held at once:

   - `crossOriginIsolated: true` — the origin is genuinely isolated, so this is the real case and
     not a relaxed one;
   - `credentialless` supported;
   - **A, the credentialless frame: `PLAYING`, `currentTime` reached 1.8s.** Bytes flowing, picture
     on screen, the embed's own `postMessage` protocol handshaking (`onReady`, `initialDelivery`)
     with no `iframe_api` script and no `script-src` change;
   - **B, the control — the same frame minus the attribute: refused by COEP**, the browser's error
     page, never spoke.

   B is the result as much as A. It shows the attribute is what admits the frame, rather than the
   frame having been permitted all along — the one thing that could not have been reasoned out, and
   the reason this was gated on a measurement instead of an argument.

   **Why it took three environments.** Two earlier attempts each covered one half and neither
   covered both. An automated Chrome was properly isolated but could not stream YouTube media at
   all — the same embed loaded top-level, with no iframe and no policy of ours, left its `<video>`
   at `networkState: 0` with no source ever attached — while the in-app browser pane played the
   credentialless frame perfectly but registered no service worker, so it was not isolated. The gap
   between them was narrow and every observation pointed the same way, but it was still an
   inference; this run measured it. Recorded because "the harness could not do it" and "the design
   does not work" look identical in a screenshot, and the difference is the whole milestone.

   **Firefox and Safari: still an assumption**, deliberately not upgraded — neither was tested, so
   "neither ships credentialless frames" stays labelled as an assumption per ADR 8 rather than
   being written up as a measurement.

### Also settled by M0, having overturned an assumption in this plan

- **Backend choice is per task, not "GPU if available."** Threaded WASM measured ~2.2x faster than WebGPU for small int8 embeddings (6.54 vs 14.43 ms/chunk median). §5.6 assumed WebGPU primary; the code now follows the measurement and the heavier-model defaults are labelled as assumptions until M2 measures them. See ADR 8.
- **Cross-origin isolation is solved with our own service worker**, not `coi-serviceworker` — one worker must do both isolation and caching, because a second registration at the same scope evicts the first. Verified with no COOP/COEP headers at all. See ADR 2.
- **The runtime actually fetched is the asyncify ONNX build** (5.4 MB gzipped), not the smaller 3.2 MB one. First search ≈ 28 MB, all of it from this origin.
- **`frame-ancestors` cannot be enforced** from a `<meta>` CSP; recorded as a known limitation rather than worked around.

---

## Appendix A — Demo dataset spec (~30–60 MB total; all CC0 / public domain / self-made; credits in `demo/manifest.json`)

**What this became.** The spec called for 30–60 MB of sourced CC0 media. Not one byte of it ships: everything is **drawn or synthesised by the desktop on first boot**, which keeps the repository small, the licensing trivial and the two-host claim (now one-host) intact. Sizes below are what the app generates.

- **8 pictures**, drawn to canvas — sunset over the sea, night sky, mountain lake, a red keyboard, a bar chart, a cup of coffee, a forest path, a tropical beach. A few kilobytes each. They exist to give Photos a grid worth looking at.
- **7 documents**: two real PDFs written by the app itself (one invoice for a **monitor**, one mentioning **Samsung**), warranty terms, a statement of work, and three Markdown notes. These are what document search actually searches.
- **A sample video**, recorded on demand rather than shipped: the desktop draws the eight pictures to a canvas and encodes 32 seconds of WebM with `MediaRecorder`, live, in about half a minute.
- **Dropped with the models they served:** the near-duplicate pictures (duplicate finder), the scanned-style page (OCR), and the speech clips (transcription). The audio app now ships nothing and records from the microphone instead — a self-made speech sample was never possible without a voice model.
- Auto-import on first boot; "Load sample data" and "Clear sample data" in Settings.

## Appendix B — SDK surface v0 (sketch)

```ts
interface OS {
  fs: {
    list(dir: Id): Promise<Node[]>;
    read(id: Id): Promise<Blob>;
    write(dir: Id, name: string, data: Blob): Promise<Id>;
    move(id: Id, to: Id): Promise<void>;
    rename(id: Id, name: string): Promise<void>;
    trash(id: Id): Promise<void>;
    watch(dir: Id, cb: (e: FsEvent) => void): Unsubscribe;
    pick(opts: PickOptions): Promise<Id[]>;
  };
  windows: { open(opts: WindowOptions): WindowHandle; setTitle(t: string): void; close(): void };
  ai: {
    // Text only. `ImageRef` inputs, `transcribe` and photo search went with their models (ADR 15);
    // the shipped surface is `docs/sdk.md`, which is narrower than this sketch throughout.
    embed(input: string[], opts?: EmbedOptions): Promise<Float32Array[]>;
    search(query: string, opts?: SearchOptions): Promise<Hit[]>;
  };
  events: {
    on(topic: string, cb: Handler): Unsubscribe;
    emit(topic: string, payload: unknown): void;
  };
  clipboard: { read(): Promise<ClipData>; write(d: ClipData): Promise<void> };
  notify(opts: NotifyOptions): void;
  settings: {
    get<T>(key: string): T;
    set<T>(key: string, v: T): void;
    onChange(cb: Handler): Unsubscribe;
  };
  apps: { open(appId: string, args?: unknown): void; list(): AppInfo[] };
}
```

Capabilities as shipped: `fs:read`, `fs:write`, `ai:embed`, `ai:search`, `clipboard`, `notifications`, `storage`. `ai:asr` and `ai:vision` were removed with the models behind them. **No `net:*` capability exists, and there will not be one.**

## Appendix C — CSP (`<meta http-equiv="Content-Security-Policy">`)

As shipped, generated by `tools/vite-plugin-csp.ts`. The draft allowed `huggingface.co` in
`connect-src`; with the weights in the build there is no host left to allow, so **the browser now
enforces the one-host claim** rather than the app merely honouring it.

M7 added YouTube's embed origin to `frame-src`; removing Watch took it out again (ADR 23).

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' blob: '<sha256 of the app-runner bootstrap>';
worker-src 'self' blob:;
connect-src 'self' blob: data:;                 /* no external host, at all */
img-src 'self' blob: data:;
media-src 'self' blob:;
font-src 'self';
style-src 'self' '<sha256 of the sandbox stylesheet>';  /* React sets styles via CSSOM. The hash is for the sandbox document, which is srcdoc and so inherits this policy — without it the runner's stylesheet was silently dropped and every sandboxed app ran unstyled */
frame-src 'self' blob:;                         /* sandboxed app iframes */
object-src 'none'; base-uri 'none'; form-action 'none';
```

Sandboxed-app document CSP: `default-src 'none'; script-src blob:; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'none'` (subject to the M3 spike on CSP inheritance).

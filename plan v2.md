# Browser AI Desktop — Plan v2

**Status:** draft v2 · 2026-08-22 · supersedes `initial plan.txt`
**Owner:** project owner (sole author — see §11 Authorship)
**Convention in this document:** numbers marked `~` are estimates to be measured in M0; "verify" means confirm before relying on it.

---

## 0. What this is (one paragraph)

A **genuine desktop environment** — windows, files, apps, settings, a task manager — that runs entirely inside a browser tab, delivered as **static files from GitHub Pages at zero cost**, with no backend, no accounts and no third-party services. Its system services include **local machine-learning models** (text/image embeddings, speech recognition, vision) running on the user's GPU via WebGPU, so the OS can search photos by what's in them, documents by meaning and audio by what was said — and nothing the user drops in ever leaves the tab. An **LLM is an optional plug-in, not a dependency.**

**Portfolio thesis:** _"In 2026 a complete, offline-capable, GPU-accelerated AI desktop is just static files."_

### Changes from v1 (`initial plan.txt`)

- Vision → execution plan: goals/non-goals, support matrix, architecture, model catalogue, milestones with definitions of done, quality bar, risks, conventions.
- The desktop is the **genuine centrepiece** (full/most functionality), not a skin; window manager built from scratch; original design.
- AI is split into **foundation (non-LLM models: deterministic, small, fast)** and **optional LLM tier (M5)**. Nothing depends on the LLM.
- **Hybrid app model** decided up front: system apps in-process, third-party/generated apps in sandboxed iframes, one SDK.
- Hosting constraints baked in: GitHub Pages only, weights policy in tiers, cross-origin isolation via service worker, CSP via meta, self-hosted runtime.
- Stack references updated to 2026 (Transformers.js v4 WebGPU runtime; WebGPU baseline in all major browsers; WebNN/Prompt API as progressive enhancements).

---

## 1. Goals and non-goals

**Goals**

- **G1 — A real desktop.** Window management, file system, app lifecycle, settings, notifications, clipboard, keyboard-first UX, session restore. Judged on polish.
- **G2 — Local AI as system services.** Embeddings, image–text, ASR, vision as kernel services any app can call; background indexing; instant search.
- **G3 — Zero cost, zero backend, verifiable privacy.** Static hosting; the only hosts ever contacted are `github.io` (code, tiny models, demo data) and, only on explicit consent, `huggingface.co` (optional larger weights). A network monitor inside the OS proves it.
- **G4 — Portfolio-grade.** 30-second demo with bundled sample data; Stats panel; architecture write-up with ADRs; benchmarks with hardware listed; honest limitations.
- **G5 — A platform.** Apps are built against an SDK; third-party (and later generated) apps run sandboxed with capability-based permissions.

**Non-goals**

- No servers, accounts, sync, telemetry, analytics, or third-party scripts/fonts/CDNs.
- No cloud AI by default; no dependence on an LLM for any core feature.
- Not a Windows/macOS clone — no Microsoft/Apple assets, icons or wallpapers (also an IP issue).
- No networking apps (browser-in-browser, chat clients): the OS makes **no** network requests after boot except consented model downloads.
- Mobile is best-effort, not a milestone gate. Single user per browser profile.

---

## 2. Principles

- **P1 Local-first, verifiable privacy** — network monitor in Task Manager; "airplane mode" demo.
- **P2 Zero-cost static** — GitHub Pages; Hugging Face only for consented optional weights; nothing else.
- **P3 Progressive enhancement** — detect capabilities at boot (WebGPU → WASM; File System Access where available; Prompt API optional); never hard-fail.
- **P4 Polished subsets per milestone** — every milestone is a shippable portfolio state.
- **P5 Deterministic demo first** — the first 30 seconds never wait on a download or an LLM.
- **P6 The OS metaphor is real** — processes, kernel services, permissions, task manager, installation — not cosmetic.
- **P7 Keyboard-first, accessible, original design.**
- **P8 Minimal dependencies in the desktop core** — libraries for ML, PDF and media only.
- **P9 Honest docs** — limitations section; benchmarks list the hardware.

---

## 3. Audience and demo script (this defines "done")

**30-second path (recruiter, non-technical)**

1. Open the URL → desktop boots in < 2 s on a repeat visit; sample files are already there ("Sample data — clear anytime").
2. Press the launcher key (or click Search) → type _"invoice for the monitor"_ → ranked results with highlighted passages from the sample PDFs → Enter opens the PDF at that page.
3. (M2+) type _"cat on a sofa"_ → photo results; drag a photo onto Search → visually similar photos.
4. Open Task Manager → models resident, GPU backend, **"Network: 0 requests since boot."**
5. Switch the OS's airplane-mode toggle (or the browser offline) → search again → still works.

**5-minute path (engineer)**

- About/Stats: GPU adapter, backend, model sizes, load times, embeddings/sec, search latency.
- DevTools → Network: empty after boot (except consented downloads). → Application: OPFS, IndexedDB, service worker.
- Import your own folder (Chromium: folder picker; others: drag-drop) → watch jobs queue with priorities and progress, cancel one, search while indexing continues.
- Open ≥ 8 windows, snap, keyboard window switcher; reload → session restored.
- Read `docs/architecture.md` and the ADRs; skim `models.json` and the CSP.

---

## 4. Support matrix and hardware tiers

| Browser                                | Import                                      | Re-link real folders        | WebGPU                               | AI                            | Status                                    |
| -------------------------------------- | ------------------------------------------- | --------------------------- | ------------------------------------ | ----------------------------- | ----------------------------------------- |
| Chrome / Edge desktop                  | drag-drop, `webkitdirectory`, folder picker | **yes** (persisted handles) | yes                                  | full (+ optional Prompt API)  | **primary target**                        |
| Firefox desktop 147+                   | drag-drop, `webkitdirectory`                | no (re-import)              | yes on Windows/macOS (Linux pending) | full                          | supported                                 |
| Safari 26 macOS                        | drag-drop, `webkitdirectory`                | no                          | yes                                  | full (verify OPFS throughput) | supported                                 |
| Mobile (Chrome Android, iOS 26 Safari) | limited                                     | no                          | yes, memory-tight                    | tiny models only              | best-effort; show a "limited mode" banner |

**Hardware tiers** (probed at boot from `navigator.gpu` adapter limits + `navigator.deviceMemory`; user-overridable in Settings):

- **Tier A** — discrete GPU / Apple Silicon, ≥ 8 GB RAM: all bundled models + on-demand models allowed by default (e.g. Whisper small, CLIP base).
- **Tier B** — integrated GPU with WebGPU: bundled models; smaller on-demand variants (Whisper base, MobileCLIP-class).
- **Tier C** — no WebGPU (WASM only): embeddings + Whisper tiny; background indexing throttled; speed warning shown.

---

## 5. Architecture

### 5.1 Layers

```
┌──────────────────────────── Browser tab (static files only) ────────────────────────────┐
│ SHELL (main thread, React)                                                               │
│   desktop · window chrome · taskbar · launcher · command palette · notifications · boot  │
│   ├─ System apps (in-process React): Files · Viewer · Notes · Search · Settings ·        │
│   │  Task Manager · About · (M2) Photos · Audio                                          │
│   └─ Sandboxed apps (iframe, opaque origin) ──── postMessage RPC ───┐                    │
│                                                                      │  ONE SDK surface   │
│ KERNEL (TypeScript; coordination on main thread)                      ▼                    │
│   window manager · app/process manager · VFS · IPC/event bus · job scheduler ·           │
│   model registry · settings · notifications · clipboard · multi-tab locks ·              │
│   capability/permission broker                                                           │
│                                                                                          │
│ SERVICES (workers)                                                                       │
│   inference workers (WebGPU | WASM | [WebNN] | [Prompt API]) · indexer · file-IO (OPFS   │
│   sync access handles) · media (thumbnails, decode, WebCodecs) · pdf (pdf.js)            │
│                                                                                          │
│ STORAGE                                                                                  │
│   OPFS: content-addressed blobs · derived data · index shards · model cache              │
│   IndexedDB: VFS tree + metadata · settings · permission grants · job log                │
│   Cache API (service worker): app shell · runtime · bundled models · demo data           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
     ▲ github.io — code, runtime, tiny models, demo data        ▲ huggingface.co — optional weights, on consent only
```

### 5.2 App model — hybrid (decision D04)

- **System apps** are React components registered with a manifest and run in-process for rich integration (drag-drop, theming, instant IPC). They still use only the SDK/kernel APIs — no back doors — so the SDK stays the single API.
- **Sandboxed apps** (third-party, user-installed, later generated) run in `<iframe sandbox="allow-scripts">` (no `allow-same-origin` → opaque origin → no access to the OS's storage or DOM). All capabilities go through postMessage RPC with a per-instance capability token. The permission broker prompts on first use of each capability. **There is no network capability at all.**
- **One SDK surface for both:** `os.fs`, `os.windows`, `os.ai`, `os.events`, `os.clipboard`, `os.notify`, `os.settings`, `os.apps` (Appendix B). Adapter layer: direct call (in-process) vs postMessage client (sandboxed).
- **App manifest:** id, name, icon, entry, permissions, file associations (open-with), window defaults, (M5) tool manifest.
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
- **Quota:** request `navigator.storage.persist()`; show usage and "Export all (zip)" in Settings; everything except user files is rebuildable.
- **Import pipeline:** drag-drop (`webkitGetAsEntry` everywhere; `getAsFileSystemHandle` on Chromium), `<input webkitdirectory>`, `showDirectoryPicker()`. Streams to the file-IO worker; hash in worker (`crypto.subtle` for small files; streamed WASM hasher for large — decide in M0); thumbnails lazily.

### 5.5 Index

- **Text:** extract (txt/md direct; PDF via pdf.js text layer; scanned → OCR in M4) → chunk (~200–300 tokens, ~15 % overlap, keep char offsets) → embed (normalized) → shard per modality as typed arrays in OPFS, held in memory for search. Plus a **full-text/BM25 index** for exact terms ("Samsung"). **Hybrid ranking** = reciprocal rank fusion of semantic + BM25. Snippets and highlights from offsets.
- **Images:** CLIP-family image embeddings (text query → text embedding → cosine). Similar images = image→image cosine (optionally DINOv2 for near-duplicates).
- **Audio:** ASR → timestamped segments → chunk → text embeddings; chapters by embedding-shift segmentation + keyphrases; transcript stored as derived data.
- **Video (M4):** sampled frames (WebCodecs or video+canvas) → CLIP embeddings with timestamps.
- **Search:** brute-force dot product in the indexer worker over typed arrays — target < 100 ms for ~50k vectors; upgrade path: WebGPU compute-shader search (depth pocket) or HNSW-in-WASM beyond ~200k.
- **Incremental:** per-file index state (pending/done/failed/modelVersion); re-index on model version change; pause/resume; background priority below interactive work.

### 5.6 Inference kernel

- **Backends:** `webgpu` (primary), `wasm` (single-thread, or multi-thread when `crossOriginIsolated` — the service worker in §5.10 makes this true), `webnn` (experimental toggle, off by default; origin-trial token via meta tag while it lasts), `builtin` (Chrome Prompt/Summarizer/Translator APIs — optional tasks only), `sideload`.
- **Scheduler:** priority queue (interactive 0 · user batch 1 · background indexing 2); one GPU job per model at a time; batching for embeddings; cancellation tokens; progress events; yields between batches to keep the UI fluid; throttles when the tab is hidden (configurable).
- **Model registry (`models.json`):** id, task, tier/source, files + sizes + sha256, license, min hardware tier, memory estimate. Lifecycle cold → loading → ready → idle → unloaded; **LRU unload by memory budget** derived from device memory/adapter limits; Task Manager shows all of it. **Integrity:** verify sha256 of every downloaded file against the manifest (pins versions; defends against CDN tampering).
- **Transformers.js v4 configuration:** self-hosted runtime/WASM under `/runtime/` (no jsDelivr); browser/WASM caches on; custom `env.fetch` for consent, progress, resume (Range) and integrity; models resolved by the registry (same-origin path for bundled; Hugging Face URL for on-demand).

### 5.7 Weights policy (decision D05)

| Tier            | Source                                                                 | Rule                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 Bundled**   | in repo, same-origin                                                   | target total ≤ ~80 MB (bandwidth maths: 100 GB/month soft limit ≈ 1,200 first-time visitors at 80 MB). Contents decided in M0 by measured sizes (embeddings for sure; ASR/CLIP variant if they fit).                                                  |
| **1 On-demand** | Hugging Face Hub (public files; no account/key; CORS + Range verified) | explicit consent dialog (size, license, host) → progress → resumable → cached → integrity-checked. Anonymous limit 3,000 file requests / 5 min / IP; a model is ~5–20 requests; repeat visits make zero requests. Retries honour `RateLimit` headers. |
| **2 Built-in**  | Chrome Prompt / Summarizer / Translator APIs                           | zero download by us; desktop Chrome only; optional tasks only.                                                                                                                                                                                        |
| **3 Sideload**  | user drops model files into the OS                                     | fully air-gapped; "install a model like an app".                                                                                                                                                                                                      |

The README states the exact host list. The Task Manager's network monitor lists every request.

### 5.8 Security

- **CSP via `<meta http-equiv>`** (GitHub Pages cannot set headers) — draft in Appendix C; includes `'wasm-unsafe-eval'` for WebAssembly, `connect-src` limited to self + Hugging Face.
- **Cross-origin isolation** via `coi-serviceworker` (credentialless mode) → `SharedArrayBuffer`/threads. Every cross-origin fetch must be CORS (Hugging Face is).
- **Sandboxed apps:** `sandbox="allow-scripts"` only; opaque origin; child CSP with no `connect-src`; capability tokens random per instance; messages schema-validated; grants persisted and revocable in Settings → Apps; folder-scoped file capabilities.
- **OS code:** no `eval`, no third-party scripts, sanitized Markdown rendering.
- **Future LLM (M5):** file content is untrusted input; mutating tools require confirmation; no auto-execution of model output.

### 5.9 Multi-tab

Web Locks `os-leader`; non-leader tabs offer "take over" or run read-only; BroadcastChannel syncs VFS events; only the leader runs the job scheduler.

### 5.10 Offline, PWA and hosting specifics

- Bundler `base: '/<repo>/'`; hash routing; service-worker scope `/<repo>/`.
- Service worker precaches shell + runtime + bundled models (+ demo data); "Restart OS to update" flow; `navigator.storage.persist()`; storage usage in Settings.
- **`coi-serviceworker`** (one automatic reload on first visit; app works single-threaded if registration fails).
- GitHub Actions builds and deploys (bypasses the 10-builds/hour limit); Pages limits: 1 GB site, 100 GB/month soft bandwidth, 100 MB per file in git.
- **Shared origin:** all project sites live on `user.github.io` → storage namespace and quota are shared with any other page you host. Namespace keys, or publish from a free GitHub organization (`org.github.io`) for a dedicated origin (decide in M0).
- GitHub Release assets are **not** CORS-fetchable from a page (tested 2026-08-22) — not an option for weights.

---

## 6. Model catalogue (initial picks — sizes ~, q8 unless noted; benchmark in M0)

| Task                  | Candidate(s)                                                                                    | ~Size                     | Tier                 | Notes                                              |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------- | -------------------- | -------------------------------------------------- |
| Text embeddings       | `Xenova/all-MiniLM-L6-v2` (384-d)                                                               | ~23 MB                    | bundled              | English; very fast; size verified                  |
|                       | `bge-small-en-v1.5` · `multilingual-e5-small`                                                   | ~34 · ~120 MB             | on-demand            | higher quality · multilingual                      |
| Image–text            | `clip-vit-base-patch32`                                                                         | ~150 MB total             | on-demand            | baseline                                           |
|                       | MobileCLIP-S0/S1 ONNX · SigLIP-base                                                             | small · ~200+ MB          | bundled? · on-demand | MobileCLIP may fit Tier 0 — measure                |
| Visual similarity     | CLIP image embeddings (reuse) · DINOv2-small                                                    | 0 · ~25 MB                | on-demand            | DINOv2 better for near-duplicates                  |
| ASR                   | `whisper-tiny` / `base` / `small`                                                               | ~40 / ~75 / ~250 MB       | bundled? / on-demand | multilingual; WebGPU-optimised variants are larger |
|                       | Moonshine tiny/base                                                                             | ~30–60 MB                 | alternative          | English, fast                                      |
| Diarization           | pyannote segmentation-3.0 ONNX                                                                  | ~6 MB                     | optional             | check license/gating                               |
| Document text         | pdf.js text layer                                                                               | library                   | core                 | scanned → OCR                                      |
| OCR                   | tesseract.js (WASM) · TrOCR · Florence-2-base                                                   | ~15 · ~65 · ~250 MB       | M4                   | tesseract = pragmatic, deterministic               |
| Detection / auto-tags | yolos-tiny · detr-resnet-50                                                                     | ~25 · ~42 MB              | M4                   | photo tags                                         |
| Background removal    | MODNet · BiRefNet · RMBG-1.4                                                                    | ~25 · ~200+ · ~45 MB      | M4                   | **check licenses** (RMBG-1.4 is non-commercial)    |
| Translation           | opus-mt pairs · NLLB-600M · Chrome Translator API                                               | ~80 MB/pair · ~600 MB · 0 | M4                   |                                                    |
| TTS                   | Kokoro-82M ONNX                                                                                 | ~90–330 MB                | M4                   | read-aloud                                         |
| Captioning / VLM      | SmolVLM-256M/500M · Florence-2                                                                  | ~250–500 MB               | M5 (optional)        | "describe this photo"                              |
| LLM (optional)        | Chrome Prompt API (Gemini Nano) · Qwen3 0.6B–4B / Qwen3.5 0.8B via Transformers.js v4 or WebLLM | 0 · ~0.5–2.5 GB           | M5                   | **never required**                                 |

---

## 7. Milestones

Effort is in **FTE-weeks** (~35–40 focused hours). Scale to your weekly hours and **re-estimate after M1** — it calibrates everything. Each milestone ends with a tagged release and is a complete, polished portfolio state.

### M0 — Foundations (~1 FTE-week)

**Scope:** repo scaffold (Vite + React + TypeScript strict); GitHub Actions → Pages deploy with base path; `coi-serviceworker`; CSP meta; PWA skeleton; design tokens + light/dark theme + placeholder name/logo; capability probe (WebGPU adapter, device memory, OPFS, File System Access, Prompt API); **benchmark harness page** (load + run candidate models on WASM and WebGPU; sizes, load time, throughput; OPFS read/write throughput); pick the Tier-0 bundle within budget; ADRs 01–05.
**Done when:** `crossOriginIsolated === true` on the deployed Pages site; benchmark JSON from ≥ 2 machines (your dev box + a weaker iGPU laptop or throttled profile) committed under `docs/benchmarks/`; `models.json` v0; open decisions in §13 resolved and recorded.

### M1 — A real desktop · v0.1 · first public portfolio state (~5–7 FTE-weeks)

**Platform:** window manager (create/move/resize with 8 handles, snap halves + quarters, minimize/maximize/restore/close, z-order, focus management, keyboard move/resize and window switcher; 60 fps budget); desktop + wallpaper; taskbar (running apps, clock, status chips: backend/GPU/offline); launcher; command palette (apps, files, commands, settings); notifications centre; settings store; **session restore**; shortcut registry; theming (light/dark/system, accent, reduced motion, font size); **boot sequence** (capability probe shown as a splash — doubles as the flex — then restore); kernel job scheduler + **Task Manager** (jobs, models, memory, backend, **network monitor**); VFS + file-IO worker + import pipeline; multi-tab lock.
**Apps:** **Files** (tree + list/grid, virtualized, breadcrumbs, rename/move/copy/delete/trash/restore/undo, properties, sort/filter, context menus, drag-drop within/between windows, open-with); **Viewer** (text/markdown/images/PDF via pdf.js); **Notes** (plain/markdown, autosave → instantly searchable); **Search** (semantic + full-text over txt/md/pdf; snippets, highlights, open at location); **Settings**; **Task Manager**; **About/Stats**.
**AI:** embeddings service (bundled model) on WebGPU with WASM fallback; indexer worker with priorities, cancel, progress; hybrid ranking.
**Demo:** bundled sample dataset auto-imported on first boot (with "Clear sample data"); 3-step welcome tour.
**Done when (measurable):** ≥ 8 windows dragged/resized at 60 fps (performance marks); keyboard-only run of the demo script; import of 1,000 files without UI jank (measured); search < 200 ms over 10k chunks; session restores after reload; PWA installable and fully functional offline on repeat visit; network monitor shows 0 requests post-boot; axe clean on shell/Files/Search; CI green (typecheck, lint, unit, Playwright smoke on WASM path); README with GIF, `docs/architecture.md` v1, ADRs; tagged `v0.1.0`.
**Out:** photo/audio AI, sandboxed apps, LLM.

### M2 — Sees and hears · v0.2 (~4–5 FTE-weeks)

**Platform:** model download manager for Tier 1 (consent, progress, resume, integrity); model lifecycle (LRU unload, memory budget); adaptive tier defaults + Settings override; derived-data store; drag-drop between apps (photo → Search, audio → Search).
**Apps:** **Photos** (virtualized grid, viewer, EXIF, albums/tags, natural-language search, similar images, "find in Search"); **Audio** (player with waveform, transcription with timestamps, click-to-seek transcript, transcript search, chapters, export .srt/.txt); Search upgraded to multimodal results.
**AI:** CLIP-family image/text embeddings; Whisper tiny/base (small on Tier A); chaptering via embedding-shift segmentation + keyphrases; optional diarization.
**Done when:** sample photos searchable by natural language on Tier B within a measured, documented time after boot; a 5-minute clip transcribes faster than real-time on Tier A and < 2× real-time on Tier B (measured); background indexing never drops the UI below 50 fps; every download consented and visible in Task Manager; offline still works after caching; tagged `v0.2.0`.
**Out:** LLM, video, sandboxed apps.

### M3 — Platform for apps · v0.3 (~4–5 FTE-weeks)

**Platform:** SDK package (types + in-process adapter + postMessage client); sandboxed iframe runtime (after the CSP spike in §5.2); app manifests; capability broker + permission prompts + Settings → Apps (grants, revoke, uninstall); install apps from a local folder/zip or a URL-fragment package (no backend); file associations/open-with; clipboard service; inter-app events; optional: linked folders re-sync (Chromium), terminal/console app (power-user VFS shell).
**Apps:** 2–3 sample third-party apps built **only** against the SDK (e.g. Calculator, a "Gallery wall" using `os.ai.embed`, a markdown tool) to prove the API.
**Done when:** a sandboxed app demonstrably cannot touch OPFS/IndexedDB/DOM (tested); permission prompts and revocation work; a sample app installed from a file runs offline; SDK docs published with an API-stability note; tagged `v0.3.0`.
**Out:** LLM, generated apps.

### M4 — More senses · pool (pick by value; ~1–2 FTE-weeks each)

Video moment search (WebCodecs frame sampling → CLIP index → clip export via WebCodecs encode/remux; fallback: export frame range); OCR (tesseract.js) for scanned PDFs/images; Photos tools (background removal, auto-tags, near-duplicate finder); translation (opus-mt or Chrome Translator API); read-aloud (Kokoro); WebNN experimental backend + benchmark; WebGPU compute-shader vector search (depth pocket). Each behind consented downloads with its own DoD.

**Picked, and delivered:** video moment search, the near-duplicate finder, and OCR.

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

Photos tools beyond duplicates (background removal, auto-tags), translation, read-aloud, WebNN, WebGPU compute-shader vector search. Each remains a self-contained addition behind its own consented download.

### M5 — Optional intelligence (only after M1–M3 DoD are met; ~4+ FTE-weeks)

LLM service plug-in with backends Chrome Prompt API / downloaded small model / sideloaded; Assistant: conversational search (RAG over the index with citations to files/offsets), summaries; tool-calling agent across apps using manifests (read-only tools auto-run; mutating tools confirm; file content untrusted); app generation via template + patch with an auto-test loop (render in hidden sandbox, capture errors, retry) and a pre-generated gallery for the demo.
**Done when:** the OS is 100 % functional with the plug-in absent (CI runs without it); every LLM feature degrades visibly and gracefully; prompt-injection test suite passes.

**Portfolio states:** after M1 "a real local-first desktop with semantic search"; after M2 "the AI desktop"; after M3 "a platform"; M4/M5 add depth.
**Calendar reality:** M0–M3 ≈ 14–18 FTE-weeks → ~3.5–4.5 months full-time, ~9–12 months at ~15 h/week. Each milestone is publicly valuable on its own, so value accrues even if the project stops early.

---

## 8. Quality bar (applies to every milestone)

- **Performance:** 60 fps window operations with ≥ 8 windows; interactions < 100 ms; no main-thread task > 50 ms during indexing; repeat-visit boot < 2 s; shell JS budget ~300 KB gzipped excluding the lazily loaded ML runtime.
- **Robustness:** every job cancellable; errors surface as notifications with retry; WebGPU device-lost recovery; quota errors handled; 5k-file import without jank.
- **Accessibility:** keyboard-only completion of the demo script; visible focus; ARIA roles for windows/menus/lists; reduced-motion and colour-scheme respected; axe clean on main surfaces.
- **Offline:** repeat visit fully works with the network off.
- **Privacy:** network monitor shows zero requests post-boot except consented downloads; CSP enforced; no third-party scripts.
- **Tests:** unit (window-manager reducers, VFS ops, scheduler); service tests in Node (Transformers.js v4 WASM path); Playwright smoke on the WASM path in CI; performance marks asserted.
- **Docs per milestone:** README, `docs/architecture.md`, ADRs, benchmarks, CHANGELOG, tagged release.

---

## 9. Portfolio deliverables

- **README:** hero GIF; "what is running in your tab right now"; exact host list; quick demo; support matrix; **limitations**.
- **`docs/architecture.md`** (diagram, data flows, threading, storage) + **ADRs** (hybrid app model; LLM-optional; content-addressed OPFS; brute-force vector search first; hosting constraints; weights tiers).
- **`docs/benchmarks.md`** auto-exported from the in-app Stats panel, hardware listed.
- 60–90 s video; blog post outline _"Static files, real OS"_.
- Talking points per audience: frontend/platform (WM, state, a11y, perf), systems (scheduler, workers, storage, sandboxing), ML (local inference, indexing, hybrid retrieval, backends).

---

## 10. Risks and mitigations

| Risk                                | Impact                  | Mitigation                                                                            |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| Scope creep (genuine desktop)       | never ships             | milestone DoD gates; M4/M5 optional; polish over breadth                              |
| Time-to-first-result (downloads)    | visitors bounce         | Tier-0 bundled models; demo data; lazy everything; progress UI                        |
| Memory/VRAM exhaustion              | crashes                 | registry memory budget; LRU unload; quantized models; one model per task              |
| WebGPU driver bugs / device lost    | broken demo             | WASM fallback; device-lost recovery; tested matrix                                    |
| Cross-browser gaps (FSA, OPFS perf) | confusing UX            | capability detection + explicit "limited mode" banner; Chromium-first messaging       |
| OPFS quota/eviction                 | data-loss fear          | `persist()`; usage UI; "Export all (zip)"                                             |
| Hugging Face outage / rate limit    | download fails          | backoff honouring `RateLimit` headers; Range resume; caching; bundled tier unaffected |
| COI service-worker quirks           | broken first load       | tested paths; single-thread fallback; WebGPU path does not require COI                |
| Pages bandwidth spike               | throttling              | lean bundle; SW caching; Tier 0 ≤ ~80 MB; optional second site/org for models         |
| Design/polish time                  | looks amateur           | design tokens early; one original visual language; empty/loading/error states written |
| Accessibility debt                  | senior reviewers notice | keyboard-first from M1, not retrofitted                                               |
| LLM rabbit hole                     | delays core             | M5 gated on M1–M3; LLM-optional architecture                                          |
| Licences (models/assets)            | takedown/embarrassment  | `THIRD_PARTY_NOTICES.md`; CC0/public-domain demo assets; check every model licence    |

---

## 11. Repo, stack and conventions

**Stack (suggested; decide finally in M0):** Vite · React 19 · TypeScript (strict) · state: Zustand or hand-rolled stores · styling: CSS modules + CSS variables (design tokens) · workers: native `Worker` + typed RPC (Comlink or hand-rolled) · ML: `@huggingface/transformers` v4 (self-hosted runtime) · PDF: `pdfjs-dist` · EXIF: `exifr` · media: WebCodecs/OffscreenCanvas · full-text: own BM25 or MiniSearch · PWA: `vite-plugin-pwa` (Workbox) or hand-rolled SW · `coi-serviceworker` · tests: Vitest, Playwright, axe · lint/format: ESLint + Prettier (or Biome) · CI: GitHub Actions.

**Layout**

```
/shell        desktop UI: window chrome, taskbar, launcher, palette, theming, boot
/kernel       wm, vfs, apps, ipc, scheduler, models, settings, notifications, clipboard, locks, permissions
/services     ai/ (embeddings, vision, asr, …) · index/ · media/ · pdf/
/sdk          SDK types + in-process adapter + postMessage client
/apps         system apps (files, viewer, notes, search, settings, taskman, about, photos, audio)
/workers      worker entry points
/public/runtime   self-hosted ML runtime (WASM etc.)
/public/models    Tier-0 bundled models
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

- **D01** Browser-only, static, GitHub Pages, $0, no backend or other services (Hugging Face only for consented optional weights).
- **D02** Genuine desktop; window manager from scratch; original design (no Microsoft/Apple assets).
- **D03** Local AI as system services; non-LLM models are the foundation; LLM is an optional plug-in (M5); nothing depends on it.
- **D04** Hybrid app model: system apps in-process, third-party/generated apps in sandboxed iframes, one SDK.
- **D05** Weights tiers: bundled ≤ ~80 MB / on-demand Hugging Face with consent + integrity / built-in (Prompt API) / sideload.
- **D06** Chromium-first, desktop-first; graceful degradation elsewhere; mobile best-effort.
- **D07** `coi-serviceworker` for cross-origin isolation; CSP via meta; self-hosted runtime (no jsDelivr).
- **D08** Content-addressed OPFS blobs + IndexedDB tree; brute-force vector search in a worker first.
- **D09** Polished subsets per milestone; the demo is never gated on downloads or an LLM.
- **D10** No telemetry; privacy verifiable in-app.
- **D11** Authorship: owner only; no AI co-author trailers or generated-with footers.

---

## 13. Open decisions (resolve in M0, with data)

Status after M0 — see `docs/benchmarks/` and `docs/adr/` for the evidence behind each.

1. **Resolved.** Tier-0 bundle = all-MiniLM-L6-v2 int8 (22.6 MB, from M1) + Whisper tiny int8 (41.6 MB, from M2) = **64.2 MB of the 80 MB budget**, ~1,595 first-time visitors/month. MobileCLIP-S0 (52.1 MB) and CLIP ViT-B/32 (146.5 MB) are Tier 1, on demand. Sizes and SHA-256 digests generated into `models.json`.
2. **Open.** Embedding precision (f32 vs f16) and shard format — decide with a real index in M1.
3. **Resolved.** Hand-rolled store (~40 lines over `useSyncExternalStore`) and hand-rolled RPC (~90 lines, progress streaming built in). MiniSearch vs own BM25 still open until M1 has a corpus. See ADR 7.
4. **Open.** A dedicated origin via a free GitHub organisation. Not blocking; decide before the first public link, since it changes the URL.
5. **Provisional.** Working name **Tabula** ("a desktop in a tab"), with a placeholder mark. Centralised so renaming is cheap; check name availability before publishing.
6. **Open.** Limited-mode wording for Safari/Firefox — needs the M1 import UI to exist first.
7. **Open.** Large-file hashing. Deferred to M1 with the import pipeline; OPFS measured at ~591 MB/s write, so hashing, not I/O, will be the bottleneck.
8. **Open, as planned.** Sandboxed-app runner placement — spike lands in M3.

### Also settled by M0, having overturned an assumption in this plan

- **Backend choice is per task, not "GPU if available."** Threaded WASM measured ~2.2x faster than WebGPU for small int8 embeddings (6.54 vs 14.43 ms/chunk median). §5.6 assumed WebGPU primary; the code now follows the measurement and the heavier-model defaults are labelled as assumptions until M2 measures them. See ADR 8.
- **Cross-origin isolation is solved with our own service worker**, not `coi-serviceworker` — one worker must do both isolation and caching, because a second registration at the same scope evicts the first. Verified with no COOP/COEP headers at all. See ADR 2.
- **The runtime actually fetched is the asyncify ONNX build** (5.4 MB gzipped), not the smaller 3.2 MB one. First AI-using visit ≈ 28 MB.
- **`frame-ancestors` cannot be enforced** from a `<meta>` CSP; recorded as a known limitation rather than worked around.

---

## Appendix A — Demo dataset spec (~30–60 MB total; all CC0 / public domain / self-made; credits in `demo/manifest.json`)

- 60–100 photos: animals (cats!), landscapes (sunsets, beaches), food, objects (a **red keyboard**), near-duplicates for "similar"; ≤ 1600 px, ~150–300 KB each; no identifiable people unless CC0 with release.
- 8–12 documents: self-made synthetic invoices (one for a **monitor** purchase; one mentioning **Samsung**), a fictional résumé, `notes.md`, a few public-domain texts/PDFs, one scanned-style PDF (for OCR later).
- 2–3 audio clips (1–3 min): public-domain speech (e.g. LibriVox) + one self-recorded "meeting" with clear topic shifts (for chaptering).
- (M4) one 20–40 s self-made/CC0 video featuring the red keyboard.
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
    embed(input: string[] | ImageRef[], opts?: EmbedOptions): Promise<Float32Array[]>;
    search(query: string | ImageRef, opts?: SearchOptions): Promise<Hit[]>;
    transcribe(audio: Id, opts?: AsrOptions): Job<Transcript>;
    jobs: { cancel(id: JobId): void; progress(id: JobId): Progress };
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

Capabilities: `fs:read:<scope>`, `fs:write:<scope>`, `ai:embeddings`, `ai:asr`, `ai:vision`, `clipboard`, `notifications`, `events:<topic>`. **No `net:*` capability exists.**

## Appendix C — CSP draft (`<meta http-equiv="Content-Security-Policy">`; verify hosts and tighten in M0)

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';          /* add blob: only with the M3 sandboxed-app runner */
worker-src 'self' blob:;
connect-src 'self' https://huggingface.co https://*.hf.co;
img-src 'self' blob: data:;
media-src 'self' blob:;
font-src 'self';
style-src 'self';                               /* React sets styles via CSSOM; add 'unsafe-inline' only if a dependency needs it */
frame-src 'self' blob:;                         /* sandboxed app iframes */
object-src 'none'; base-uri 'none'; form-action 'none';
```

Sandboxed-app document CSP: `default-src 'none'; script-src blob:; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'none'` (subject to the M3 spike on CSP inheritance).

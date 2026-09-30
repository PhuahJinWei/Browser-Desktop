# Tabula

**A local-first desktop that runs entirely in a browser tab. Static files, no backend, no
accounts, no uploads, nothing to install and nothing to download.**

Windows, files, notes and a task manager, with one machine-learning model running on your own
hardware as a system service — so you can search your documents by what they _mean_, not just by
what they are called. Nothing you open leaves the tab.

Semantic search is the one place a model is involved, and the model ships with the page — never
fetched from anyone else, never waiting on your permission. The desktop does **not** generate text
([ADR 14](./docs/adr/0014-no-text-generation.md)) and downloads nothing on demand
([ADR 15](./docs/adr/0015-no-on-demand-models.md)): every answer it gives is a pointer into one of
your own files, at an offset you can open and check.

> **Status: post-M7.** A window manager, a file system, semantic document search, a picture
> browser, an audio player and recorder, a video player that exports frames and sections,
> sandboxed third-party apps, two skins, and a YouTube player that is the one named exception to
> the one-host rule — everything else from one host, with nothing to download or approve. What
> removing the on-demand models cost is in
> [ADR 15](./docs/adr/0015-no-on-demand-models.md). See
> [`plan v2.md`](./plan%20v2.md) for the roadmap, [`docs/sdk.md`](./docs/sdk.md) to write an app,
> and [`docs/benchmarks/`](./docs/benchmarks/) for what has actually been measured.

---

## The 30-second demo

1. Open the page. A small set of sample documents is generated on your device — including two real
   PDFs, written by the app itself.
2. Open **Search** and click the example _invoice for the monitor_. The top result is the invoice,
   and you get the passage, not just the file name.
3. Open **Notepad**, type a sentence and press **Ctrl+S**. It saves as an ordinary Markdown file
   and is searchable seconds later.
4. Open **Video → Sample**. The desktop draws a short film and encodes it, live, in front of you —
   half a minute, because a canvas recorder runs at wall-clock speed. Then scrub to any point and
   save that frame as a picture, or cut ten seconds out into a file of its own.
5. Open **Task Manager → Network**. Every request the page has made is listed. Your documents are
   not among them.
6. Turn off your network and reload. The desktop boots and search still works **including the
   semantic half** — the model is in the page, not on a server.

## Why this exists

In 2026 a complete, offline-capable desktop — window manager, file system, semantic search,
sandboxed third-party apps — is just static files. This is the demonstration.

Note the missing adjective. It was "GPU-accelerated" until the benchmarks said otherwise: threaded
WASM beat WebGPU on the model that shipped, so the code follows the measurement and the README
follows the code.

## Why it looks like 1995

Because the sentence above is about the machinery, and nothing on screen was saying so. A visitor
saw a competent modern web app and had to be _told_ that the interesting part was underneath.

So the default skin is a 1990s desktop — Start menu, bevelled everything, one grey, pixel icons
drawn as text, scrollbars with arrows at both ends — and the contrast does the arguing: this looks
like 1995 and it is running threaded WebAssembly, content-addressed storage and semantic search,
from static files, offline. Modern is one control away in Settings, and neither skin is a fork:
both are the same components reading the same tokens
([ADR 21](./docs/adr/0021-a-second-skin-and-why-it-is-the-default.md)).

**It is an homage, not a copy.** The visual grammar is reproduced closely, because that is what an
homage is. Nothing identifying a vendor is: no logo, no wordmark, no copied artwork, no font file,
and no product name anywhere in the interface. The Start menu's banner reads _Tabula_. Accessibility
is not sacrificed to authenticity either — where the era's own choice failed a contrast check, the
modern value wins and the departure is written down rather than quietly made.

## One host, and one frame you asked for

This page contacts exactly **one** host on its own: the origin serving it. Not a CDN, not an
analytics endpoint, not a model registry.

There is one exception, and it is the whole of it: the **Watch** app plays a YouTube video in a
window, so while a video you pasted is loaded, that window frames `youtube-nocookie.com`. Nothing
loads until you paste a link, an amber chip in the title bar names the host for exactly as long as
the frame exists, and Settings can withdraw the permission. The desktop still cannot _talk_ to
YouTube — `connect-src` allows no external host at all — it can only show a frame that does
([ADR 20](./docs/adr/0020-one-frame-you-asked-for.md)).

So the claim is not "no network" with an asterisk. It is: **nothing, except the one thing you just
asked for, and here it is in the network panel while you watch.**

The 23 MB embedding model that document search runs on is in the build — fetched once at release
time by `npm run sync:weights`, checked against the SHA-256 digests pinned in `models.json`, and
served from this site like any other file. So there is no "enable this feature" dialog anywhere,
nothing to download and nothing to agree to: open the page, and everything it can do it can already
do.

The sample documents and pictures are **generated in your browser**, not downloaded. There is no
analytics, no telemetry, no third-party script and no CDN font. The ML runtime is self-hosted. The
Task Manager shows the whole request log so you can check all of this rather than take it on trust.

## What it does

|                  |                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Files**        | Browse, import by drag-and-drop or picker, rename, move, trash, restore, permanently delete. Virtualised, so a folder of thousands scrolls like a folder of ten.                       |
| **Search**       | Hybrid semantic + keyword search over your documents, with snippets, highlights, and a label on every result saying how it was found.                                                  |
| **Notepad**      | Markdown notes stored as ordinary files. Explicit save, with a flush on close so nothing is lost, and indexed once written.                                                            |
| **Viewer**       | Text, Markdown, images and PDFs. Opens a search hit at the exact passage and marks it.                                                                                                 |
| **Photos**       | A picture browser: virtualised grid, filter by name, detail pane, and thumbnails made on this device so a folder of huge photographs still scrolls.                                    |
| **Audio**        | Play and record, with a waveform drawn from the decoded samples.                                                                                                                       |
| **Video**        | Play, save the frame you are looking at as a picture, or cut the section you are watching into its own file. Canvas and MediaRecorder — no model.                                      |
| **Apps**         | Third-party apps in a sandbox with an opaque origin, no network, and permissions you grant per call and revoke any time.                                                               |
| **Portfolio**    | The author's other work, handed to a real browser tab. Nothing is fetched — not even a favicon — so the network log stays empty while you use it.                                      |
| **Task Manager** | Every job with progress and a cancel button, model and index statistics, storage use, and the full network log.                                                                        |
| **Settings**     | Skin, accent, wallpaper (including any picture of your own), text size, motion, backend override, indexing, setup export and import, and every destructive operation clearly labelled. |
| **Desktop**      | Drag, resize from eight edges, snap to halves and quarters, minimise, maximise, keyboard window management, session restore, command palette, notifications.                           |
| **Skins**        | A 1990s desktop by default: Start menu, bevels, one grey, pixel icons, scrollbar arrows. Modern is a switch away.                                                                      |
| **Your desktop** | Select and arrange icons, right-click anything, set any picture as the wallpaper, and carry the whole arrangement to another machine as a file you can read.                           |

## Measured, not asserted

From the reference machine (Windows 11, AMD RDNA-3, 16 cores), in the deployed build:

| Result                                                    | Value                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| Cross-origin isolation on a host that cannot send headers | **achieved**, via the app's own service worker                |
| Pointer-move cost while dragging, 14 windows open         | **0.01 ms** median (one 5.4 ms commit per gesture)            |
| Hybrid search over the sample corpus                      | **2–5 ms**                                                    |
| Embeddings: threaded WASM vs WebGPU                       | **6.5 vs 14.4 ms** per passage — WASM 2.2× faster             |
| OPFS, 64 MB, sync access handle                           | **591 MB/s write, 781 MB/s read**                             |
| Desktop shell at boot                                     | **~90 KB gzipped** (apps and pdf.js load on demand)           |
| Hosts contacted, ever                                     | **one** — enforced by `connect-src 'self'`, not just intended |
| Offline, server stopped                                   | boots, and search keeps its **semantic half** (Chrome 151)    |

The WASM result contradicted the plan's assumption that the GPU would always win, so the code
changed: backend selection is per task and cites the measurement. That is what the benchmark
harness in **My Computer → Performance** is for — it is still there, and you can re-run it on your
own machine.

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

| Command                | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `npm run dev`          | Dev server (sends COOP/COEP directly, matching production behaviour)   |
| `npm run build`        | Typecheck, then build to `dist/`                                       |
| `npm run build:pages`  | Build with the GitHub Pages base path                                  |
| `npm run verify`       | Typecheck, lint, test, build — what CI runs                            |
| `npm run serve:pages`  | Serve `dist/` with no headers, imitating GitHub Pages                  |
| `npm run sync:runtime` | Copy the ONNX runtime into `public/runtime/` (runs automatically)      |
| `npm run sync:models`  | Regenerate `models.json` (sizes and digests) from the Hugging Face API |
| `npm run sync:weights` | Fetch the model into `public/models/`, verified against those digests  |

## How it is built

```
src/shell      desktop, window frames, taskbar, launcher, command palette, boot, design tokens
src/kernel     window manager · VFS · job scheduler · commands · settings · notifications ·
               capability probe · worker RPC · network monitor
src/services   ai/ (runtime config) · index/ (embeddings, vectors, BM25, thumbnails) ·
               audio/ (waveform) · video/ (frame and clip export) · extract/ · bench/
src/apps       files · viewer · notes · search · photos · audio · video · settings · tasks ·
               system-report
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
- [ADR 15 — nothing is downloaded on demand](./docs/adr/0015-no-on-demand-models.md): why photo
  search, transcription and OCR were built, measured, and then deleted.
- [ADR 14 — no text generation](./docs/adr/0014-no-text-generation.md): why the LLM tier was closed
  without being built, after four milestones of features turned out to be retrieval.
- [ADR 10 — models are tested, not assumed](./docs/adr/0010-model-choices-are-tested-not-assumed.md):
  the plan's smaller image model ranked correctly 0 times out of 6. The feature is gone; the method
  is the point, and it reversed two decisions the plan had assumed.
- [ADR 19 — no browser inside the browser](./docs/adr/0019-no-browser-inside-the-browser.md): the
  most-requested feature, and the four separate reasons it is not being built.
- [ADR 17 — customisation is a file](./docs/adr/0017-customisation-is-a-file.md): why the wallpaper
  is a file you already own and your whole setup exports as readable JSON.
- [ADR 11 — how the app sandbox is delivered](./docs/adr/0011-sandbox-delivery.md): two reasonable
  assumptions about iframe CSP, both wrong, and the measurements that settled it.

## Browser support

| Browser               | Status                                                            |
| --------------------- | ----------------------------------------------------------------- |
| Chrome / Edge desktop | Primary target. Folder picker, persisted directory handles        |
| Firefox 147+ desktop  | Supported. Drag-and-drop and file-picker import; no folder picker |
| Safari 26 (macOS)     | Supported. Drag-and-drop and file-picker import; no folder picker |
| Mobile                | Best effort. Compact layout below 720 px, windows open maximised  |

Desktop-first and Chromium-first, degrading explicitly rather than silently. On a small screen or a
machine without a GPU, the desktop says so on arrival instead of letting you find out
([ADR 18](./docs/adr/0018-mobile-is-a-visit-not-a-target.md)).

## Limitations

Stated plainly, because a portfolio piece that hides these is worth less:

- **Only documents are searchable by meaning.** Photo search by description, video moment search,
  near-duplicate detection, transcription and OCR were all built and then removed, because each
  cost a visitor a 66–150 MB download before it would do anything
  ([ADR 15](./docs/adr/0015-no-on-demand-models.md)). Photos, Audio and Video remain as a browser,
  a player/recorder and a player — useful, and no longer clever.
- **A scanned page stays unsearchable.** It has no text layer to extract, and OCR went with the
  rest. pdf.js finds text in real PDFs only.
- **The sample pictures are drawn, not photographed** — illustrations generated in your browser, so
  no image bytes ship and no third host is asked. Drag in your own for anything real.
- **One benchmark machine.** Tier-A desktop, Chromium only. Tier-B and other engines are pending.
- **Search quality is honest, not tuned.** Ranking is reciprocal rank fusion over cosine
  similarity and BM25, with no learned reranking. Short generic documents can outrank better ones.
- **Nothing is downloaded, so nothing degrades offline.** Verified in Chrome 151 with the server
  stopped: the desktop boots, and a query sharing no words with any document still returns results
  found by meaning. Getting there took two fixes — the ONNX runtime was never being cached, and an
  `onLine` check was skipping the model — both found by pulling the plug rather than reasoning.
- **`frame-ancestors` cannot be enforced.** Browsers ignore it in a `<meta>` policy and GitHub
  Pages cannot send headers.
- **Files above 256 MB are refused**, because hashing needs the whole buffer in memory.
- **Storage quota is browser-granted**, roughly 3 GB on the reference machine.
- **No multi-window drag-and-drop between apps yet**, and no folder re-sync after import.
- **Exporting your setup does not export your files.** Settings, icon layout, wallpaper and open
  windows travel as a small JSON file; a bulk export of the file system is still to be built.
- **The SDK is v0** and will change; see the note at the top of `docs/sdk.md`.
- **Sandbox delivery uses `srcdoc`** because a sandboxed frame loading a real URL would not run
  scripts in the environment tested. Isolation is unaffected — srcdoc is bound by two policies
  rather than one — but it is behaviour worth re-checking on other engines.

## Licence

Code: MIT (see [LICENSE](./LICENSE)). Models and third-party components keep their own licences —
see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). All sample content, icons and wallpapers
are original to this project.

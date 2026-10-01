# Tabula

**A default desktop in a browser tab.** Windows, a Start menu, files, a text editor, a paint
program, media players and a task manager, served as static files, with no backend, no account and
no installer. It works offline, and nothing you open ever leaves the tab.

**[Open it →](https://phuahjinwei.github.io/Browser-Desktop/)**

## What is on the desktop

What a fresh desktop ships with, and nothing that one would not.

|                  |                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Desktop**      | Drag, resize from eight edges, snap to halves and quarters, minimise, maximise. Icons you can arrange, right-click on everything, session restore.           |
| **Start menu**   | Every app. Classic has Programs, Documents, Settings, Find, Run… and Shut Down…; modern has a search box that opens an app by name or searches your files.   |
| **Files**        | Browse, import by drag-and-drop or picker, rename, move, cut, copy, paste, trash and restore. Virtualised, so a folder of thousands scrolls like one of ten. |
| **Search**       | In Files' search box: typing filters the folder by name, **Enter** searches inside every file, by what it says as well as the words it uses.                 |
| **Notepad**      | Notes as ordinary Markdown files. Explicit save, with a flush on close so nothing is lost.                                                                   |
| **Paint**        | Pencil, brush, eraser, fill, colour picker, line, rectangle and ellipse; two colours, undo, zoom. Pictures save as PNGs, and one can be the wallpaper.       |
| **Viewer**       | Text, Markdown, images and PDFs. Opens a search result at the exact passage.                                                                                 |
| **Photos**       | A picture browser with thumbnails made on this device, so a folder of large photographs still scrolls.                                                       |
| **Audio**        | Play and record, with a waveform.                                                                                                                            |
| **Video**        | Play, save the current frame as a picture, or cut a section into its own file.                                                                               |
| **Recycle Bin**  | What you delete waits here until you empty it.                                                                                                               |
| **Task Manager** | Running apps and background jobs with a cancel button, storage use, and every network request the page has made.                                             |
| **My Computer**  | What your browser and hardware can do, and a benchmark you can re-run.                                                                                       |
| **Settings**     | Skin, accent, wallpaper (any picture of your own), text size, motion, indexing, and your whole setup exported as a file you can read and carry.              |

The default skin is a 1990s desktop; a modern one is a switch away in Settings.

## Try it

1. Open the page. A handful of sample documents, PDFs and pictures is generated on your device.
2. Open the **Start** menu, type _invoice for the monitor_ and press **Enter**. Files opens on the
   passage that answers it, not just the file name.
3. Open **Notepad**, type a sentence and press **Ctrl+S**. Search finds it seconds later.
4. Open **Paint**, draw something, and choose **File → Set as Wallpaper**.
5. Open **Task Manager → Network**. Every request the page has made is listed, and your files are
   not among them.
6. Turn off your network and reload. Everything still works, search included.

## What is unusual underneath

It looks like a desktop from 1995. It is a static website doing things static websites are not
usually asked to do.

- **One host, enforced.** The page contacts only the site serving it: no CDN, no analytics, no
  fonts from elsewhere, no model registry. The Content Security Policy allows no other host to be
  fetched or framed, so the browser enforces this rather than the app promising it. The Task
  Manager shows the browser's own request log so you can check.
- **Your files stay in the tab.** The file system is content-addressed storage in the browser's
  private file system (OPFS), with metadata in IndexedDB. Copying and renaming are free, two
  identical files cost the space of one, and nothing is uploaded.
- **Search by meaning, on your machine.** Files are split into passages and embedded by a 23 MB
  model that ships with the page, running in threaded WebAssembly in a worker. A query is ranked
  twice, by meaning and by keyword, and the two are fused; each result says which found it. The
  desktop does not generate text: every answer is a passage from a file you already have.
- **Offline.** A service worker caches the desktop and, on first use, the search runtime, so the
  page boots and searches with the server gone.
- **Cross-origin isolated on a host that cannot send headers.** Threaded WebAssembly needs COOP and
  COEP headers, which GitHub Pages cannot set. The same service worker adds them
  ([ADR 2](./docs/adr/0002-cross-origin-isolation-via-service-worker.md)).
- **Apps from anyone, safely.** Third-party apps run in a sandboxed frame with an opaque origin and
  no network, and ask for each permission when they need it. Three sample apps are installed:
  Calculator, Find and Fence ([`docs/sdk.md`](./docs/sdk.md)).

### Measured, not asserted

On the reference machine (Windows 11, AMD RDNA-3, 16 cores), in the deployed build:

| Result                                            | Value                                                 |
| ------------------------------------------------- | ----------------------------------------------------- |
| Pointer-move cost while dragging, 14 windows open | **0.01 ms** median (one 5.4 ms commit per gesture)    |
| Search over the sample documents                  | **2–5 ms**                                            |
| Embeddings: threaded WASM vs WebGPU               | **6.5 vs 14.4 ms** per passage, so WASM is used       |
| OPFS, 64 MB, sync access handle                   | **591 MB/s write, 781 MB/s read**                     |
| Desktop shell at boot                             | **~90 KB gzipped**; each app loads when first opened  |
| Hosts contacted                                   | **one**, enforced by the CSP                          |
| Offline, server stopped                           | boots, and search still works by meaning (Chrome 151) |

The WASM result overturned the plan's assumption that the GPU would win, so the code follows the
measurement ([ADR 8](./docs/adr/0008-backend-selection-is-measured.md)). The numbers and how they
were taken are in [`docs/benchmarks/`](./docs/benchmarks/).

## Why it looks like 1995

A modern-looking web app that happens to run offline reads as a web app, and the interesting part
has to be pointed out. A 1990s desktop running semantic search from static files makes the point
by itself. Both skins are the same components reading different tokens
([ADR 21](./docs/adr/0021-a-second-skin-and-why-it-is-the-default.md)).

It is an homage, not a copy: no vendor's logo, wordmark, artwork, font file or product name. The
Start menu's banner reads _Tabula_. Where the era's own colours failed a contrast check, the
accessible value wins.

## Running it

```bash
npm install
npm run dev
```

To check what actually ships, build and serve it the way GitHub Pages does, with no special headers
and from a subpath:

```bash
npm run build:pages && npm run serve:pages
```

Then open `http://localhost:4180/tabula/`.

| Command                | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `npm run dev`          | Dev server (sends COOP/COEP directly, matching production behaviour)   |
| `npm run verify`       | Typecheck, lint, test, build — what CI runs                            |
| `npm run build:pages`  | Build with the GitHub Pages base path                                  |
| `npm run serve:pages`  | Serve `dist/` with no headers, imitating GitHub Pages                  |
| `npm run sync:models`  | Regenerate `models.json` (sizes and digests) from the Hugging Face API |
| `npm run sync:weights` | Fetch the model into `public/models/`, verified against those digests  |

The model is fetched at release time, never by the page: `sync:weights` checks every file against
the SHA-256 digests pinned in `models.json`, and the build serves it like any other asset.

## How it is built

React 19, TypeScript and Vite. The kernel's primitives — store, worker RPC, window manager,
service worker — are written here rather than imported, because they are the part worth reading
([ADR 7](./docs/adr/0007-minimal-dependencies.md)). The two runtime dependencies beyond React are
the ML runtime and pdf.js.

```
src/shell      desktop, window frames, taskbar, Start menu, command palette, boot, design tokens
src/kernel     window manager · file system · job scheduler · commands · settings · notifications ·
               capability probe · worker RPC · network monitor · app sandbox host
src/services   index/ (embeddings, vectors, keyword index, thumbnails) · ai/ (runtime config) ·
               extract/ · audio/ · video/ · bench/
src/apps       files (and search) · viewer · notepad · paint · photos · audio · video ·
               recycle-bin · tasks · settings · system-report
src/sdk        the sandboxed app runtime
src/sw         the service worker: cross-origin isolation and the offline shell
docs/adr       architecture decision records
```

Design notes worth the click:

- [ADR 9 — direct-DOM dragging](./docs/adr/0009-direct-dom-drag.md): how the drag loop stays at
  0.01 ms, and the bug that design invites.
- [ADR 6 — content-addressed storage](./docs/adr/0006-content-addressed-opfs.md): why renaming and
  copying are free.
- [ADR 11 — how the app sandbox is delivered](./docs/adr/0011-sandbox-delivery.md): two reasonable
  assumptions about iframe CSP, both wrong, and the measurements that settled it.
- [ADR 17 — customisation is a file](./docs/adr/0017-customisation-is-a-file.md): why your setup
  exports as readable JSON instead of syncing to an account.

## Browser support

| Browser               | Status                                                            |
| --------------------- | ----------------------------------------------------------------- |
| Chrome / Edge desktop | Primary target. Folder picker, persisted directory handles        |
| Firefox 147+ desktop  | Supported. Drag-and-drop and file-picker import; no folder picker |
| Safari 26 (macOS)     | Supported. Drag-and-drop and file-picker import; no folder picker |
| Mobile                | Best effort. Compact layout below 720 px, windows open maximised  |

On a small screen, the desktop says so on arrival rather than letting you find out
([ADR 18](./docs/adr/0018-mobile-is-a-visit-not-a-target.md)).

## Limitations

- **Only text is searchable by content.** Pictures, audio and video are found by name. A scanned
  PDF has no text layer, so it is found by name too.
- **Search is honest, not tuned.** Ranking fuses meaning and keyword results with no learned
  reranking, and short generic documents can outrank better ones.
- **Files above 256 MB are refused**, because hashing needs the whole file in memory. Storage
  quota is whatever the browser grants, roughly 3 GB on the reference machine.
- **Exporting your setup does not export your files.** Settings, icons, wallpaper and open windows
  travel as a small JSON file; a bulk export of the file system is still to be built.
- **Paint has no text tool, selection or canvas resize**, and drawing needs a pointer.
- **One benchmark machine**, Chromium only. Other engines and slower hardware are unmeasured.
- **The SDK is v0** and will change; see the note at the top of [`docs/sdk.md`](./docs/sdk.md).
- **`frame-ancestors` cannot be enforced**: browsers ignore it in a `<meta>` policy, and GitHub
  Pages cannot send headers.

## What was built and taken out

The scope got smaller on purpose, and each cut is written down:

- **Photo search, transcription, OCR, video moment search and duplicate detection** were built and
  measured, then removed: each needed a 66–150 MB download before it did anything
  ([ADR 15](./docs/adr/0015-no-on-demand-models.md)). Choosing their models by testing rather than
  by reputation is its own record
  ([ADR 10](./docs/adr/0010-model-choices-are-tested-not-assumed.md)).
- **A language model** was planned as optional, then closed without being built, once every
  feature that seemed to need one turned out to be retrieval
  ([ADR 14](./docs/adr/0014-no-text-generation.md)).
- **A YouTube player and a portfolio page** shipped and were removed, along with the standalone
  Search app, when the goal became a default desktop and nothing more
  ([ADR 23](./docs/adr/0023-a-default-desktop.md)).
- **A web browser inside the desktop** was never built, for four separate reasons
  ([ADR 19](./docs/adr/0019-no-browser-inside-the-browser.md)).

The roadmap and its history are in [`plan v2.md`](./plan%20v2.md).

## Licence

Code: MIT (see [LICENSE](./LICENSE)). The model and third-party components keep their own licences
— see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). All sample content, icons and wallpapers
are original to this project.

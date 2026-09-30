# Architecture

Version 0.2 — reflects M1, where the desktop actually exists.

## The shape

```
┌──────────────────────────── Browser tab (static files only) ──────────────────────────────┐
│ SHELL (main thread, React)                                                                │
│   desktop · window frames · taskbar · launcher · command palette · notifications · boot   │
│   apps: Files · Viewer · Notepad · Search · Photos · Audio · Video · Settings ·           │
│         Task Manager · My Computer                                                        │
│                                                                                           │
│ KERNEL (TypeScript, main thread)                                                          │
│   window manager · VFS client · job scheduler · command registry · settings ·             │
│   notifications · capability probe · worker RPC · network monitor                         │
│                                                                                           │
│ SERVICES (workers)                                                                        │
│   vfs.worker    metadata + blobs, OPFS sync access handles                                │
│   index.worker  embedding model + vector index + BM25 + text extraction (pdf.js)          │
│                 + thumbnails                                                              │
│   probe.worker  worker-only capability answers                                            │
│   bench.worker  the M0 benchmark harness, now in My Computer → Performance                │
│                                                                                           │
│ STORAGE                                                                                   │
│   OPFS: content-addressed blobs        IndexedDB: file tree, index snapshot               │
│   localStorage: settings, session      Cache API: shell · ONNX runtime · weights          │
└───────────────────────────────────────────────────────────────────────────────────────────┘
   ▲ the serving origin — code, ONNX runtime, the model. There is no second arrow.
```

## Boot

1. Apply settings to `<html>` before the first paint, so the skin never flashes.
2. Register the service worker. If the page is not cross-origin isolated, reload **once** so its
   COOP/COEP headers apply to the document.
3. Probe capabilities — on the main thread, and again inside a worker for the questions only a
   worker can answer.
4. Mount the file system.
5. On a first visit, generate the sample corpus. Then start the indexer.

Each step reports itself on the boot screen. That is not decoration: an app whose claim is "this
runs on your hardware" should open by saying what it found there.

## Threading

The main thread renders and coordinates. Everything expensive is in a worker, because the window
manager has to stay at 60 fps while models load and files index.

`src/kernel/rpc.ts` is a ~130-line typed RPC over `postMessage`: promises for calls, a progress
channel for long operations, and transferable buffers so a file read hands over its bytes instead
of cloning them.

## The window manager

State in `src/kernel/windows.ts` — pure data, no DOM, no React. That separation is what lets the
drag loop bypass React entirely while the taskbar, the command palette and session restore all
read the same plain objects.

During a gesture, pointer moves write `transform` straight to the element; the store is committed
once, on release. Measured: 0.01 ms per move against a 5.4 ms commit for the whole desktop. The
trap this creates — and the bug it caused — is written up in
[ADR 9](./adr/0009-direct-dom-drag.md).

Snapping, clamping and session serialisation are all functions over that state, which is why they
are covered by unit tests rather than by clicking.

## The file system

Metadata is a tree of nodes in IndexedDB. Content lives once in OPFS under its SHA-256, sharded
two characters deep. Consequences worth stating:

- Rename, move and copy are metadata-only.
- Two identical files cost one file's worth of space; the Task Manager reports the difference.
- Derived data keyed by hash survives a rename for free.
- Deleting means dropping blobs whose reference count reaches zero — done **after** the metadata
  transaction commits, because OPFS and IndexedDB are not transactional together, and keeping
  bytes nothing points at is far better than losing bytes something does.

Every mutation announces what changed, locally and over a `BroadcastChannel`, so a note saved in
one app appears in an open Files window — in this tab or another — without either knowing the
other exists.

## Search

One worker owns the model, the vector index and the keyword index, because a query needs all three
and shuttling embeddings between workers would cost more than the search does.

Text in → extract (pdf.js for PDFs, Markdown stripped to prose) → chunk on paragraph and sentence
boundaries with overlap → embed → store. Chunks carry character offsets into the source, which is
what lets a result open the file at the exact passage.

A query runs twice: cosine similarity over normalised vectors, and BM25 over tokens. The two
rankings are combined by **reciprocal rank fusion**, which merges by position rather than score —
a cosine similarity and a BM25 score are not on the same scale, and normalising them would invent
a comparison that does not exist.

Both halves matter. Semantic retrieval finds "the joiner's quote for wooden countertops" in a note
that says "the carpenter quoted 3200 for the oak worktops". Keyword retrieval is what finds
"Samsung". Each result is labelled with which one found it.

The vector index is a flat `Float32Array` scanned linearly — exact, cheap to update, and faster
than an approximate-nearest-neighbour graph at this scale. The upgrade path is documented in
ADR 6 and will be taken when a measurement demands it, not before.

## The job scheduler

Everything slow is a job: indexing, model loading, importing, searching. Three properties earn it
its place — priority (an interactive search jumps ahead of two thousand background index jobs),
cancellation (closing a window stops the work it started), and visibility (every job is listed in
the Task Manager, because work you cannot see is work you cannot trust).

Concurrency is capped at two, not at hardware concurrency: the ML runtime already uses up to four
threads internally, and the limit exists to leave the main thread room to stay at 60 fps.

## One registry for commands

Commands, keyboard shortcuts and the launcher all read `src/kernel/commands.ts`. Keeping them
separate is how a desktop ends up with a menu item that works, a shortcut that does something
subtly different, and a palette entry nobody updated.

Shortcut choices are constrained by the browser: Ctrl+W, Ctrl+T and Ctrl+N belong to the tab strip
and cannot be intercepted, so window management lives on Ctrl+Alt.

## Trust, made checkable

The privacy claim is only worth something if it can be verified, so the Task Manager reads the
browser's own Resource Timing buffer and lists every request the page has made, third-party ones
marked. Instrumenting our own fetches would only report the requests we chose to report; the
browser's record includes the ones we did not.

## What M2–M4 added, and what is left of it

M2 added image and speech models, M4 added video moment search, near-duplicate detection and OCR.
All of them were fetched on demand from `huggingface.co` behind a consent dialog, and all of them
were removed afterwards: a portfolio piece that asks a visitor to download 150 MB before it will do
what it advertises is asking for a commitment the visitor has no reason to make. The reasoning and
the cost are in [ADR 15](./adr/0015-no-on-demand-models.md).

What survived is what needed no model:

- **Thumbnails.** They used to be a by-product of embedding a picture, because the image was
  decoded anyway. They are now made by a worker that does nothing else — a grid decoding
  4000-pixel originals is what makes a file manager stutter regardless.
- **Waveforms.** Decoding to mono 16 kHz was a speech model's requirement; it is now simply what
  makes scanning three minutes of audio for peaks cheap.
- **Frame and section export.** Seeking a `<video>`, drawing to a canvas and recording a stream
  are browser APIs. Video still does both.

## What M3 adds

An app platform. Third-party code runs in an iframe with `sandbox="allow-scripts"` and no
`allow-same-origin`, so its origin is opaque: no storage, no cookies, no reach into the host page,
and `connect-src 'none'` for no network. Everything it can do passes through `src/kernel/appHost.ts`,
which checks both that the manifest declared the capability and that the user has granted it, and
scopes file access to the app's own folder plus the one file it was opened with. See
[`docs/sdk.md`](./sdk.md) and [ADR 11](./adr/0011-sandbox-delivery.md).

## What M4 added that stayed

Little, in the end — the M4 pool was picked for features that needed models. What remains from it
is the video sample recorder (canvas plus `MediaRecorder`, drawn live), the clip exporter, and two
fixes that outlived their features: an absolute floor in `VectorIndex.search` that had been
silently inert since M1, and `MissingContentError`, which names the file when its stored bytes have
gone missing.

## Where the model comes from

The one remaining model is part of the build. `tools/sync-model.mjs` fetches it from
`huggingface.co` at release time, checks every file against the SHA-256 pinned in `models.json`,
and writes it into `public/models/`; `src/services/ai/runtime.ts` points the ML library there and
sets `allowRemoteModels: false`, so remote loading is not merely unnecessary but switched off.

That moves verification from runtime to build time and makes the page contact exactly one host.
It also removes a whole subsystem: consent dialogs, download jobs with progress and cancellation,
and a cache keyed by the URL the library would otherwise have requested all existed to make a
cross-origin fetch safe and honest. There is no cross-origin fetch.

Two things had to change before that actually worked offline, and both were only found by pulling
the plug and looking.

The `navigator.onLine` check that used to skip the model during search is gone. It was correct when
loading meant a request to another host that would stall and fail; once the weights were local it
was the only thing forcing every offline query down to keyword-only.

And the **ONNX runtime was never cached**. The precache list is filtered to `js|css|html`, so the
13 MB of `runtime/*.wasm` was fetched fresh every session and 404'd with the network off — no model
could run, whatever else was cached. Precaching it is not the answer either: 36 MB of runtime and
weights during service-worker install would mean a first visit that downloads the whole inference
stack before anything is cached, for someone who may never search. So the service worker fills
those two caches on first use instead, and names them after their contents —
`tabula-runtime-<onnxruntime version>` and `tabula-weights-<digest of the model digests>` — so each
is invalidated by its own upgrade rather than by every deploy.

## When the two stores disagree

File metadata lives in IndexedDB and file content lives in OPFS, and the two are not transactional
with each other. Writes are ordered so the safe failure is the survivable one — bytes with no
record, rather than a record with no bytes — and the blob sweep after a permanent delete only
removes a hash no record still references.

It is still possible to end up holding a record whose bytes are gone: an interrupted write, storage
eviction, or a bug. Turning up during M4, that state produced nothing but a bare "A requested file
or directory could not be found" rejected into the console, naming no file and suggesting no
repair. Reads now raise a `MissingContentError` that names the file, and **Settings → Check files**
walks every record and lists the ones whose content is absent. The desktop cannot repair them —
the bytes are gone — but a system that can tell you exactly which files are damaged is a different
thing from one that fails a file at a time and says nothing useful.

Eviction is the other half of that problem, and the cheaper half to address. Browser storage is
"best-effort" unless an origin asks otherwise, so boot calls `navigator.storage.persist()` once
(`src/kernel/persistence.ts`). It is not awaited: Firefox answers by prompting, and a desktop that
will not finish starting until someone resolves a dialog about storage policy is a worse desktop
than one that asks quietly and carries on. The answer is mostly not ours to give — Chromium decides
from engagement heuristics and normally declines on a first visit — so My Computer reports what the
browser actually said rather than what was hoped for. It prevents future eviction; it cannot
recover bytes already gone.

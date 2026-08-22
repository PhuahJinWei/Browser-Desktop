# Architecture

Version 0.2 — reflects M1, where the desktop actually exists.

## The shape

```
┌──────────────────────────── Browser tab (static files only) ─────────────────────────────┐
│ SHELL (main thread, React)                                                                │
│   desktop · window frames · taskbar · launcher · command palette · notifications · boot   │
│   apps: Files · Viewer · Notes · Search · Settings · Task Manager · About                 │
│                                                                                           │
│ KERNEL (TypeScript, main thread)                                                          │
│   window manager · VFS client · job scheduler · command registry · settings ·             │
│   notifications · capability probe · worker RPC · network monitor                         │
│                                                                                           │
│ SERVICES (workers)                                                                        │
│   vfs.worker    metadata + blobs, OPFS sync access handles                                │
│   index.worker  embedding model + vector index + BM25 + text extraction (pdf.js)          │
│   probe.worker  worker-only capability answers                                            │
│   bench.worker  the M0 benchmark harness, still in About                                  │
│                                                                                           │
│ STORAGE                                                                                   │
│   OPFS: content-addressed blobs        IndexedDB: file tree, index snapshot               │
│   localStorage: settings, session      Cache API: app shell (service worker)              │
└───────────────────────────────────────────────────────────────────────────────────────────┘
   ▲ serving origin — code                          ▲ huggingface.co — the model, on first use
```

## Boot

1. Apply settings to `<html>` before the first paint, so the theme never flashes.
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

## What M2 adds

CLIP-family image embeddings and Whisper transcription, which turn Photos and Audio into real
apps. Both plug into the existing model registry, job scheduler and index rather than needing new
machinery — which was the point of building those first.

## What M3 adds

An app platform. Third-party code runs in an iframe with `sandbox="allow-scripts"` and no
`allow-same-origin`, so its origin is opaque: no storage, no cookies, no reach into the host page,
and `connect-src 'none'` for no network. Everything it can do passes through `src/kernel/appHost.ts`,
which checks both that the manifest declared the capability and that the user has granted it, and
scopes file access to the app's own folder plus the one file it was opened with. See
[`docs/sdk.md`](./sdk.md) and [ADR 11](./adr/0011-sandbox-delivery.md).

## What M4 adds

Search inside video, which needed no new index and no new model.

The split is the one the platform forces. `<video>` is a DOM element, so `src/services/video/frames.ts`
runs on the main thread: it seeks the element to a timestamp every two seconds, draws to a canvas
letterboxed into a square, and emits a few kilobytes of WebP. Those buffers are _transferred_ to
the index worker, where the CLIP model already lives, so the expensive part never touches the main
thread.

A sampled frame is stored as an ordinary image record that additionally carries the time it came
from and the id of its video. That is the whole of the data model: a video moment and a photograph
are the same kind of thing in the same vector space, so persistence, model lifecycle and search
were already written. What is new is `src/services/index/moments.ts`, which turns a run of
consecutive matching frames into one moment with a start, an end, and its best frame — because six
near-identical frames of one shot is a worse answer than one section with boundaries, and because
a section with boundaries is the thing that can be exported.

Two numbers shape the design. Sampling a frame costs 40 ms and embedding it costs 257 ms, so the
decoder is not worth optimising and the model is; and a matching frame scores 0.27–0.32 while a
query with no answer tops out at 0.24, so there is an absolute floor at 0.25 below which nothing
is returned at all. Both are measured, in [`docs/benchmarks/`](./benchmarks/), and the reasoning
is in [ADR 12](./adr/0012-video-moments.md).

M4 also adds a near-duplicate finder, which needed no model at all — the vectors were already
there. `VectorIndex.pairsAbove` walks every pair, but skips almost all of them with an exact
bound: because the rows are normalised, the dot product of the first 64 dimensions plus the
product of the two tails' magnitudes cannot be less than the whole dot product, so a pair whose
bound falls under the threshold cannot qualify and its remaining 448 dimensions are never read.
Over five thousand vectors that is 0.41% of pairs needing full evaluation and a 6.1× speed-up,
with results identical to the naive scan — which a test asserts. `duplicates.ts` then turns pairs
into sets with union-find, so five copies are one row rather than ten pairs.

It remains quadratic, and the honest limit is around twenty thousand pictures. Past that the
answer is a blocking index rather than a better constant.

## Reading text out of pictures

The last thing M4 adds is OCR, and it is a model rather than a library on purpose: the desktop
already has consent, integrity checking, caching, a Task Manager entry and an unload path for
models, and none of that would have applied to a bundled OCR engine's own assets. See
[ADR 13](./adr/0013-ocr.md).

TrOCR reads one _line_, not a page, so `src/services/ocr/segment.ts` does the layout: Otsu
binarisation, ink counted per row, and text lines read off the projection profile. It handles dark
text on a light ground, upright, one column — and refuses anything that does not look like a page
rather than spending a model pass on each band of texture in a photograph.

What the model returns goes into the ordinary document index through `indexText`, which shares
every step after extraction with `indexDocument`. From there a scanned page is a document: same
chunks, same embeddings, same snippets, ranked beside the notes and the PDFs. Search has no idea
the words came from pixels, which is the point.

The backend surprised the plan for the second time. Recognition runs on **threaded WASM**, not the
GPU: 3.1 s against 18.4 s for the same page, and with fewer mistakes. A dozen sequential decoder
steps per line cost more to dispatch than to compute — the same finding M0 made about small text
embeddings, in a place nobody expected it.

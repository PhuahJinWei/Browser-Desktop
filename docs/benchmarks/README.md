# Benchmarks

Numbers produced by the in-app System Report, not by estimation. Each file here is one machine's
export; the summary below is what those numbers actually changed about the design.

## How to add a machine

```bash
npm run build
npm run serve:pages
```

Open `http://localhost:4180/tabula/`, run all three benchmarks, click **Export JSON**, and drop
the file in this directory named after the machine. The server deliberately sends no COOP/COEP
headers so the run reflects GitHub Pages rather than a dev server.

For automation, the report is also mirrored on `globalThis.__tabulaReport`.

## Machines

| ID                                                    | Machine                                 | Browser                 | Tier |
| ----------------------------------------------------- | --------------------------------------- | ----------------------- | ---- |
| [`m1-ryzen-rdna3-win11`](./m1-ryzen-rdna3-win11.json) | Windows 11, AMD RDNA-3, 16 cores, 16 GB | Chromium 148 (Electron) | A    |
| _pending_                                             | An integrated-GPU laptop (Tier B)       | stock Chrome            | —    |
| _pending_                                             | Cross-browser check                     | Firefox 147+, Safari 26 | —    |

M0 called for at least two machines. One is recorded; the second is outstanding and is the first
thing to close in M1, because every Tier-B assumption in the plan currently rests on one data
point from a Tier-A box.

## What the first machine showed

**all-MiniLM-L6-v2, int8, 8 batches of 16 sentences, timed after a warm-up pass, in a worker.**

| Backend               | Load (cold) | Load (warm) | Warm-up | ms/chunk (median) | observed range | chunks/s  |
| --------------------- | ----------- | ----------- | ------- | ----------------- | -------------- | --------- |
| WebGPU                | 6837 ms     | 1172 ms     | 790 ms  | **14.43**         | 14.36 – 15.25  | 66 – 70   |
| WASM (SIMD, threaded) | 7793 ms     | ~1000 ms    | 180 ms  | **6.54**          | 4.24 – 6.83    | 146 – 236 |

Five WASM runs and three WebGPU runs, four threads throughout. The spread is real — treat the
medians as the result and the ranges as the honest precision.

**Threaded WASM is roughly 2.2x faster than WebGPU for this model** (2.1x–3.4x across runs),
reproducibly, with the GPU warm.
That is the opposite of the assumption the plan was written on, and it changed the code:
`preferredBackend()` now picks a backend per task rather than defaulting to the GPU whenever one
exists.

The likely reason is unsurprising in hindsight — a 22 MB encoder over short sentences is dominated
by per-dispatch overhead, and four SIMD threads simply beat the round trip to the GPU. The
expectation is that this reverses for vision towers, Whisper and anything generative, which is
exactly what M2 has to measure rather than assume.

**OPFS, 64 MB file, sync access handle in a worker:** write **591 MB/s**, read **781 MB/s**.
(A second run measured 511 / 915 MB/s; treat these as "fast enough that OPFS is not the
bottleneck" rather than precise figures.) Fast enough to be the file system, which settles the
storage design.

**Sync access handles are worker-only.** The first version of the capability probe asked on the
main thread, got `false`, and was wrong — the OPFS benchmark then used them successfully from a
worker. The probe now asks from a worker and reports `null` for "not knowable here". A reminder
that a capability probe has to run in the context that will use the capability.

## Payload sizes

Measured, not estimated — `tools/sync-runtime.mjs` and `tools/fetch-model-registry.mjs` print these.

| Asset                                                            | Raw     | Gzipped                    |
| ---------------------------------------------------------------- | ------- | -------------------------- |
| ONNX runtime **actually fetched** (`…asyncify.wasm`)             | 22.5 MB | **5.4 MB**                 |
| ONNX runtime, non-asyncify build (kept as fallback, not fetched) | 12.3 MB | 3.2 MB                     |
| all-MiniLM-L6-v2 int8 + tokenizer                                | 22.6 MB | ~22 MB (already quantised) |
| App shell (JS + CSS)                                             | 216 KB  | **68 KB**                  |

A request log settled which runtime is used: transformers.js v4 loads the **asyncify** build on
both the WASM and WebGPU paths. The first draft of this file quoted the smaller non-asyncify
number, which was wrong — worth stating, since it is exactly the kind of figure that gets quoted
for years without anyone checking.

The bundler also emitted its own 22.5 MB copy of that binary into `dist/assets/`. Nothing ever
requested it (`wasmPaths` points at `/runtime/`), so a build plugin now drops it.

First visit that actually uses AI: roughly **28 MB** (5.4 MB runtime + 22.6 MB model). The shell alone is 68 KB, so the desktop can
paint and be usable long before any of that arrives — which is the entire argument for loading
models lazily rather than at boot.

Tier-0 bundle total is 64.2 MB against an 80 MB budget (see `models.json`), which allows about
1,595 first-time visitors per month within the 100 GB GitHub Pages soft bandwidth limit.

## Caveat worth repeating

Machine 1 is an Electron-embedded Chromium, not stock Chrome, and it is a desktop with a discrete
AMD GPU. Nothing here should be quoted as a cross-browser or cross-tier result until the pending
rows above are filled in.

## M1 — the desktop

Measured on the same reference machine, in the deployed build served without headers.

### Window management

| Measurement                                          | Value                                     |
| ---------------------------------------------------- | ----------------------------------------- |
| Pointer-move handling during a drag, 14 windows open | **0.01 ms** median (p95 0.02, worst 0.12) |
| React commit for the whole desktop, per gesture      | **5.4 ms**                                |
| Frame budget at 60 fps                               | 16.7 ms                                   |

The drag path writes `transform` straight to the element and commits to React once, on
pointer-up. Routing every move through state instead would spend that 5.4 ms _per frame_ — about a
third of the budget — before any of the app's own work. See
[ADR 9](../adr/0009-direct-dom-drag.md), which also records the bug this design creates if the
inline styles are cleared rather than restored.

Note the window count: the M1 target was eight, and these numbers are from fourteen.

### Search

| Measurement                               | Value                                                  |
| ----------------------------------------- | ------------------------------------------------------ |
| Hybrid query over 12 passages, model warm | **2–5 ms**                                             |
| Same query, offline, keyword-only         | **2 ms**                                               |
| Index restored from IndexedDB on reload   | 8 documents, 11 passages, 422 terms, 1.5 MB of vectors |

Search latency here is dominated by fixed costs rather than corpus size — a linear scan of a
1.5 MB Float32Array is not the expensive part at this scale. The figure worth re-measuring is with
tens of thousands of passages, which needs a corpus M1 does not ship.

**One offline finding worth recording.** With no model in memory and no network, the first search
took **6.3 seconds** — all of it spent waiting for a model fetch that could not succeed — before
falling back to keyword results. The fix was to check `navigator.onLine` and skip the attempt, so
the keyword results already in hand are returned immediately. Graceful degradation is not
automatic; it has to be measured, or it degrades slowly instead of gracefully.

### Payload

| Asset                                    | Raw        | Gzipped           | When it loads                        |
| ---------------------------------------- | ---------- | ----------------- | ------------------------------------ |
| Desktop shell (JS)                       | 68.7 KB    | **24.3 KB**       | boot                                 |
| React                                    | 189.7 KB   | 59.6 KB           | boot                                 |
| Shell CSS                                | 23.9 KB    | 5.3 KB            | boot                                 |
| Files app                                | 15.6 KB    | 5.6 KB            | when opened                          |
| Search / Notes / Settings / Task Manager | 4.7–7.0 KB | 2–2.5 KB each     | when opened                          |
| pdf.js                                   | 427.3 KB   | 127.4 KB          | only when a PDF is opened or indexed |
| ONNX runtime + embedding model           | —          | ~5.4 MB + 22.6 MB | first search or first index          |

Boot costs about **90 KB gzipped**. Everything expensive is deferred to the moment it is first
genuinely needed, which is the whole argument for lazy-loading apps rather than bundling them.

## M2 — photos and audio

### Image search quality

Eight procedurally drawn sample pictures, six natural-language queries, scoring how often the
intended picture came first.

| Model                | Size   | Correct at rank 1                  | Licence    |
| -------------------- | ------ | ---------------------------------- | ---------- |
| CLIP ViT-B/32 (int8) | 150 MB | **6 / 6**                          | MIT        |
| MobileCLIP-S0 (int8) | 54 MB  | **0 / 6** (3 / 3 within top three) | Apple ASCL |

Queries: "sunset over the ocean", "a red keyboard", "stars at night", "a hot drink", "mountains",
"a bar chart". MobileCLIP put the right answer near the top every time and at the top never —
consistent with its repository shipping a config that omits the preprocessing parameters. The
choice, and the reasoning, are in [ADR 10](../adr/0010-model-choices-are-tested-not-assumed.md).

This is a small and deliberately easy corpus. It is enough to separate a working configuration
from a broken one, which is what it was for; it is not a benchmark of CLIP.

### Photo indexing and search

| Measurement                                             | Value                                                 |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Embedding 8 pictures (512 px WebP), background priority | a few seconds, UI unaffected                          |
| Photo query, model warm                                 | **~250–800 ms** including the text-tower forward pass |
| Combined document + photo search                        | 12 document hits + 1 photo in **285 ms**              |
| Image vector memory                                     | 512 dimensions × 4 bytes per picture                  |

### Transcription

| Whisper decoder export | Size   | Result                                            |
| ---------------------- | ------ | ------------------------------------------------- |
| `q8` (quantised)       | 29 MB  | **fails**: `Missing required scale … MatMulNBits` |
| `int8`                 | 29 MB  | **fails**: same error                             |
| `fp16`                 | 57 MB  | works — chosen                                    |
| `fp32`                 | 113 MB | works                                             |

End-to-end on a 4-second clip: decode → recognise → chapter → write the transcript into the file
system → index it, in about 10 seconds including model load. The transcript is an ordinary
Markdown file, so it was picked up by the document indexer 252 ms later and is searchable like
anything else.

**Not yet measured:** the real-time factor on a long recording, which needs actual speech. The
project's own headless testing cannot supply that — there is no microphone and no bundled speech
sample, for the reason given in the README. The code reports `realtimeFactor` on every run, so
the number is one real recording away.

### Model download manager

| Measurement                                             | Value                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| CLIP ViT-B/32, 9 files, downloaded and SHA-256 verified | 150 MB in ~3.3 s on this connection                                   |
| Verification                                            | every file checked against a digest pinned in `models.json`           |
| Storage                                                 | written into the ML library's own cache, so it never re-requests them |

Tier-0 (no consent needed, no download) is back to **22.6 MB** — about 4,500 first-time visitors a
month within the GitHub Pages allowance. Everything else is asked for first.

## M3 — the app sandbox

The claim is that a third-party app cannot reach the user's data. Here is a sandboxed app being
asked to try, and the results it reported.

### What the sandbox refuses

Probed from inside a running sandboxed app:

| Attempt                                   | Result                            |
| ----------------------------------------- | --------------------------------- |
| `localStorage` / `sessionStorage`         | `SecurityError`                   |
| `document.cookie`                         | `SecurityError`                   |
| `indexedDB.open()`                        | `SecurityError`                   |
| `caches.open()`                           | `SecurityError`                   |
| `navigator.storage.getDirectory()` (OPFS) | promise rejects, `SecurityError`  |
| `parent.document` / `parent.localStorage` | `SecurityError`                   |
| `top.location.href`                       | `SecurityError`                   |
| `fetch('https://example.com')`            | blocked (`TypeError`)             |
| remote `<img>`                            | blocked                           |
| `new WebSocket(...)`                      | constructs, never connects        |
| `location.origin`                         | **`null`** — the origin is opaque |

For comparison, the desktop's own OPFS at that moment contained `blobs` — the store holding every
file the user has imported. The sandbox cannot see that it exists.

One caveat found while writing this: the first version of the probe reported OPFS as _allowed_,
because it only checked that `getDirectory()` returned an object. It returns a promise, and the
promise rejects. A test that does not await is a test that lies.

### File scoping

The same technique, written by the app into a file the desktop can read:

```
write into own folder: ALLOWED
list own folder:       ALLOWED
read the home folder:  REFUSED — An app may only read its own files, or the file it was opened with
list the home folder:  REFUSED — An app may only list its own folder
remove a file outside: REFUSED — An app may only remove its own files
```

An app holding both `fs:read` and `fs:write` still reaches only `Apps/<its name>/` and the single
file it was opened with.

### Sizes

|                                            |                                  |
| ------------------------------------------ | -------------------------------- |
| Sandbox bootstrap (the whole SDK client)   | **2.1 KB** minified              |
| Sandbox document, including its stylesheet | 3.9 KB                           |
| Calculator, Find and Scratchpad            | 3.4 KB, 3.0 KB, 2.7 KB of source |
| App shared as a link                       | ~1.4 KB of URL per KB of source  |

### Delivery, and two wrong assumptions

Getting the bootstrap to run at all took three attempts. A sandboxed frame **inherits its
embedder's CSP** (its origin is opaque, and inheritance exists so sandboxing cannot escape a
policy), so the desktop's `script-src 'self'` silently blocked it. Allowing it by SHA-256 fixed
that. Then a second surprise: in this environment a sandboxed frame loading a real same-origin URL
still would not execute scripts, while the identical markup as `srcdoc` did — with or without the
frame's own CSP, and with the service worker's headers removed. Full write-up in
[ADR 11](../adr/0011-sandbox-delivery.md).

## M4 — video moment search

Reference machine as before. The fixture is the sample video the desktop records for itself:
eight scenes, four seconds each, 512×512, 32 seconds, 2.9 MB of VP9.

### Cost

Three consecutive re-index runs, wall clock, measured from the app's own progress bar:

|                                                             | run 1  | run 2  | run 3  |
| ----------------------------------------------------------- | ------ | ------ | ------ |
| Sampling 16 frames (seek + draw + WebP encode), main thread | 639 ms | 637 ms | 623 ms |
| Thumbnails + embedding 16 frames (CLIP ViT-B/32, WebGPU)    | 4075   | 4105   | 4152   |
| **Whole video, imported → searchable**                      | 4714   | 4742   | 4774   |

So about **40 ms per frame to sample and 257 ms to embed** — 4.7 s to make 32 seconds of video
searchable, and the model, not the seeking, is the cost. That is the opposite of what the design
assumed: `<video>` seeking was chosen over WebCodecs expecting to pay for it, and at one frame
every two seconds the bill never arrives.

|                        |                                             |
| ---------------------- | ------------------------------------------- |
| Query, warm model      | **244–318 ms** across ten queries           |
| Index growth           | 16 vectors × 512 × 4 B = **32 KB**          |
| Frame thumbnails kept  | 3.5 KB average (1.9–5.3 KB), 336×336 WebP   |
| Sample video itself    | 2.9 MB for 32 s, VP9, 512×512               |
| Clip export, 4 seconds | **4 s** — real time, by definition — 468 KB |

### Retrieval

Every query typed into the app, against the 16 indexed frames. "Expected" is the scene's real
position in the video; the app returns a padded range around the frames that matched.

| Query                             | Returned    | Best frame | Correct?                     |
| --------------------------------- | ----------- | ---------- | ---------------------------- |
| a red keyboard                    | 0:12 – 0:16 | 0.32       | ✔ exactly the scene          |
| a cup of coffee                   | 0:20 – 0:24 | 0.30       | ✔ exactly the scene          |
| a path through trees              | 0:24 – 0:28 | 0.30       | ✔ exactly the scene          |
| mountains reflected in a lake     | 0:08 – 0:12 | 0.30       | ✔ exactly the scene          |
| a tropical beach with a palm tree | 0:28 – 0:32 | 0.31       | ✔ (plus the sunset, at 0.30) |
| the night sky                     | 0:02 – 0:08 | 0.28       | ✔ one frame wide of the cut  |
| a sunset over the ocean           | 0:02 – 0:04 | 0.30       | ✔ inside the scene           |
| a bar chart                       | 0:12 – 0:20 | 0.27       | ~ contains it, 4 frames wide |
| a submarine                       | _nothing_   | —          | ✔ correctly nothing          |
| a person riding a horse           | _nothing_   | —          | ✔ correctly nothing          |

The bar chart is the honest weak case, and it is weak in the still pictures too: against the
sample photographs, "a bar chart" scores the chart at 0.27 and the keyboard at 0.26 — a one-point
margin, because a drawn chart is mostly coloured rectangles and so is a drawn keyboard. Every
other query has a five-to-nine point margin.

### Where the score floor came from

Measured on the still pictures, where the right answer is known:

| Query                     | Correct picture | Best wrong picture |
| ------------------------- | --------------- | ------------------ |
| a red keyboard            | 0.32            | 0.23               |
| a sunset over the ocean   | 0.29            | 0.24               |
| a bar chart               | 0.27            | 0.26               |
| a submarine (not present) | —               | 0.23               |

So the floor goes at **0.25**: under every true answer even after a video's re-encoding costs it a
point, over what a query with no answer can reach. Without it, every query returned every frame of
every video, ranked by noise, and the whole video came back as one 0:00–end "moment".

### Three things that were wrong, and how they showed up

**The floor was not being applied at all.** `VectorIndex.search(query, limit, minScore)` consulted
`minScore` only once its result list was full. Video search asks for 240 hits over a handful of
frames, so the list never filled and every frame came back regardless of score. It had been latent
since M1: document and photo search apply their own thresholds afterwards, which hid it. Now an
absolute floor, with three tests.

**Widescreen frames lost their subject.** CLIP's processor resizes the shortest edge to 224 and
centre-crops, so a 16:9 frame loses about 44% of its width before the model sees it. A keyboard
spanning the frame was cropped into an unrecognisable red band; a cat's face in the middle of an
unrelated scene survived intact and won. Frames are now letterboxed into a square, which makes the
crop a no-op.

**The fixture was the weakest part.** The first sample video used eight scenes drawn for it, and
the model ranked them at random — "a red keyboard" gave the hand-drawn keyboard 0.21 and a cat
0.24. The same query against the sample _photographs_ gives 0.32 and 0.23. The video is now made
of those pictures, so a video moment and a photograph are directly comparable rather than the
video being tested against a worse set of drawings.

## M4 — the near-duplicate finder

### Scoring

Every number below is CLIP cosine similarity, read off the app. The sample set now contains two
deliberate copies — one picture re-saved at low quality, one cropped — plus, incidentally, a frame
exported from the sample video, which is a copy of a picture without anyone having planned it.

| Pair                                                               | Score    |
| ------------------------------------------------------------------ | -------- |
| Red keyboard, and the same saved at quality 0.32                   | **0.98** |
| Red keyboard, and a frame exported from the video showing it       | **0.97** |
| Sunset over the sea, and a 72% centre crop of it                   | **0.95** |
| Beach and palm ↔ Sunset over the sea (most alike _different_ pair) | 0.79     |
| Forest path ↔ Mountain lake                                        | 0.79     |
| Night sky ↔ Sunset over the sea                                    | 0.76     |

Every copy scores 0.95 or more and no genuinely different pair reaches 0.80, so the threshold at
**0.92** sits in an empty band sixteen points wide. That is a much easier judgement than the video
score floor, where the bands nearly touched.

Over eleven pictures the whole scan takes **8 ms**, and it finds two groups: the three keyboards
(97–98% alike) and the two sunsets (95%).

### The scan, and what the bound saves

All-pairs similarity is quadratic, so it is worth not doing most of it. Because the vectors are
normalised, the dot product of the first 64 dimensions plus the product of the two tails'
magnitudes is an upper bound on the whole dot product; if that is already under the threshold the
remaining 448 dimensions are never touched.

Random 512-dimension vectors, threshold 0.92, on the reference machine:

| Vectors | Pairs  | Naive    | With the bound | Full dot products still needed |
| ------- | ------ | -------- | -------------- | ------------------------------ |
| 500     | 125 k  | 54 ms    | **13 ms**      | 0.374%                         |
| 2,000   | 2.0 M  | 807 ms   | **129 ms**     | 0.419%                         |
| 5,000   | 12.5 M | 5,066 ms | **830 ms**     | 0.410%                         |

Six times faster at five thousand pictures, and the results are identical — checked here, and by a
unit test that compares the pruned answer with the unpruned one on vectors built so the first 64
dimensions say almost nothing.

It is still quadratic. Twenty thousand pictures would be about thirteen seconds, and past that the
answer is a blocking index (LSH or a clustering pass), not a better constant factor.

### Two bugs this feature found

**Exported frames were the last frame of the video, not the requested one.** `MediaRecorder`
output has no duration until the browser scans for it, which the sampler forces by seeking far
past the end. Resolving as soon as the duration was known left the element parked at the end with
its own `seeked` event still in flight, and the next seek caught that stale event and reported
success without having moved. A frame exported from 0:13 of a 32-second video was the frame at
0:32 — from a scene nineteen seconds later. Found because the duplicate finder paired that frame
with the wrong picture, at 99%, and the pairing was correct: the file really was that other scene.

**Thumbnails never updated after a picture was overwritten.** Object URLs are pooled by file id and
were never invalidated, so re-exporting a frame over an earlier one showed the old image for the
rest of the session — while the index, correctly, had already re-read the new one. The two
disagreed, which is how it was noticed.

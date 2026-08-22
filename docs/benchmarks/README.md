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

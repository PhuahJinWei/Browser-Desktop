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

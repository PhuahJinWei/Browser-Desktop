# Changelog

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

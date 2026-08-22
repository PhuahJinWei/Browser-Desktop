# 8. Backend selection is per-task and based on measurement

Status: accepted (M0)

## Context

The plan assumed WebGPU whenever WebGPU exists. M0 measured it. On the reference machine
(AMD RDNA-3, 16 cores, cross-origin isolated) all-MiniLM-L6-v2 int8 ran at a median 6.54 ms per chunk on
threaded WASM and 14.43 ms on WebGPU — WASM about 2.2x faster, reproducibly, with the GPU warm
(five WASM runs spanning 4.24–6.83 ms, three WebGPU runs spanning 14.36–15.25 ms).

For a 22 MB encoder over short sentences, per-dispatch overhead dominates and four SIMD threads
win. This is expected to reverse for vision towers, Whisper and anything generative.

## Decision

`preferredBackend(capabilities, task)` chooses per task, not globally:

- `text-embedding` prefers threaded WASM when SIMD, threads and cross-origin isolation are all
  present; otherwise the GPU if usable.
- Everything heavier prefers the GPU when usable, falling back to WASM.

A software fallback adapter counts as no GPU: it reports as WebGPU but is a CPU rasteriser.

## Consequences

- The default follows evidence, and the comment in the code cites the numbers.
- The heavier-task defaults are currently assumptions, flagged as such, to be measured in M2.
- Users can override the choice in Settings; the honest position is that per-machine measurement
  beats any heuristic, and the harness to do it already exists.
- One data point, one machine. The conclusion is only as strong as that until a Tier-B machine and
  a second browser engine are added.

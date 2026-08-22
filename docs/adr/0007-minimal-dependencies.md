# 7. Hand-roll the kernel primitives; take dependencies only for hard problems

Status: accepted (M0)

## Context

A desktop environment is mostly primitives: a store, a worker RPC, a service worker, a window
manager. Each has an off-the-shelf answer (Zustand, Comlink, Workbox, a windowing library). For a
project whose point is to demonstrate systems engineering, importing all four leaves little to
look at — and each one sits in a hot path.

## Decision

Hand-roll the primitives, and take dependencies for problems that are genuinely hard: the ML
runtime (`@huggingface/transformers`), PDF parsing (`pdfjs-dist`), media decoding.

- Store: ~40 lines over `useSyncExternalStore`. The window manager needs synchronous reads from
  drag loops and workers, which a React-only store cannot give.
- Worker RPC: ~90 lines, with progress streaming as a first-class concept and room for the
  cancellation tokens the M1 scheduler needs.
- Service worker: hand-written, because it has to do two jobs at once (ADR 0002) and because model
  caching policy is ours.
- Window manager: written from scratch in M1. If the desktop is the centrepiece, importing it
  undercuts the claim.

## Consequences

- More code to own and test, which is the point: it is the part worth reading.
- Revisit the store if cross-store transactions or time-travel debugging become worth the weight.
- Toolchain note: TypeScript is pinned to 6.0.x because `typescript-eslint` requires `<6.1.0`.
  Moving to TypeScript 7 (the native compiler) is a fast-follow once that peer range widens.

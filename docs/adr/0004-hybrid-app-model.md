# 4. Hybrid app model: in-process system apps, sandboxed third-party apps

Status: accepted (M0), implemented in M3

## Context

If Tabula is a platform, apps need somewhere to run. In-process components integrate richly and
cost nothing per call, but offer no isolation. Sandboxed iframes offer real isolation at the cost
of a message boundary. Committing to only one closes a door: pure in-process makes untrusted or
generated apps impossible, pure iframe makes the built-in apps clumsy.

## Decision

Both, behind one SDK surface.

- **System apps** (Files, Photos, Search, Settings, …) are React components running in-process.
  They still call only SDK/kernel APIs — no back doors — so the SDK stays the single API.
- **Third-party and generated apps** run in `<iframe sandbox="allow-scripts">` without
  `allow-same-origin`, giving them an opaque origin and no access to the OS's storage or DOM.
  Every capability goes through postMessage RPC with a per-instance capability token.

There is deliberately no network capability at all.

## Consequences

- The SDK has two adapters (direct call, postMessage client) and one type definition.
- Deciding this now keeps the door open for LLM-generated apps in M5 without re-architecting,
  while committing to nothing about whether that milestone happens.
  _M4 note:_ that milestone does not happen — [ADR 14](./0014-no-text-generation.md) removed it —
  so this particular benefit never came due. The decision stands on the two reasons that were
  always load-bearing: a real permission boundary, and one readable file per app.
- One question is deferred to an M3 spike: `srcdoc` and `blob:` documents inherit the parent CSP,
  so the app runner is either a same-origin page loaded in a sandboxed iframe with app code
  delivered as `blob:` scripts, or a second Pages origin with its own policy.

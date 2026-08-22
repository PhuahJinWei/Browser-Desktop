# 11. Sandboxed apps are delivered as srcdoc, and the desktop's CSP allows the bootstrap by hash

Status: accepted (M3)

## Context

ADR 4 committed to running third-party apps in sandboxed iframes. It also flagged one unresolved
question — how the sandbox document and the app's code get into the frame without loosening the
desktop's own Content-Security-Policy. M3 had to answer it, and the answer took three attempts
because two reasonable-sounding assumptions turned out to be wrong.

## What was assumed, and what was measured

**Assumption 1: a document loaded from an https: URL does not inherit its embedder's CSP.**
True in general — inheritance applies to `about:blank`, `srcdoc:`, `blob:` and `data:` documents.
The plan therefore expected the sandbox page to carry its own, much stricter policy and leave the
desktop's alone.

What happened: the bootstrap inside the frame never ran. An identical frame _without_ the sandbox
attribute ran it fine. The difference is the opaque origin — CSP is inherited into it precisely so
that sandboxing cannot be used to escape a policy — so the desktop's `script-src 'self'` was also
being enforced inside the frame, and an inline script is not `'self'`.

**Fix: allow the bootstrap by hash.** `tools/build-app-runner.mjs` compiles the bootstrap, writes
its SHA-256 to `.app-runner-hash`, and the CSP plugin includes that digest in the desktop's
`script-src`. It permits exactly one script — change a byte and the digest changes with it —
rather than opening the desktop to inline script generally. `blob:` is also added, because app
code is delivered to the sandbox as a blob URL.

**Assumption 2: with the hash in place, loading the sandbox page by URL would work.**
It did not. Nor did a minimal probe page with no CSP of its own. In the tested environment, _any_
sandboxed frame pointing at a real same-origin URL failed to execute scripts, while the same
markup supplied through `srcdoc` executed. That held with the service worker's isolation headers
removed, so it is not a COOP/COEP interaction either.

The environment is Chromium 148 embedded in Electron. This may well behave differently in a
stock browser; the point is that it was **measured here** rather than assumed, and the design
should not depend on which way it goes.

## Decision

The sandbox document is fetched once and handed to each frame as `srcdoc`.

That is not a workaround so much as the stricter of the two options. A srcdoc frame:

- still has an **opaque origin** — no storage, no cookies, no reach into the host page;
- still carries **its own** CSP with `connect-src 'none'`, so it has no network;
- and **additionally** inherits the desktop's policy, so two policies must both allow anything it
  runs, rather than one.

## Consequences

- The desktop's `script-src` gains one hash and `blob:`. The hash is exact. `blob:` is a real
  widening — an XSS in the desktop could use a blob script — accepted because the app platform
  requires it and the desktop creates no script blobs of its own.
- The runner is a generated file (`public/app-runner.html`), built on `predev` and `prebuild` and
  not committed. If it is missing, the CSP plugin warns and apps will not start.
- Isolation was verified rather than asserted, from inside a sandboxed app: storage, cookies,
  IndexedDB, caches, OPFS, the parent document and the network are all refused, and
  `location.origin` is `null`. The results are in `docs/benchmarks/`.
- A future move to a second origin (a separate GitHub Pages site) would give each app a real
  origin and remove the CSP entanglement entirely. It is the cleaner end state and is not
  available on a single free Pages site, which is why it is not the answer today.

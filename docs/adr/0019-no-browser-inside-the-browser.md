# 19. No browser inside the browser; a Portfolio app instead

Status: accepted (M6). Records the reasoning behind an existing non-goal, because it is the
question this project gets asked most.

## Context

"It is a desktop — put a web browser in it." It is an obvious idea, it looks impressive in a
screenshot, and for a portfolio piece it has a genuine motive: a visitor could reach the author's
other work without leaving the demo.

The plan already listed browser-in-browser under non-goals. What it did not record was why, and a
non-goal without a reason is one someone re-litigates every few months.

## Decision

No in-page browser. A **Portfolio** app instead: a list of the author's other work, each entry
showing its destination host, opening in a real browser tab.

There are four reasons, and any one of them would be sufficient.

**It would break the claim the whole project rests on.** The desktop makes no network request after
boot, and proves it with a network panel that stays empty. An app that loads arbitrary origins
turns the headline property into "no network requests, except when you use the app whose entire
purpose is network requests."

**Cross-origin isolation blocks it.** The desktop runs under COOP and COEP so that
`crossOriginIsolated` is true, which is what threaded WASM depends on
([ADR 2](./0002-cross-origin-isolation-via-service-worker.md)). Under COEP, a cross-origin frame is
refused unless its own response opts in with a COEP header — and almost no site does, including
every site a visitor would actually type. (The CSP's `frame-src 'self' blob:` is merely this
project's own allowlist; it could be widened in a line. COEP is the wall.) The one way through is
Chromium's `<iframe credentialless>`, which loads the frame in a throwaway, cookie-less context:
Chromium-only, and always logged out. Dropping COEP instead would cost threads for the whole
desktop, which is not negotiable.

_Corrected after the fact:_ the first version of this record attributed the block to the CSP.
That was wrong in a way that mattered, because a CSP line is cheap to change and COEP is not.
The M7 plan for a YouTube **player** — one embed frame, via `credentialless` — is the exact
carve-out this paragraph leaves open, and the reason the general browser stays refused.

**It would not work anyway.** Most sites worth linking to — GitHub, Google, anything with a login —
refuse to be framed with `X-Frame-Options` or `frame-ancestors`. What could actually be built is not
"a browser" but "an iframe of the minority of sites that permit framing", which demos worse than a
list of links and is harder to explain.

**A list of links is the better product.** The visitor gets a real browser tab with a URL bar, their
own history, their own extensions and their own password manager, instead of a worse browser inside
a page.

The app fetches nothing — no favicons, no screenshots, no link previews, because every one of those
would be the request this decision exists to avoid. Each entry draws its own initial, states the
host it points at, and opens with `rel="noopener noreferrer"`.

## Consequences

- The demo gains a line worth saying out loud: open the Portfolio app, click a link, and watch the
  network panel stay empty while a new tab opens. The claim gets stronger by being tested in the one
  place it looks most likely to break.
- The links are data in `src/apps/links/links.ts`. Adding a project is one entry, not a code change.
- If an embedded view of _the author's own_ sites is ever wanted, it would be a different decision
  with a different shape — same-origin content, or an offline copy in the file system — and it would
  need its own record. This one rules out the general case.

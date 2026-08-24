# 20. One frame, and only the one you asked for

Status: accepted (M7). Supersedes the YouTube half of
[ADR 19](./0019-no-browser-inside-the-browser.md); the general browser stays refused.

## Context

Until now the privacy claim was absolute and therefore easy: **this page contacts exactly one
host, ever.** Nothing is easier to defend than nothing, and the Task Manager's empty network log
made the point without a paragraph of explanation.

The **Watch** app breaks that absolute. It shows a YouTube video in a window, which means a frame
loaded from `youtube-nocookie.com`, which means Google sees a request. The question this record
answers is not whether that is a cost — it is — but whether the exception can be defined tightly
enough that the claim gets _stronger_ by surviving it.

Two things made it worth asking. A desktop that plays video in a window is legible to a visitor in
two seconds, in a way that threaded WebAssembly never will be. And a privacy claim tested in the
place it looks most likely to break is worth more than one that is never tested at all.

## Decision

**One app, one frame, user-initiated, visible, and revocable.** The claim becomes:

> Nothing here talks to anyone — except the one thing you just asked for, and here it is in the
> network panel while you watch.

Five constraints, and the exception is only defensible with all five:

**It is user-initiated.** Nothing loads until a link is pasted. An app that fetched on open would
be making the request _for_ the user, which is the thing being ruled out, not an instance of it.

**It is announced while it is true.** A chip sits in the window's title bar naming the host for
exactly as long as a frame is loaded, and disappears on Stop or on close. It is driven by the
frame's existence rather than set beside it, so there is no path that leaves the badge behind — a
badge that outlives the connection is worse than no badge, because it teaches that the badge means
nothing.

**It is one frame, not a browser.** `frame-src` gains a single origin. A general browser stays
refused for all four of ADR 19's reasons, of which only the COEP one is technical.

**Nothing of Google's runs in this origin.** No `iframe_api` script, so `script-src` is unchanged.
Title and channel arrive over the embed's own `postMessage` protocol. And no thumbnails: each
would be a request to Google's image host fired the moment the app opened, before anyone had
chosen anything, which would break the first constraint on the way past.

**`connect-src` does not move.** This is the technical heart of it. The desktop still cannot talk
to YouTube; it can only _show a frame that does_. Our document makes exactly one request — the
embed page — and everything after that happens inside a frame, in a context that cannot reach back.

## How it is possible at all

Under COEP a cross-origin frame is refused unless its own response opts in, and YouTube's does not.
The way through is Chromium's `<iframe credentialless>`, which loads the frame in a throwaway,
cookie-less context. Dropping COEP instead was never on the table: it would cost threaded WASM for
the whole desktop to buy one window.

This was measured before the app was written, because if it had failed there was no fallback. The
spike is recorded in §13 of `plan v2.md`, with the harness kept at
`docs/spikes/m7-credentialless-embed.html`. The result that mattered was the control: a second
frame on the same page, identical but for the attribute, is **refused** — so the attribute is what
admits it, rather than the frame having been allowed all along.

**Measured in full.** An earlier draft of this record left one half open, because the two
environments available at the time each covered one half and neither covered both — one was
isolated but could not stream YouTube media at all, the other streamed but registered no service
worker. It has since been confirmed in a real Chrome with `crossOriginIsolated: true`: the
credentialless frame reached `PLAYING` with `currentTime` past zero, and the control frame — the
same frame minus the attribute — was refused. So the decision rests on a measurement rather than on
an inference, which is what §13 gated it on.

## Consequences

- **The one-host claim gains a named exception rather than an asterisk.** G3, D01, CLAUDE.md's
  host rule and the README all state it in the same words, and the app states it again in the
  window before the first video.
- **It is always logged out**, by construction of the frame — no account, no history, no
  recommendations. A limitation and a privacy property at once.
- **Chromium-only.** Firefox and Safari have not shipped credentialless frames. Elsewhere the app
  says which capability is missing and offers the outward link; Saved and Recent still work.
- **The network monitor sees the frame, not inside it.** Our document's one request appears in
  Resource Timing. The dozens the player then makes within the frame do not, and cannot. The
  monitor now says so in as many words, and says it whether or not a video is loaded: a caveat that
  appears only when it bites reads as an excuse, while one that is always there is a description of
  the instrument.
- **`Videos/Watched.md`** is an ordinary Markdown file, so the history is visible in Files,
  searchable with everything else, deletable like anything else, and carried by the setup export
  for free. There is no store to inspect because there is no store.
- **The consent lives in Settings**, not inside Watch: a permission you can only withdraw from the
  thing holding it is not really withdrawable.
- **If a second exception is ever proposed, it needs its own record.** This one is not a precedent
  for "third-party frames are fine now"; it is a decision about one app, and the five constraints
  above are what it cost.

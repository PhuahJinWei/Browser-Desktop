# 23. A default desktop: Watch and Portfolio are removed

Status: accepted (post-M7). Supersedes [ADR 20](./0020-one-frame-you-asked-for.md) entirely and
the Portfolio half of [ADR 19](./0019-no-browser-inside-the-browser.md); the refusal of a browser
inside the browser stands.

## Context

The desktop's scope is narrowing to what a fresh desktop ships with: a file system, a text editor,
a viewer, media players, search, settings and a task manager. Measured against that, two apps were
there for other reasons.

- **Watch** was a YouTube player. No fresh desktop has one, and it was the only thing that made the
  privacy claim conditional: a `frame-src` exception, a consent card, a live title-bar chip, a
  setting to withdraw consent, seventeen committed stills and a script that fetched them.
- **Portfolio** was a list of the author's other work. That is a page about the author, not a
  feature of a desktop, and it belongs in the README.

## Decision

Remove both, completely: the apps, their icons, the `watchConsent` setting, the window-chip
mechanism that existed only for Watch, the stills and `npm run sync:stills`, and YouTube's origin in
`frame-src`.

Sessions and setup files written before this still name `watch` and `links`. Restoring drops those
windows (`withKnownApps` in `src/kernel/apps.ts`) rather than opening empty frames; a stale
`watchConsent` key in stored settings is ignored.

## Consequences

- The one-host claim is absolute again, and the CSP enforces all of it: `frame-src 'self' blob:`
  and `connect-src` with no external host.
- The desktop loses its only way to show video it does not hold. Video plays files the user owns.
- ADR 20's reasoning about `credentialless` frames under COEP remains correct and is kept as a
  record; nothing in the build depends on it any more.

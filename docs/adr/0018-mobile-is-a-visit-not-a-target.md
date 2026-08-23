# 18. Mobile is a visit, not a target — and not a second repository

Status: accepted (M6). Makes concrete the "mobile is best-effort" line in the plan (D06).

## Context

A portfolio piece gets opened on a phone. Often the first time, often by someone deciding in ten
seconds whether to open it again on a laptop. So the question is not whether mobile matters; it is
what "supporting" it should mean for a project whose subject is window management and on-device
inference.

Three options were on the table: leave it as it was and accept a broken first impression, build a
phone-shaped layout in this repository, or build a separate mobile project.

## Decision

**Make it work, do not make it a phone OS, and do not fork the repository.**

Below 720 px — the width at which two half-snapped windows stop being usable at this text size —
the window manager stops pretending there is room to arrange anything: new windows open maximised.
Everything else about the window manager stays exactly where it was. The title bar, the taskbar,
the switcher and session restore all still work; only the tiling does not, because there is nothing
to tile.

The taskbar sheds words, never controls. The launcher and the command palette become their icons
and the running-window strip takes the space that frees up. Dropping a control instead would mean a
phone visitor cannot reach part of the desktop at all, which is a worse outcome than a cramped one.

On a coarse pointer, targets grow to 40 px, the six-pixel resize handles are removed rather than
left as an invisible way to fail, and desktop icons open on one tap ([ADR 16](./0016-one-click-selects-two-clicks-open.md)).

A dismissible notice states the compromise on arrival rather than letting the visitor discover it:
what changed, what still works, and that the local-only claim is not among the things that degrade.
The same notice covers a machine with no usable GPU, which is the other honest limited case.

**Pointer type and viewport width are two separate questions** and are asked separately. A
touchscreen laptop is coarse and wide; a desktop browser window dragged narrow is fine and small.
One "isMobile" flag would get both wrong.

**No second repository.** A phone-shaped build would duplicate the kernel, the file system, the
indexer and every app in order to present the one thing this project is not about — a single
full-screen surface — and it would double the maintenance of a codebase whose headline features
(overlapping windows, WebGPU inference on a real GPU) cannot be shown on the device it targeted.

## Consequences

- Mobile stays out of the definition of done for every milestone, as D06 already said. It is
  checked, not gated.
- The AI features remain memory-tight on phones. Nothing here changes that, and the notice does not
  pretend otherwise.
- The desktop's own compact threshold lives in the window manager and the CSS reads it from there,
  so the breakpoint cannot drift between the layout and the behaviour.

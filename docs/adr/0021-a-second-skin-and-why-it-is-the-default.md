# 21. A second skin, why it is an homage rather than a copy, and why it is the default

Status: accepted (post-M6). Records a decision that had been shipping for several commits without
a record — which is the failure this file also exists to correct.

## Context

The desktop had one design language: its own. Rounded corners, soft shadows, a teal accent, light
and dark themes. Good, and completely of 2026 — which is the problem for a portfolio piece whose
thesis is _"in 2026 a complete desktop is just static files"_. The sentence is about the machinery,
but nothing on screen said so. A visitor saw a competent modern web app and had to be _told_ that
the interesting part was underneath.

A second skin says it instead of claiming it. An old face on new machinery makes the contrast the
first thing you see: this looks like 1995 and it is doing threaded WebAssembly, content-addressed
storage and semantic search, from static files, offline.

## Decision

**Two skins on a fourth token axis, `data-skin`, beside theme, accent and wallpaper. Classic is the
default.**

Most of the desktop needed nothing. Every app already drew from `--surface-*`, `--radius-*` and
`--accent`, so squaring the corners and greying the palette carried all of them along — which was
the payoff for a token discipline that had until then only ever bought light and dark.

What tokens cannot express is a two-tone bevel: two light edges and two dark ones on one box is not
a colour a `border` can hold. Those are `inset box-shadow` tokens applied to the plain elements
every app already uses, so no app was rewritten to take part.

### Homage, not impersonation

This is the line, and it is worth stating precisely because the temptation runs one way.

**Reproduced:** the visual grammar. Bevel geometry, the sixteen-colour palette, square corners, the
navy title bar and its gradient, menu and dialog construction, scrollbars with arrow buttons at
both ends, tabs that join the panel below them, the shape and layout of a Start menu, caption
buttons at 16x14. None of this is anyone's property; it is how a generation of software was drawn,
and reproducing a design language is what an homage _is_.

**Not reproduced:** anything that identifies a vendor. No flag, no logo, no wordmark, no copied icon
bitmaps, no font file, no product name anywhere in the interface or the repository. The Start menu's
banner reads **Tabula**. The icons are original drawings of generic objects — a folder, a magnifier,
a sheet of paper — drawn in the period's idiom rather than traced from anyone's artwork (ADR 1).

Two words needed a decision of their own. **"Start"** on the launcher button is a common English
verb doing its ordinary job, and it stays. **"Windows"** does not appear, because it is a product
name and would be a claim about who made this.

The test used throughout: _would a reasonable person think this **is** that product, or that it is
**about** that product?_ Everything that fails the second half was left out, and the cost is
nothing — the look survives entirely, because what makes it recognisable was never the logo.

### Why the default, and not an opt-in

Because a skin nobody switches to is decoration. The contrast that justifies the work only lands if
it is the first thing a visitor sees, and Modern is one control away for anyone who prefers it. It
also forced the skin to be finished rather than merely present: several defects below were found
only because "the default has to work" is a much higher bar than "the alternative should look nice".

## Consequences

- **Two skins to keep working, forever.** Every new surface needs a classic block, and the check
  belongs beside the context-menu check in the quality bar.
- **Accessibility is not sacrificed to authenticity, and the departures are named.** Focus stays a
  visible dotted outline rather than the era's near-invisible one. The inactive title bar is
  `#6e6e6e` rather than the period's `#808080`, because at the original grey its text measured
  2.9:1 — the one pair in the palette that failed WCAG — and two shades darker reaches 5.1:1 while
  being indistinguishable unless the two are side by side. Disabled text is 2.8:1 and exempt.
- **Theme and accent are disabled under classic and say why.** 1995 had no dark mode, and
  pretending otherwise would look like neither thing.
- **A specificity lesson, recorded because it was expensive.** The first version scoped its rules as
  `[data-skin='classic'] button`, one class-worth more specific than the `.toggleOn` /
  `.segmentActive` / `.rowSelected` classes that carry a component's _state_. Since state is almost
  always a background or colour change, the skin repainted every one of them the same grey: toggles
  never looked on, selected rows looked unselected. The markup was correct throughout —
  `aria-checked` said the right thing — which is exactly why it survived a look at the chrome and
  had to be caught by reading computed styles. Skin-wide element rules are now wrapped in
  `:where()`, which contributes no specificity, so any component class outranks them.
- **Hover must lose to selection.** Fixing the above surfaced the same shape elsewhere: `.row:hover`
  is more specific than `.rowSelected`, so the pointer resting on a selected row repainted it as
  merely hovered. Eleven places, in both skins. Hover states are now written
  `:hover:not(.theSelectedClass)`.
- **Pixel art is a third icon set, in two sizes.** The line icons are the modern set; nothing tokens
  can do makes a 1.75px round-capped stroke look like 1995, because the artwork is the tell. The art
  is stored as text — one character per pixel — so it is reviewable in a diff, needs no image files
  and adds no host. 16 and 32 are drawn separately, because halving a bitmap throws away the pixel
  it was placed on.

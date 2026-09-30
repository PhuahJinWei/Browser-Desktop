# 22. One palette: light and dark are removed

Status: accepted (post-M7). Removes the `data-theme` axis introduced with the token system in M0.
Amends [ADR 17](./0017-customisation-is-a-file.md) (what a setup file carries) and the "fourth
axis" framing in [ADR 21](./0021-a-second-skin-and-why-it-is-the-default.md).

## Context

The desktop had four token axes: theme, accent, wallpaper and — added later — skin. Theme was
`system | light | dark`, resolved against `prefers-color-scheme` when set to `system`, and it was
the first axis the project ever had.

Two things had happened to it since.

**The default skin ignored it.** [ADR 21](./0021-a-second-skin-and-why-it-is-the-default.md) made
classic the default, and classic defines a complete palette of its own: one grey, one blue, no dark
mode, because 1995 did not have one. `:root[data-skin='classic']` sits below the dark blocks in
`tokens.css` and overrides every value they set, and `applySettings` guarded the browser chrome
tint on `settings.skin !== 'classic'` for the same reason. So the desktop a first-time visitor sees
had no dark mode already. The axis was live only for a visitor who had gone into Settings and
switched to Modern.

**It was the expensive axis.** Every colour had to be defined twice, every dark counterpart kept in
step with its light original by hand, and every text-on-surface pair measured for contrast in both.
Removing it took **178 lines out of `tokens.css`, including 92 custom-property declarations** —
more than a third of the file — with no other change to what the desktop can do.

Set against that: the skin axis says what the theme axis was there to say, and says it far more
loudly. "This desktop can look like a different desktop" is answered by a 1995 property sheet, not
by the same design at a different brightness.

## Decision

**There is one palette and it is light. `data-theme` is gone, along with `ThemePreference`,
`Settings.theme` and every `prefers-color-scheme` rule and listener in the project.**

- Settings loses the Theme control. Appearance now offers skin, pointers or accent, wallpaper, text
  size and motion.
- The command palette's _Toggle light and dark theme_ becomes _Switch between the modern and
  classic skin_ — the same keystroke on the appearance choice that is left.
- `color-scheme` is `light`, declared once in `tokens.css` and once in `index.html`, rather than
  resolved per render. Form controls, scrollbars and the default canvas stop following the OS.
- The sandbox protocol's `BootMessage` and `AppearanceMessage` lose their `theme` field, the runner
  stops writing `data-theme`, and the runner stylesheet loses its dark block. `SandboxedApp` no
  longer listens to `prefers-color-scheme`, because with one palette nothing outside the settings
  store can change how a frame should look.
- A setup file carries `skin` and `classicCursors` where it used to carry `theme`. It should have
  carried the skin since ADR 21 and did not; an old file's `theme` is dropped by the validator like
  any other unrecognised key.

## Consequences

- **A visitor whose system is set to dark gets a light desktop, and cannot change that.** This is
  the real cost and it is not softened by anything else here. It is accepted because the classic
  skin — the default, and what most visitors will see — never honoured that preference anyway, so
  for the common case this removes a control rather than an outcome.
- **Contrast is measured once.** Every foreground-on-surface pair in this project has one number
  now instead of two, which is one fewer place for a ratio to be checked in light and quietly fail
  in dark.
- **`prefers-reduced-motion` is untouched.** Motion is a separate axis and stays exactly as it was,
  including its `system` value. Dropping brightness is not a position on respecting system
  preferences in general.
- **The classic palette is now the only one with a second look.** Modern is light; classic is grey.
  Anything that wants to look different from the desktop around it does it through `data-skin`,
  which is one axis for a component to know about rather than two.
- **Reversible, and cheaply.** Unlike [ADR 15](./0015-no-on-demand-models.md), nothing was
  dismantled — the dark values were a block of hex in one file and are one `git show` away. What
  would have to be rebuilt is the plumbing: the setting, the resolved-`system` handling, the
  protocol field and the listener.

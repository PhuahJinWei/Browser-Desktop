# 16. One click selects a desktop icon; two clicks open it

Status: accepted (M6). Reverses a decision made in M1 and recorded only as a comment in
`src/shell/DesktopIcons.tsx`.

## Context

M1 opened desktop icons on a single click, and said why in the file:

> Activated by a single click, not a double click: this is a web page, and every other web page the
> user has ever used opens things on one click. Copying a desktop convention that fights the medium
> would be imitation for its own sake.

That was a reasonable argument for what the desktop was then: a launcher surface where the only
verb was "open". It stopped being reasonable the moment the icons gained the other verbs a desktop
icon has — select one, select several, drag them somewhere, right-click them, remove one.

Every one of those verbs needs a way to say **this one** without also saying **and go**. With a
single click bound to launch, there is no such gesture left. Selection would have to move to
modifier-clicks, drag would fight the click that fires on mouse-up, and the context menu would be
the only way to reach half the behaviour — which is the arrangement nobody has shipped, because it
does not work.

## Decision

On a fine pointer, a click selects and a double click opens. `Enter` opens the focused icon,
`Space` toggles its selection, arrow keys move between icons, and `Shift+F10` or the menu key
raises the context menu. The icons are a `listbox`, and each icon an `option` carrying its own
selected state, because that is what they now behave like.

**On a coarse pointer, a tap opens.** This is not a compromise: touch platforms universally open on
one tap, have no hover to preview with and no reliable double-tap that is not also a zoom gesture.
The pointer type decides, not the screen width, so a touchscreen laptop gets the touch behaviour on
a large display and a narrow desktop window keeps the mouse behaviour.

The launcher, the taskbar and the command palette are unaffected. Those are buttons, and a button
opens on one click everywhere, including here.

## Consequences

- The original comment's premise survives, narrowed: the web opens on one click, and the desktop
  still does everywhere the thing being clicked is a button rather than an icon.
- Discoverability costs something. A visitor who single-clicks and sees a highlight rather than a
  window has learned a convention rather than been given a result. The mitigation is that the
  highlight is unmistakable, and that everything on the desktop is also one click away in the
  taskbar's launcher — which is the surface a first-time visitor reaches for anyway.
- Selection is deliberately not persisted. It is a gesture, not a setting, and restoring a
  selection across a reload would imply an operation is pending when none is.

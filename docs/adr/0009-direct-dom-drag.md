# 9. Drag and resize write to the DOM directly, and restore React's styles afterwards

Status: accepted (M1)

## Context

Dragging a window through React state means one render of the whole desktop per pointer move.
Measured on the reference machine with fourteen windows open, a single desktop commit costs
**5.4 ms** — roughly a third of a 60 fps frame — and a drag produces one per frame, every frame,
alongside whatever else is running.

## Decision

During a drag or resize, pointer moves write `transform` (and, for a snapped window being pulled
loose, `width`/`height`) straight to the window element. React state is committed once, on
pointer-up.

Measured cost of that path with fourteen windows open: **0.01 ms median per pointer move**
(p95 0.02 ms, worst 0.12 ms), plus one 5.4 ms commit for the whole gesture.

## The part that is easy to get wrong

The first implementation cleared the inline styles on pointer-up:

```js
element.style.transform = '';
element.style.width = '';
element.style.height = '';
```

That looks like tidying up. It is data loss. React had set `width` and `height` through the style
prop; on the next render it diffs against the style object it rendered last time, sees the same
values, and skips re-applying them. The DOM keeps the cleared values, and the window collapses to
its CSS minimum — 200 px tall, whatever it was before.

The fix is to capture the inline styles at pointer-down and put exactly those back at pointer-up.
The DOM and React's model of it then agree, and the subsequent state commit updates them normally.

## Consequences

- Any code that mutates a property React also controls must restore it, not clear it. This is the
  general rule; the window frame is simply where it bit first.
- The dragged window's contents get `pointer-events: none` during the gesture, so a drag cannot be
  interrupted by whatever it passes over.
- Snap zones are evaluated during the move and previewed with a separate overlay element, which is
  ours alone and can therefore be mutated freely.

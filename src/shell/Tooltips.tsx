import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltips.module.css';

/**
 * The desktop's hover hints.
 *
 * One listener for the whole desktop, reading the `title` attribute that was already there. Nothing
 * had to be marked up for this: every control that already said what it was to the browser now says
 * it in the skin's own voice, and a control that gains a `title` tomorrow is covered the day it
 * does. The alternative — a `data-tip` attribute adopted control by control — is the same tooltip
 * plus a sweep of every file in the repo, and a permanent chance of the two drifting apart.
 *
 * **Why the attribute is taken away and put back.** A browser draws its own tooltip from `title`
 * and there is no way to ask it not to, so leaving it in place means two tooltips: ours, and the
 * operating system's grey one arriving underneath it a moment later. The attribute is therefore
 * removed while a hint is on screen and restored the moment it leaves — and only for the pointer.
 * Keyboard focus shows the hint *without* touching the attribute, because a native tooltip never
 * appears on focus and the accessible description must survive for anyone reading the page rather
 * than pointing at it. That asymmetry is the whole trick, and it is why this is safe.
 *
 * Focus support is a gain rather than parity: `title` has never shown on Tab, so a keyboard user
 * could not read these hints at all before.
 */

/**
 * Long enough that crossing a toolbar on the way somewhere else raises nothing, short enough that
 * stopping on a control still feels answered. The era's own tooltips waited about this long.
 */
const DELAY = 700;

/** Off the pointer's hotspot, down and right, where every desktop has put it. */
const OFFSET = { x: 14, y: 20 };

interface Tip {
  text: string;
  x: number;
  y: number;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  /** The element whose `title` we are holding, so it can always be given back. */
  const borrowed = useRef<{ element: HTMLElement; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * Where the pointer is *now*, rather than where it came in.
   *
   * The hint used to be placed at the coordinates of the `pointerover` that started the countdown —
   * the moment the pointer crossed the control's edge. Enter a wide button at its left rim, settle
   * on the far side, and the hint appeared back at the rim: near the control, but plainly not under
   * the cursor it was answering. Reading the live position when the timer fires puts it where the
   * pointer actually came to rest.
   */
  const pointer = useRef({ x: 0, y: 0 });

  const restore = useCallback(() => {
    const held = borrowed.current;
    if (held) held.element.setAttribute('title', held.text);
    borrowed.current = null;
  }, []);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    restore();
    setTip((current) => (current === null ? current : null));
  }, [restore]);

  useEffect(() => {
    const target = (node: EventTarget | null): HTMLElement | null => {
      if (!(node instanceof Element)) return null;
      // Never annotate our own tooltip, and never a sandboxed app's frame — a frame's contents
      // belong to that document and its own browser draws for them.
      if (node.closest(`.${styles.tip}`) || node.tagName === 'IFRAME') return null;
      const owner = node.closest<HTMLElement>('[title]');
      return owner?.getAttribute('title')?.trim() ? owner : null;
    };

    const onPointerOver = (event: PointerEvent) => {
      const element = target(event.target);
      if (!element) return;
      if (borrowed.current?.element === element) return;
      hide();

      const text = element.getAttribute('title') ?? '';
      // Taken now rather than when the timer fires: the browser starts its own countdown the moment
      // the pointer settles, and it wins the race if the attribute is still there at that point.
      element.removeAttribute('title');
      borrowed.current = { element, text };

      pointer.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(
        () => setTip({ text, x: pointer.current.x, y: pointer.current.y }),
        DELAY,
      );
    };

    const onFocusIn = (event: FocusEvent) => {
      const element = target(event.target);
      // `:focus-visible` keeps this to keyboard focus: a click focuses too, and a hint that appears
      // under the pointer you just clicked with is in the way rather than helpful.
      if (!element || !element.matches(':focus-visible')) return;
      hide();
      const box = element.getBoundingClientRect();
      const text = element.getAttribute('title') ?? '';
      // No borrowing here. Nothing native fires on focus, so the attribute stays put and the
      // element keeps its accessible description.
      timer.current = setTimeout(
        () => setTip({ text, x: box.left + box.width / 2 - OFFSET.x, y: box.bottom - OFFSET.y }),
        DELAY,
      );
    };

    const onPointerOut = (event: PointerEvent) => {
      const held = borrowed.current;
      if (!held) return hide();
      // Moving within the same control is not leaving it.
      const to = event.relatedTarget;
      if (to instanceof Node && held.element.contains(to)) return;
      hide();
    };

    // Cheap enough to run unconditionally: it writes two numbers and never touches React. Once a
    // hint is on screen this stops mattering — a tooltip of this era is placed once and stays put
    // rather than trailing the cursor around.
    const onPointerMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };

    globalThis.addEventListener('pointermove', onPointerMove, { passive: true });
    globalThis.addEventListener('pointerover', onPointerOver);
    globalThis.addEventListener('pointerout', onPointerOut);
    globalThis.addEventListener('focusin', onFocusIn);
    globalThis.addEventListener('focusout', hide);
    // Anything that means the user is acting rather than reading takes the hint away.
    globalThis.addEventListener('pointerdown', hide, true);
    globalThis.addEventListener('keydown', hide, true);
    globalThis.addEventListener('wheel', hide, { passive: true });
    globalThis.addEventListener('blur', hide);

    return () => {
      globalThis.removeEventListener('pointermove', onPointerMove);
      globalThis.removeEventListener('pointerover', onPointerOver);
      globalThis.removeEventListener('pointerout', onPointerOut);
      globalThis.removeEventListener('focusin', onFocusIn);
      globalThis.removeEventListener('focusout', hide);
      globalThis.removeEventListener('pointerdown', hide, true);
      globalThis.removeEventListener('keydown', hide, true);
      globalThis.removeEventListener('wheel', hide);
      globalThis.removeEventListener('blur', hide);
      // A desktop that unmounts mid-hover must not take a control's description with it.
      restore();
    };
  }, [hide, restore]);

  /* Keep it on screen. Measured before paint, so the corrected position is the only one seen. */
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !tip) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 6;
    const x = Math.max(
      margin,
      Math.min(tip.x + OFFSET.x, globalThis.innerWidth - width - margin),
    );
    // Above the pointer rather than below it when there is no room, which is what runs out first.
    const below = tip.y + OFFSET.y;
    const y = below + height > globalThis.innerHeight - margin ? tip.y - height - 8 : below;
    element.style.left = `${Math.round(x)}px`;
    element.style.top = `${Math.round(Math.max(margin, y))}px`;
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    // aria-hidden: this is a drawing of something the element already says. Removing the `title`
    // for the pointer does not change that, because a reader is not the one hovering.
    <div ref={ref} className={styles.tip} role="tooltip" aria-hidden>
      {tip.text}
    </div>,
    document.body,
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fixed-height list windowing.
 *
 * Importing a thousand files is a stated M1 target, and a thousand DOM rows makes scrolling
 * stutter and every re-render expensive. This renders only what is visible plus a small overscan,
 * which keeps the row count constant no matter how large the directory is.
 *
 * Fixed row height on purpose: it makes the mapping from scroll offset to index arithmetic rather
 * than measurement, which is what keeps it cheap.
 */

export interface VirtualWindow {
  /** Attach to the scrolling element. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** Total height of the scrollable content. */
  totalHeight: number;
  /** Index of the first rendered item. */
  startIndex: number;
  /** Items to render this frame. */
  visibleCount: number;
  /** Vertical offset for the rendered block. */
  offsetY: number;
  /** Scrolls an item into view; used by keyboard navigation. */
  scrollToIndex: (index: number) => void;
}

export function useVirtualList(itemCount: number, rowHeight: number, overscan = 6): VirtualWindow {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onScroll = () => setScrollTop(element.scrollTop);
    element.addEventListener('scroll', onScroll, { passive: true });

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(element);
    setViewportHeight(element.clientHeight);

    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.min(
    itemCount - startIndex,
    Math.ceil(viewportHeight / rowHeight) + overscan * 2,
  );

  const scrollToIndex = useCallback(
    (index: number) => {
      const element = ref.current;
      if (!element) return;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
      }
    },
    [rowHeight],
  );

  return {
    ref,
    totalHeight: itemCount * rowHeight,
    startIndex,
    visibleCount: Math.max(0, visibleCount),
    offsetY: startIndex * rowHeight,
    scrollToIndex,
  };
}

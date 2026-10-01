import { useId, type ReactNode } from 'react';
import type { IconName } from './Icon';

/**
 * The modern skin's app icons, in colour.
 *
 * The line icons in `Icon.tsx` are right for chrome — a toolbar, a tray, a menu row — and wrong for
 * the one place an app is represented by its picture: the desktop, the taskbar and the Start menu.
 * A current desktop draws apps as small coloured objects, and a row of identical blue outlines read
 * as a web app's navigation rather than as programs.
 *
 * Original drawings of generic objects, as the pixel set is (ADR 1, ADR 21): a folder, a monitor, a
 * palette. Flat shapes with a single gradient each, on a 32-unit grid, so they stay legible from 16px
 * in a title bar to 48px on the desktop. Only apps are drawn here; everything else keeps its line
 * icon, which is also what a current desktop does with tray and toolbar glyphs.
 */

type Draw = (id: (name: string) => string) => ReactNode;

/** A vertical gradient, which is all the lighting any of these use. */
function gradient(id: string, top: string, bottom: string) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={top} />
      <stop offset="1" stopColor={bottom} />
    </linearGradient>
  );
}

const DRAWINGS: Partial<Record<IconName, Draw>> = {
  folder: (id) => (
    <>
      <defs>
        {gradient(id('back'), '#e9a72a', '#d48a12')}
        {gradient(id('front'), '#ffd866', '#f6b928')}
      </defs>
      <path
        d="M3 8.5A2.5 2.5 0 0 1 5.5 6h6.4l2.6 2.6h12A2.5 2.5 0 0 1 29 11.1V24a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24Z"
        fill={`url(#${id('back')})`}
      />
      <path
        d="M3 13a2.5 2.5 0 0 1 2.5-2.5h21A2.5 2.5 0 0 1 29 13v11a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 24Z"
        fill={`url(#${id('front')})`}
      />
    </>
  ),

  computer: (id) => (
    <>
      <defs>{gradient(id('screen'), '#4cb3ff', '#1767d2')}</defs>
      <rect x="3.5" y="5" width="25" height="17.5" rx="2.2" fill="#2c3646" />
      <rect x="5.3" y="6.8" width="21.4" height="13.9" rx="1" fill={`url(#${id('screen')})`} />
      <path d="M13 22.5h6l.8 3.5h-7.6Z" fill="#8d97a5" />
      <rect x="9.5" y="25.6" width="13" height="2.2" rx="1.1" fill="#6c7786" />
    </>
  ),

  trash: (id) => (
    <>
      <defs>{gradient(id('can'), '#eef3f8', '#b8c4d1')}</defs>
      <path
        d="M7.5 10.5h17l-1.5 15.6a2.4 2.4 0 0 1-2.4 2.2h-9.2a2.4 2.4 0 0 1-2.4-2.2Z"
        fill={`url(#${id('can')})`}
        stroke="#8592a2"
        strokeWidth="1"
      />
      <rect x="5.5" y="7" width="21" height="3.6" rx="1.8" fill="#8592a2" />
      <path d="M13.5 5.2h5" stroke="#8592a2" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M12.6 14v10.6M16 14v10.6M19.4 14v10.6"
        stroke="#8592a2"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  ),

  note: (id) => (
    <>
      <defs>{gradient(id('band'), '#4d9cf0', '#2c74d4')}</defs>
      <rect
        x="6"
        y="4"
        width="20"
        height="24.5"
        rx="2.5"
        fill="#ffffff"
        stroke="#a6b6c8"
        strokeWidth="1"
      />
      <path
        d="M6 6.5A2.5 2.5 0 0 1 8.5 4h15A2.5 2.5 0 0 1 26 6.5V10H6Z"
        fill={`url(#${id('band')})`}
      />
      <path
        d="M10 14.5h12M10 18.5h12M10 22.5h8"
        stroke="#8fa6bf"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  ),

  paint: (id) => (
    <>
      <defs>{gradient(id('board'), '#fbe7cc', '#e7bf8c')}</defs>
      <path
        d="M16 4.5C8.5 4.5 3.5 9.6 3.5 15.8c0 6.4 5 11.7 11.6 11.7 2.2 0 3-1.3 2.4-3-.6-1.6.4-3.1 2.2-3.1h3.6c3.5 0 5.2-2.4 5.2-5.6C28.5 9.4 23 4.5 16 4.5Zm-5.5 17.8a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
        fill={`url(#${id('board')})`}
        fillRule="evenodd"
        stroke="#c79a62"
        strokeWidth="0.8"
      />
      <circle cx="9.5" cy="13" r="2.1" fill="#e5484d" />
      <circle cx="14.2" cy="9.4" r="2.1" fill="#f5b400" />
      <circle cx="19.8" cy="9.6" r="2.1" fill="#2f7fea" />
      <circle cx="23.6" cy="13.8" r="2.1" fill="#2ea043" />
    </>
  ),

  image: (id) => (
    <>
      <defs>{gradient(id('sky'), '#7fcbff', '#3a8ff0')}</defs>
      <rect x="3.5" y="5.5" width="25" height="21" rx="3" fill={`url(#${id('sky')})`} />
      <circle cx="11" cy="12" r="2.6" fill="#ffe27a" />
      <path
        d="M3.5 22.5 11 15l5 5 3.8-3.8 8.7 8.6v.2a3 3 0 0 1-3 3h-19a3 3 0 0 1-3-3Z"
        fill="#2f9e5c"
      />
    </>
  ),

  music: (id) => (
    <>
      <defs>{gradient(id('tile'), '#ffa24a', '#ef5f2c')}</defs>
      <rect x="4" y="4" width="24" height="24" rx="6" fill={`url(#${id('tile')})`} />
      <path
        d="M20.5 8.6v11.3a3.1 3.1 0 1 1-1.8-2.8v-5.8l-6.4 1.5v7.4a3.1 3.1 0 1 1-1.8-2.8v-6.9Z"
        fill="#ffffff"
      />
    </>
  ),

  video: (id) => (
    <>
      <defs>{gradient(id('tile'), '#a07cff', '#6a3fe6')}</defs>
      <rect x="3.5" y="6.5" width="25" height="19" rx="3.5" fill={`url(#${id('tile')})`} />
      <path d="M13.6 11.6v8.8l7.4-4.4Z" fill="#ffffff" />
    </>
  ),

  settings: (id) => (
    <>
      <defs>{gradient(id('gear'), '#9eabba', '#5d6979')}</defs>
      {/* The teeth are the dashes of a thick circle's stroke: eight of them, evenly, with no path maths. */}
      <circle
        cx="16"
        cy="16"
        r="10.2"
        fill="none"
        stroke="#5d6979"
        strokeWidth="4.4"
        strokeDasharray="4 4.01"
      />
      <circle cx="16" cy="16" r="9" fill={`url(#${id('gear')})`} />
      <circle cx="16" cy="16" r="3.6" fill="#ffffff" />
    </>
  ),

  gauge: () => (
    <>
      <rect x="3.5" y="5.5" width="25" height="21" rx="3" fill="#22324a" />
      <path d="M7 21.5h18" stroke="#3b4e69" strokeWidth="1" />
      <path
        d="M7 19l4.2-5 3.8 3 5-8 5 6.5"
        fill="none"
        stroke="#42e08b"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),

  apps: (id) => (
    <>
      <defs>{gradient(id('tile'), '#41cfc6', '#1a8c9c')}</defs>
      <rect x="4" y="4" width="24" height="24" rx="6" fill={`url(#${id('tile')})`} />
      <rect
        x="9"
        y="10"
        width="14"
        height="12"
        rx="1.8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
      />
      <path d="M9 13.6h14" stroke="#ffffff" strokeWidth="1.8" />
    </>
  ),

  file: () => (
    <>
      <path
        d="M8 3.5h10.5L25 10v17a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 27V5A1.5 1.5 0 0 1 8.5 3.5Z"
        fill="#ffffff"
        stroke="#9aa9ba"
        strokeWidth="1"
      />
      <path
        d="M18.5 3.5V10H25"
        fill="#e3e9f0"
        stroke="#9aa9ba"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </>
  ),

  'file-text': () => (
    <>
      <path
        d="M8 3.5h10.5L25 10v17a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 27V5A1.5 1.5 0 0 1 8.5 3.5Z"
        fill="#ffffff"
        stroke="#9aa9ba"
        strokeWidth="1"
      />
      <path
        d="M18.5 3.5V10H25"
        fill="#e3e9f0"
        stroke="#9aa9ba"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="M11 15h10M11 19h10M11 23h6"
        stroke="#4d8fdc"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
};

export function hasColorIcon(name: IconName): boolean {
  return name in DRAWINGS;
}

export function ColorIcon({
  name,
  size,
  className,
}: {
  name: IconName;
  size: number;
  className?: string | undefined;
}) {
  // Gradient ids must be unique per instance, or every icon on the page paints with whichever
  // definition the document saw first. React's ids carry characters a url() fragment rejects.
  const base = `ci-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const draw = DRAWINGS[name];
  if (!draw) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {draw((part) => `${base}-${part}`)}
    </svg>
  );
}

/**
 * The launcher's mark. Deliberately not four panes: the button is the way into this desktop, and its
 * picture is this desktop's own — a tile with a T — rather than a vendor's (ADR 21).
 */
export function TabulaMark({ size }: { size: number }) {
  const base = `tm-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>{gradient(base, '#3ea2ff', '#0a5fd0')}</defs>
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill={`url(#${base})`} />
      <path d="M7 7.2h10v2.9h-3.5v7.7h-3V10.1H7Z" fill="#ffffff" />
    </svg>
  );
}

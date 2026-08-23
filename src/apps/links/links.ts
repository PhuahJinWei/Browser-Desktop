/**
 * The portfolio list.
 *
 * **This is the file to edit.** Add an entry per project and it appears on the desktop; nothing
 * else needs changing. Keep the URLs to things that are actually live — a portfolio with a dead
 * link in it is worse than a shorter portfolio.
 *
 * There is no favicon, screenshot or preview fetched from any of these sites, and there never can
 * be: the desktop's claim is that it makes no network request after boot, and a thumbnail would be
 * a request. Each entry draws its own initial instead.
 */

export interface PortfolioLink {
  id: string;
  name: string;
  url: string;
  /** One sentence. What it is, not how proud you are of it. */
  blurb: string;
  kind: 'project' | 'source' | 'profile';
  /** Optional, shown as a quiet tag: the stack, the year, whatever is worth knowing at a glance. */
  tag?: string;
}

export const PORTFOLIO_LINKS: PortfolioLink[] = [
  {
    id: 'tabula',
    name: 'Tabula',
    url: 'https://phuahjinwei.github.io/Browser-Desktop/',
    blurb: 'This desktop, live — the deployed build of the page you are reading it on.',
    kind: 'project',
    tag: 'TypeScript · WebGPU · OPFS',
  },
  {
    id: 'tabula-source',
    name: 'Browser-Desktop on GitHub',
    url: 'https://github.com/PhuahJinWei/Browser-Desktop',
    blurb: 'The source, the architecture notes and every decision record behind this desktop.',
    kind: 'source',
    tag: 'Source',
  },
  {
    id: 'github',
    name: 'GitHub profile',
    url: 'https://github.com/PhuahJinWei',
    blurb: 'Everything else I have published.',
    kind: 'profile',
  },
];

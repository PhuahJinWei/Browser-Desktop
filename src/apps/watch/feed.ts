/**
 * The homepage.
 *
 * Watch used to open onto an empty paste box: honest, and completely lifeless. This is a front
 * page for it — and it is a fixed list compiled into the build, not a feed in the sense that word
 * usually means. Nothing here is fetched, ranked, personalised or refreshed, because ADR 20's
 * first constraint is that nothing loads until the user asks for it. Browsing this page makes
 * exactly as many network requests as staring at the wallpaper does: none. The first request
 * happens on the click that starts a film, and the title bar says so for as long as it lasts.
 *
 * That is why the page is worth having rather than merely pretty. An empty box asks the visitor to
 * take the privacy claim on faith; a page full of things to click, with the network panel still at
 * zero, hands them the evidence and lets them find the moment it changes.
 *
 * Every entry is a short film from the Blender Foundation's own channels. That is not decoration
 * either — they are openly licensed, which is what makes featuring them defensible in the first
 * place, and they are far less likely than an ordinary video to be deleted or to have embedding
 * switched off underneath us.
 *
 * The metadata is real. Titles and channel names came from YouTube's oEmbed endpoint and the
 * durations and dates from each video's own page, rather than being written to look plausible.
 * There are deliberately no view counts and no star ratings: this desktop cannot know them, and a
 * number invented to make a grid look busy would be a lie about somebody else's work.
 *
 * There are no thumbnails either, which ADR 20 rules out by name — each one would be a request to
 * Google's image host fired the moment the window opened, before anybody had chosen anything. The
 * posters are drawn from the video id instead, so they cost no bytes and claim nothing.
 */

export interface FeedFilm {
  /** The YouTube id. Every one was checked against the oEmbed endpoint when this list was built. */
  id: string;
  /** Exactly as the channel titles it, not a tidier name invented here. */
  title: string;
  channel: string;
  seconds: number;
  year: number;
}

/** Newest first, which is a rule rather than a running judgement about which films are best. */
export const FEED: readonly FeedFilm[] = [
  {
    id: 'l5OZu-IrXpw',
    title: 'SINGULARITY - Painterly Space Adventure',
    channel: 'Blender Studio',
    seconds: 391,
    year: 2026,
  },
  {
    id: 'u9lj-c29dxI',
    title: 'WING IT! - Blender Open Movie',
    channel: 'Blender Studio',
    seconds: 238,
    year: 2023,
  },
  {
    id: 'UXqq0ZvbOnk',
    title: 'CHARGE - Blender Open Movie',
    channel: 'Blender Studio',
    seconds: 263,
    year: 2022,
  },
  {
    id: '_cMxraX_5RE',
    title: 'Sprite Fright - Blender Open Movie',
    channel: 'Blender Studio',
    seconds: 630,
    year: 2021,
  },
  {
    id: 'PVGeM40dABA',
    title: 'Coffee Run - Blender Open Movie',
    channel: 'Blender Studio',
    seconds: 185,
    year: 2020,
  },
  {
    id: 'WhWc3b3KhnY',
    title: 'Spring - Blender Open Movie',
    channel: 'Blender Studio',
    seconds: 464,
    year: 2019,
  },
  {
    id: 'pKmSdY56VtY',
    title: 'HERO – Blender Grease Pencil Showcase',
    channel: 'Blender',
    seconds: 237,
    year: 2018,
  },
  {
    id: 'apiu3pTIwuY',
    title: 'The Daily Dweebs - 8K UHD Stereoscopic 3D',
    channel: 'Blender Studio',
    seconds: 60,
    year: 2018,
  },
  {
    id: 'mN0zPOpADL4',
    title: 'Agent 327: Operation Barbershop',
    channel: 'Blender Studio',
    seconds: 232,
    year: 2017,
  },
  {
    id: 'SkVqJ1SGeL0',
    title: 'Caminandes 3: Llamigos',
    channel: 'Blender',
    seconds: 150,
    year: 2016,
  },
  {
    id: 'lqiN98z6Dak',
    title: 'Glass Half - Blender animated cartoon',
    channel: 'Blender',
    seconds: 193,
    year: 2015,
  },
  {
    id: 'Y-rmzh0PI3c',
    title: 'Cosmos Laundromat - First Cycle',
    channel: 'Blender',
    seconds: 731,
    year: 2015,
  },
  {
    id: 'Z4C82eyhwgU',
    title: 'Caminandes 2: Gran Dillama',
    channel: 'Blender',
    seconds: 146,
    year: 2013,
  },
  {
    id: 'R6MlUcmOul8',
    title: 'Tears of Steel - Blender VFX Open Movie',
    channel: 'Blender',
    seconds: 734,
    year: 2012,
  },
  {
    id: 'eRsGyueVLvQ',
    title: 'Sintel - Open Movie by Blender Foundation',
    channel: 'Blender',
    seconds: 888,
    year: 2010,
  },
  { id: 'TLkA0RELQ1g', title: 'Elephants Dream', channel: 'Blender', seconds: 654, year: 2009 },
  { id: 'YE7VzlLtp-4', title: 'Big Buck Bunny', channel: 'Blender', seconds: 597, year: 2008 },
];

/** `m:ss`, or `h:mm:ss` for anything long enough to need it. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * A poster, derived from the id rather than downloaded.
 *
 * Deterministic so a film keeps the same colours between sessions and looks like an identity
 * rather than a lottery. It is plainly a generated graphic and not a frame from the film, which is
 * the honest way to fill the space when fetching the real still is the one thing we will not do.
 */
export function posterHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 100_000;
  return hash % 360;
}

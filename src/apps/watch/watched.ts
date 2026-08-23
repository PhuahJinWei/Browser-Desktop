/**
 * Watch's memory, which is an ordinary Markdown file.
 *
 * `Videos/Watched.md` holds two lists. It is not a database and not `localStorage`: because it is
 * a file, it shows up in Files, it is searchable by meaning along with everything else ("that talk
 * about Rust" finds the title), it can be deleted like anything else, and the setup export carries
 * it for free. The app is a view over a file, which is the rule everywhere else in this desktop.
 *
 * The format is chosen to survive a human editing it in Notes. Parsing is deliberately lenient —
 * an unreadable line is skipped rather than throwing away the rest of the file — and anything
 * outside the two headed sections is preserved on write, so a note someone typed at the top of
 * their own file is not silently eaten by the next save.
 */

export interface WatchedEntry {
  /** The YouTube video id. The one field that must be right. */
  id: string;
  title: string;
  channel: string;
  /** ISO date, `YYYY-MM-DD`. Absolute rather than "2 days ago": the file outlives the session. */
  at: string;
}

export interface Watched {
  saved: WatchedEntry[];
  recent: WatchedEntry[];
  /** Anything above the first section heading, kept verbatim so a user's own note survives. */
  preamble: string;
}

/** How many Recent rows to keep. Enough to find yesterday's video, short enough to stay readable. */
export const RECENT_LIMIT = 30;

const ID = /^[A-Za-z0-9_-]{11}$/;

export interface ParsedLink {
  videoId: string;
  /** Present when a playlist was pasted; the player's own next/previous then work. */
  listId?: string;
}

/**
 * Reads a video id out of whatever was pasted.
 *
 * Accepts the three URL shapes YouTube hands out plus a bare id, because people paste all four.
 * Everything else is rejected rather than guessed at: a wrong id loads someone else's video, which
 * is worse than saying "that does not look like a YouTube link".
 */
export function parseLink(input: string): ParsedLink | null {
  const text = input.trim();
  if (!text) return null;

  if (ID.test(text)) return { videoId: text };

  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.replace(/^\/+/, '');
  let videoId: string | null = null;

  if (host === 'youtu.be') {
    videoId = path.split('/')[0] ?? null;
  } else if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    if (path === 'watch') videoId = url.searchParams.get('v');
    else if (path.startsWith('embed/')) videoId = path.slice('embed/'.length).split('/')[0] ?? null;
    else if (path.startsWith('shorts/'))
      videoId = path.slice('shorts/'.length).split('/')[0] ?? null;
    else if (path.startsWith('live/')) videoId = path.slice('live/'.length).split('/')[0] ?? null;
  }

  if (!videoId || !ID.test(videoId)) return null;

  const listId = url.searchParams.get('list');
  // A "watch later"-style pseudo-list is not addressable by anyone else, so it is dropped rather
  // than passed to a player that would fail on it.
  return listId && /^[A-Za-z0-9_-]{2,64}$/.test(listId) && listId !== 'WL'
    ? { videoId, listId }
    : { videoId };
}

/** The canonical outward link. Not the nocookie host: this is the one a person would share. */
export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/* -------------------------------------------------------------------------------------------- */
/* The file                                                                                       */
/* -------------------------------------------------------------------------------------------- */

const SAVED_HEADING = '## Saved';
const RECENT_HEADING = '## Recent';

/**
 * `- [Title](url) — Channel · 2026-08-24`
 *
 * The id comes from the link rather than from a field of its own, so the line reads as ordinary
 * Markdown and a person editing the title cannot break the reference.
 */
const LINE = /^\s*[-*]\s+\[(.*)\]\(([^)]+)\)\s*(?:—|-)?\s*(.*?)\s*(?:·\s*(\d{4}-\d{2}-\d{2}))?\s*$/;

function parseLine(line: string): WatchedEntry | null {
  const match = LINE.exec(line);
  if (!match) return null;
  const [, rawTitle = '', href = '', rawChannel = '', at = ''] = match;
  const link = parseLink(href);
  if (!link) return null;
  return {
    id: link.videoId,
    title: rawTitle.trim() || link.videoId,
    channel: rawChannel.trim(),
    at,
  };
}

function formatLine(entry: WatchedEntry): string {
  // Brackets in a title would end the link text early, so they are the one thing escaped.
  const title = entry.title.replace(/[[\]]/g, '').trim() || entry.id;
  const tail = [entry.channel.trim(), entry.at].filter(Boolean).join(' · ');
  return `- [${title}](${watchUrl(entry.id)})${tail ? ` — ${tail}` : ''}`;
}

export function parseWatched(markdown: string): Watched {
  const lines = markdown.split(/\r?\n/);
  const saved: WatchedEntry[] = [];
  const recent: WatchedEntry[] = [];
  const preamble: string[] = [];
  let section: 'none' | 'saved' | 'recent' = 'none';

  for (const line of lines) {
    const heading = line.trim().toLowerCase();
    if (heading === SAVED_HEADING.toLowerCase()) {
      section = 'saved';
      continue;
    }
    if (heading === RECENT_HEADING.toLowerCase()) {
      section = 'recent';
      continue;
    }
    // A different heading ends the list without starting a new one, so unrelated sections of a
    // hand-written file do not get read as videos.
    if (/^#{1,6}\s/.test(line.trim())) {
      if (section === 'none') preamble.push(line);
      section = 'none';
      continue;
    }
    if (section === 'none') {
      preamble.push(line);
      continue;
    }
    const entry = parseLine(line);
    if (!entry) continue;
    const into = section === 'saved' ? saved : recent;
    // The file is the source of truth and a human may have duplicated a line; first wins.
    if (!into.some((existing) => existing.id === entry.id)) into.push(entry);
  }

  return { saved, recent, preamble: preamble.join('\n').trim() };
}

export function serialiseWatched(watched: Watched): string {
  const parts: string[] = [];
  if (watched.preamble.trim()) parts.push(watched.preamble.trim(), '');
  parts.push(
    SAVED_HEADING,
    '',
    ...(watched.saved.length ? watched.saved.map(formatLine) : ['_Nothing saved yet._']),
    '',
    RECENT_HEADING,
    '',
    ...(watched.recent.length ? watched.recent.map(formatLine) : ['_Nothing watched yet._']),
    '',
  );
  return parts.join('\n');
}

/** A fresh file, with the header a reader deserves if they open it in Notes before Watch. */
export function emptyWatched(): Watched {
  return {
    saved: [],
    recent: [],
    preamble:
      '# Watched\n\nWritten by the Watch app. An ordinary Markdown file: edit it, search it, or\n' +
      'delete it. Each line links to the video it stands for.',
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Operations                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/** Newest first, one entry per video, capped. Watching something again moves it up. */
export function remember(watched: Watched, entry: WatchedEntry): Watched {
  const recent = [entry, ...watched.recent.filter((existing) => existing.id !== entry.id)].slice(
    0,
    RECENT_LIMIT,
  );
  // A saved entry keeps its own row, but takes any better title the player has since reported.
  const saved = watched.saved.map((existing) =>
    existing.id === entry.id
      ? { ...existing, title: entry.title, channel: entry.channel }
      : existing,
  );
  return { ...watched, recent, saved };
}

export function save(watched: Watched, entry: WatchedEntry): Watched {
  if (watched.saved.some((existing) => existing.id === entry.id)) return watched;
  return { ...watched, saved: [entry, ...watched.saved] };
}

export function unsave(watched: Watched, id: string): Watched {
  return { ...watched, saved: watched.saved.filter((entry) => entry.id !== id) };
}

export function forget(watched: Watched, id: string): Watched {
  return { ...watched, recent: watched.recent.filter((entry) => entry.id !== id) };
}

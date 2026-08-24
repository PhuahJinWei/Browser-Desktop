/**
 * The homepage stills, as build assets.
 *
 * Committed files rather than anything fetched at runtime, which is the entire distinction ADR 20
 * turns on: a hotlinked thumbnail contacts Google's image host the moment the window opens, before
 * anyone has chosen a thing, while a file in the build contacts nobody. The images are written by
 * `npm run sync:stills`, by hand, on a developer's machine — see `tools/fetch-watch-stills.mjs`.
 *
 * Vite resolves the glob at build time, so each still gets a hashed, base-path-correct URL and any
 * film without one simply has no entry. That is the fallback rather than an error: the card falls
 * back to the drawn poster, so adding a film to the feed and forgetting its still costs a plain
 * tile instead of a broken image.
 */
const FILES = import.meta.glob('./stills/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const BY_ID = new Map(
  Object.entries(FILES).map(([file, url]) => [
    file.replace(/^.*[/]/, '').replace(/[.]webp$/, ''),
    url,
  ]),
);

/** The still for a film, or null when none has been fetched for it yet. */
export function stillFor(id: string): string | null {
  return BY_ID.get(id) ?? null;
}

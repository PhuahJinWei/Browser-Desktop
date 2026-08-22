import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { launchApp } from '../../kernel/apps';
import { vfs } from '../../kernel/vfs/client';
import {
  search,
  searchPhotos,
  useIndexStats,
  useIndexerState,
  warmUpModel,
  type ImageHit,
} from '../../services/index/client';
import type { SearchHit } from '../../services/index/client';
import { thumbnailUrl } from '../../services/index/thumbnails';
import { Icon, iconForFile } from '../../shell/Icon';
import styles from './SearchApp.module.css';

/**
 * Search.
 *
 * The app the whole project exists for: type what you mean, get the passage that means it, from
 * files that never left the tab.
 *
 * Every result is labelled with how it was found — meaning, keyword, or both — because a search
 * that cannot explain itself is a search you end up not trusting.
 */

const EXAMPLES = [
  'invoice for the monitor',
  'which document mentions Samsung',
  'notes about the migration timeline',
];

export default function SearchApp({ args }: AppProps) {
  const initial = (args as { query?: string } | undefined)?.query ?? '';
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [photoHits, setPhotoHits] = useState<ImageHit[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'done'>('idle');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stats = useIndexStats();
  const indexer = useIndexerState();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setResults([]);
      setState('idle');
      return;
    }

    setState('searching');
    setError(null);
    const started = performance.now();
    try {
      // Documents and photos live in different vector spaces, so they are two searches whose
      // results are shown side by side rather than one ranking pretending to compare them.
      const [hits, photos] = await Promise.all([search(trimmed, 25), searchPhotos(trimmed, 12)]);
      setResults(hits);
      setPhotoHits(relevantPhotos(photos));
      setElapsed(Math.round(performance.now() - started));
      setState('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('done');
    }
  }, []);

  /* Debounced as you type: fast enough to feel live, slow enough not to queue a query per key. */
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setPhotoHits([]);
      setState('idle');
      return;
    }
    const timer = setTimeout(() => void run(query), 220);
    return () => clearTimeout(timer);
  }, [query, run]);

  const openHit = useCallback(async (hit: SearchHit) => {
    const node = await vfs.stat(hit.fileId);
    if (!node) return;
    launchApp('viewer', {
      args: { fileId: hit.fileId, highlight: { start: hit.start, end: hit.end } },
      title: node.name,
    });
  }, []);

  const indexedCount = stats?.documents ?? 0;

  return (
    <div className={styles.app}>
      <div className={styles.searchBar}>
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void run(query);
          }}
          placeholder="Describe what you are looking for…"
          aria-label="Search your files"
          type="search"
          spellCheck={false}
        />
        {state === 'searching' ? <span className={styles.spinner} aria-label="Searching" /> : null}
      </div>

      <div className={styles.statusStrip}>
        <span>
          {indexedCount} document{indexedCount === 1 ? '' : 's'} indexed
          {stats ? ` · ${stats.chunks} passages` : ''}
        </span>
        {indexer.pending > 0 ? (
          <span className={styles.pending}>{indexer.pending} still indexing…</span>
        ) : null}
        {elapsed !== null && state === 'done' ? (
          <span className={styles.timing}>
            {results.length} result{results.length === 1 ? '' : 's'}
            {photoHits.length > 0
              ? ` · ${photoHits.length} photo${photoHits.length === 1 ? '' : 's'}`
              : ''}{' '}
            in {elapsed} ms
          </span>
        ) : null}
      </div>

      <div className={styles.results}>
        {error ? (
          <div className={styles.message}>
            <Icon name="alert" size={22} />
            <p>{error}</p>
          </div>
        ) : state === 'idle' ? (
          <div className={styles.message}>
            <Icon name="sparkle" size={24} />
            <p>Search by meaning, not just by keyword.</p>
            <div className={styles.examples}>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className={styles.example}
                  onClick={() => setQuery(example)}
                >
                  {example}
                </button>
              ))}
            </div>
            {indexedCount === 0 ? (
              <p className={styles.hint}>
                {indexer.pending > 0
                  ? 'Indexing is still running — results will appear as it finishes.'
                  : 'Nothing is indexed yet. Import some documents in Files.'}
              </p>
            ) : null}
            {stats && !stats.ready ? (
              <button type="button" className={styles.warm} onClick={() => void warmUpModel()}>
                Load the embedding model now
              </button>
            ) : null}
          </div>
        ) : results.length === 0 && photoHits.length === 0 && state === 'done' ? (
          <div className={styles.message}>
            <Icon name="search" size={22} />
            <p>No matches for “{query}”.</p>
            <p className={styles.hint}>
              {indexedCount === 0
                ? 'Nothing has been indexed yet.'
                : 'Try describing the content differently, or fewer words.'}
            </p>
          </div>
        ) : (
          <>
            {photoHits.length > 0 ? (
              <section className={styles.photoSection}>
                <h3 className={styles.photoHeading}>Photos ({photoHits.length})</h3>
                <div className={styles.photoStrip}>
                  {photoHits.map((hit) => (
                    <PhotoResult key={hit.id} hit={hit} />
                  ))}
                </div>
              </section>
            ) : null}

            <ul className={styles.list}>
              {results.map((hit, index) => (
                <li key={`${hit.fileId}-${hit.chunkIndex}-${index}`}>
                  <button type="button" className={styles.hit} onClick={() => void openHit(hit)}>
                    <div className={styles.hitHeader}>
                      <Icon
                        name={iconForFile({ kind: 'file', mime: hit.mime, name: hit.fileName })}
                        size={15}
                      />
                      <span className={styles.hitName}>{hit.fileName}</span>
                      <span className={`${styles.badge} ${styles[hit.matched]}`}>
                        {hit.matched === 'both'
                          ? 'meaning + keyword'
                          : hit.matched === 'semantic'
                            ? 'meaning'
                            : 'keyword'}
                      </span>
                    </div>
                    <p className={styles.snippet}>
                      <Snippet text={hit.snippet} highlights={hit.highlights} />
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Which photo hits are worth showing next to document results.
 *
 * CLIP similarity scores are compressed: with the current model a genuine match lands around
 * 0.29–0.32 and an unrelated picture around 0.20–0.25, so the whole library sits inside a twelve
 * point band. Two rules together, because neither works alone —
 *
 *  - an absolute floor, or a query about invoices returns four photographs of nothing in
 *    particular purely because something had to come top;
 *  - a relative window, or a strong match drags in everything else that scored nearby.
 *
 * Both numbers are calibrated to CLIP ViT-B/32's observed range and should be re-checked if the
 * model changes — which is one more reason the model is not a detail to swap casually.
 */
function relevantPhotos(hits: ImageHit[]): ImageHit[] {
  const best = hits[0]?.score ?? 0;
  if (best < 0.27) return [];
  return hits.filter((hit) => hit.score >= Math.max(0.26, best * 0.95)).slice(0, 6);
}

/** One picture in the results strip, opened in Photos rather than the plain viewer. */
function PhotoResult({ hit }: { hit: ImageHit }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void thumbnailUrl(hit.id).then((value) => {
      if (!cancelled) setUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, [hit.id]);

  return (
    <button
      type="button"
      className={styles.photo}
      onClick={() => launchApp('photos', { args: { fileId: hit.id } })}
      title={`${hit.name} · ${Math.round(hit.score * 100)}% match`}
    >
      {url ? <img src={url} alt={hit.name} className={styles.photoImage} loading="lazy" /> : null}
      <span className={styles.photoScore}>{Math.round(hit.score * 100)}</span>
    </button>
  );
}

/** Marks the matched terms inside a snippet without ever building HTML from file content. */
function Snippet({ text, highlights }: { text: string; highlights: [number, number][] }) {
  if (highlights.length === 0) return <>{text}</>;

  const ordered = [...highlights].sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  ordered.forEach(([start, end], index) => {
    if (start < cursor) return;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={index} className={styles.mark}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
}

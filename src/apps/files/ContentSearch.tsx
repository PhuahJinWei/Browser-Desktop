import { useCallback, useEffect, useState } from 'react';
import { launchApp } from '../../kernel/apps';
import { vfs } from '../../kernel/vfs/client';
import { search, useIndexStats, useIndexerState, warmUpModel } from '../../services/index/client';
import type { SearchHit } from '../../services/index/client';
import { ContextMenu, separator, useContextMenu } from '../../shell/ContextMenu';
import { Icon, iconForFile } from '../../shell/Icon';
import { copyText, nodeMenuItems } from '../../shell/nodeMenu';
import styles from './ContentSearch.module.css';

/**
 * Searching inside files, shown in place of a folder listing.
 *
 * This used to be an app of its own. It is now what Files' search box does when you press Enter,
 * because a fresh desktop has one place to find a file, and that place is the file manager: typing
 * filters the folder by name, Enter searches every file by what it says. The Start menu and the
 * command palette both hand their queries here.
 *
 * Every result is labelled with how it was found — meaning, keyword, or both — because a search
 * that cannot explain itself is a search you end up not trusting.
 */

const EXAMPLES = [
  'invoice for the monitor',
  'which document mentions Samsung',
  'notes about the migration timeline',
];

export function ContentSearch({
  query,
  onQuery,
}: {
  query: string;
  /** An example was chosen; the search box, which Files owns, should show it. */
  onQuery: (query: string) => void;
}) {
  const [results, setResults] = useState<SearchHit[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'done'>('idle');
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stats = useIndexStats();
  const indexer = useIndexerState();

  /* Debounced as you type: fast enough to feel live, slow enough not to queue a query per key. */
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setState('idle');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setState('searching');
      setError(null);
      const started = performance.now();
      search(trimmed, 25).then(
        (hits) => {
          if (cancelled) return;
          setResults(hits);
          setElapsed(Math.round(performance.now() - started));
          setState('done');
        },
        (cause: unknown) => {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setState('done');
        },
      );
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const openHit = useCallback(async (hit: SearchHit) => {
    const node = await vfs.stat(hit.fileId);
    if (!node) return;
    launchApp('viewer', {
      args: { fileId: hit.fileId, highlight: { start: hit.start, end: hit.end } },
      title: node.name,
    });
  }, []);

  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const indexedCount = stats?.documents ?? 0;

  return (
    <div className={styles.root}>
      <div className={styles.statusStrip} role="status">
        <span>
          {indexedCount} document{indexedCount === 1 ? '' : 's'} indexed
          {stats ? ` · ${stats.chunks} passages` : ''}
        </span>
        {indexer.pending > 0 ? (
          <span className={styles.pending}>{indexer.pending} still indexing…</span>
        ) : null}
        {state === 'searching' ? <span className={styles.spinner} aria-label="Searching" /> : null}
        {elapsed !== null && state === 'done' ? (
          <span className={styles.timing}>
            {results.length} result{results.length === 1 ? '' : 's'} in {elapsed} ms
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
            <p>Search inside every file, by meaning as well as by keyword.</p>
            <div className={styles.examples}>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  className={styles.example}
                  onClick={() => onQuery(example)}
                >
                  {example}
                </button>
              ))}
            </div>
            {indexedCount === 0 ? (
              <p className={styles.hint}>
                {indexer.pending > 0
                  ? 'Indexing is still running — results will appear as it finishes.'
                  : 'Nothing is indexed yet. Import some documents.'}
              </p>
            ) : null}
            {stats && !stats.ready ? (
              <button type="button" className={styles.warm} onClick={() => void warmUpModel()}>
                Load the embedding model now
              </button>
            ) : null}
          </div>
        ) : results.length === 0 && state === 'done' ? (
          <div className={styles.message}>
            <Icon name="search" size={22} />
            <p>No file says anything like “{query}”.</p>
            <p className={styles.hint}>
              {indexedCount === 0
                ? 'Nothing has been indexed yet.'
                : 'Try describing the content differently, or fewer words.'}
            </p>
          </div>
        ) : (
          <ul className={styles.list}>
            {results.map((hit, index) => (
              <li key={`${hit.fileId}-${hit.chunkIndex}-${index}`}>
                <button
                  type="button"
                  className={styles.hit}
                  onClick={() => void openHit(hit)}
                  onContextMenu={(event) => {
                    void vfs.stat(hit.fileId).then((node) => {
                      openMenu(event, [
                        {
                          id: 'hit.open',
                          label: 'Open at this passage',
                          run: () => void openHit(hit),
                        },
                        {
                          id: 'hit.copy',
                          label: 'Copy passage',
                          run: () => copyText(hit.snippet, 'Passage copied'),
                        },
                        separator('hit.s1'),
                        ...(node ? nodeMenuItems(node, { omitTrash: true }) : []),
                      ]);
                    });
                  }}
                >
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
        )}
      </div>

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </div>
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

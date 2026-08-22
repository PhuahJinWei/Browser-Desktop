import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { vfs } from '../../kernel/vfs/client';
import { categoryOf, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { notifyError } from '../../kernel/notifications';
import {
  enableVision,
  searchPhotos,
  similarPhotos,
  useIndexStats,
  useIndexerState,
  type ImageHit,
} from '../../services/index/client';
import { thumbnailUrl } from '../../services/index/thumbnails';
import { Icon } from '../../shell/Icon';
import styles from './PhotosApp.module.css';

/**
 * Photos.
 *
 * Two ways to find a picture: by browsing, and by describing it. The second is the interesting
 * one — the model puts images and sentences in the same vector space, so "sunset over water"
 * finds the picture without anyone having tagged, captioned or named it.
 *
 * The model is opt-in. Until it is downloaded, this is still a working picture browser that says
 * plainly what it cannot yet do.
 */

const EXAMPLES = ['sunset over water', 'something red', 'a chart or diagram', 'night sky'];

type Mode =
  | { kind: 'all' }
  | { kind: 'search'; query: string }
  | { kind: 'similar'; id: string; name: string };

export default function PhotosApp({ args }: AppProps) {
  const initial = (args as { fileId?: string } | undefined) ?? {};
  const [photos, setPhotos] = useState<VfsNode[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'all' });
  const [hits, setHits] = useState<ImageHit[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(initial.fileId ?? null);
  const [searching, setSearching] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const indexer = useIndexerState();
  const stats = useIndexStats();

  /* Every image in the file system, newest first. */
  const load = useCallback(async () => {
    const nodes = await vfs.allNodes();
    setPhotos(
      nodes
        .filter((node) => node.kind === 'file' && !node.trashed && categoryOf(node) === 'image')
        .sort((a, b) => b.modifiedAt - a.modifiedAt),
    );
  }, []);

  useEffect(() => {
    void load();
    return vfs.onChange(() => void load());
  }, [load]);

  const runSearch = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setMode({ kind: 'all' });
      setHits(null);
      return;
    }
    setSearching(true);
    const started = performance.now();
    try {
      const results = await searchPhotos(trimmed);
      setHits(results);
      setMode({ kind: 'search', query: trimmed });
      setElapsed(Math.round(performance.now() - started));
    } catch (error) {
      notifyError('Photo search failed', error);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!indexer.visionEnabled) return;
    const timer = setTimeout(() => void runSearch(query), 260);
    return () => clearTimeout(timer);
  }, [query, runSearch, indexer.visionEnabled]);

  const showSimilar = useCallback(async (node: VfsNode) => {
    const results = await similarPhotos(node.id);
    setHits(results);
    setMode({ kind: 'similar', id: node.id, name: node.name });
    setQuery('');
  }, []);

  /** What the grid shows: everything, or the ranked results of a search. */
  const shown = useMemo(() => {
    if (mode.kind === 'all' || !hits)
      return photos.map((node) => ({ node, score: null as number | null }));
    const byId = new Map(photos.map((node) => [node.id, node]));
    return hits.flatMap((hit) => {
      const node = byId.get(hit.id);
      return node ? [{ node, score: hit.score }] : [];
    });
  }, [mode, hits, photos]);

  const selectedNode = photos.find((node) => node.id === selected) ?? null;

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Icon name="search" size={15} />
          <input
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              indexer.visionEnabled ? 'Describe a picture…' : 'Photo search needs the image model'
            }
            disabled={!indexer.visionEnabled}
            aria-label="Search photos by description"
            type="search"
          />
          {searching ? <span className={styles.spinner} aria-label="Searching" /> : null}
        </div>

        {mode.kind !== 'all' ? (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              setMode({ kind: 'all' });
              setHits(null);
              setQuery('');
            }}
          >
            <Icon name="close" size={13} />
            {mode.kind === 'similar' ? `Similar to ${mode.name}` : `“${mode.query}”`}
          </button>
        ) : null}

        <span className={styles.count}>
          {shown.length} photo{shown.length === 1 ? '' : 's'}
          {elapsed !== null && mode.kind === 'search' ? ` · ${elapsed} ms` : ''}
        </span>
      </div>

      {!indexer.visionEnabled ? (
        <div className={styles.banner}>
          <Icon name="sparkle" size={16} />
          <div className={styles.bannerBody}>
            <p className={styles.bannerTitle}>Search these photos by describing them</p>
            <p className={styles.bannerText}>
              Needs a one-off image-model download. It runs on this device; your pictures are never
              uploaded.
            </p>
          </div>
          <button
            type="button"
            className={styles.enable}
            disabled={indexer.visionLoading}
            onClick={() => void enableVision()}
          >
            {indexer.visionLoading ? (indexer.modelProgress ?? 'Loading…') : 'Enable photo search'}
          </button>
        </div>
      ) : indexer.pendingImages > 0 ? (
        <div className={styles.banner}>
          <span className={styles.spinner} />
          <div className={styles.bannerBody}>
            <p className={styles.bannerText}>
              Indexing {indexer.pendingImages} photo{indexer.pendingImages === 1 ? '' : 's'} —
              search improves as this finishes.
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.body}>
        <div className={styles.grid}>
          {shown.length === 0 ? (
            <div className={styles.empty}>
              <p>
                {photos.length === 0
                  ? 'No pictures yet. Drop some into Files, or load the sample set from Settings.'
                  : 'Nothing matches that description.'}
              </p>
              {indexer.visionEnabled && photos.length > 0 ? (
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
              ) : null}
            </div>
          ) : (
            shown.map(({ node, score }) => (
              <Thumb
                key={node.id}
                node={node}
                score={score}
                selected={node.id === selected}
                onSelect={() => setSelected(node.id)}
              />
            ))
          )}
        </div>

        {selectedNode ? (
          <aside className={styles.detail}>
            <Preview node={selectedNode} />
            <h3 className={styles.detailName}>{selectedNode.name}</h3>
            <dl className={styles.detailMeta}>
              <div>
                <dt>Type</dt>
                <dd>{selectedNode.mime}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{formatBytes(selectedNode.size)}</dd>
              </div>
              <div>
                <dt>Added</dt>
                <dd>{new Date(selectedNode.createdAt).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt>Indexed</dt>
                <dd>
                  {selectedNode.indexState === 'indexed'
                    ? 'yes'
                    : (selectedNode.indexState ?? 'no')}
                </dd>
              </div>
            </dl>
            <div className={styles.detailActions}>
              <button
                type="button"
                className={styles.detailButton}
                disabled={!indexer.visionEnabled || selectedNode.indexState !== 'indexed'}
                onClick={() => void showSimilar(selectedNode)}
              >
                <Icon name="sparkle" size={14} /> Find similar
              </button>
            </div>
            {stats && stats.images > 0 ? (
              <p className={styles.detailNote}>
                {stats.images} photo{stats.images === 1 ? '' : 's'} searchable
              </p>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** A grid cell. Draws the stored thumbnail, falling back to the original if none exists yet. */
function Thumb({
  node,
  score,
  selected,
  onSelect,
}: {
  node: VfsNode;
  score: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let fallback: string | null = null;

    void (async () => {
      const thumb = await thumbnailUrl(node.id);
      if (cancelled) return;
      if (thumb) {
        setUrl(thumb);
        return;
      }
      // No thumbnail yet (the model has not seen it): show the original this once.
      try {
        const { data } = await vfs.read(node.id);
        if (cancelled) return;
        fallback = URL.createObjectURL(new Blob([data], { type: node.mime }));
        setUrl(fallback);
      } catch {
        /* Unreadable file; the empty cell is the honest result. */
      }
    })();

    return () => {
      cancelled = true;
      // Only revoke what this component created; thumbnail URLs are pooled and shared.
      if (fallback) URL.revokeObjectURL(fallback);
    };
  }, [node.id, node.mime]);

  return (
    <button
      type="button"
      className={`${styles.cell} ${selected ? styles.cellSelected : ''}`}
      onClick={onSelect}
      title={node.name}
    >
      {url ? (
        <img className={styles.image} src={url} alt={node.name} loading="lazy" />
      ) : (
        <span className={styles.placeholder} />
      )}
      <span className={styles.cellName}>{node.name}</span>
      {score !== null ? <span className={styles.score}>{Math.round(score * 100)}</span> : null}
    </button>
  );
}

function Preview({ node }: { node: VfsNode }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      const { data } = await vfs.read(node.id);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([data], { type: node.mime }));
      setUrl(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [node.id, node.mime]);

  return (
    <div className={styles.preview}>
      {url ? <img src={url} alt={node.name} className={styles.previewImage} /> : null}
    </div>
  );
}

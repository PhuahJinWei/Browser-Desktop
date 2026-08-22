import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { vfs } from '../../kernel/vfs/client';
import { categoryOf, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { thumbnailUrl } from '../../services/index/thumbnails';
import { Icon } from '../../shell/Icon';
import styles from './PhotosApp.module.css';

/**
 * Photos.
 *
 * A picture browser: a virtualised grid over everything in the file system that is an image, with
 * a filter by name and a detail pane.
 *
 * It used to find pictures by description, and by similarity to one another. That ran on a 150 MB
 * model fetched on first use, and the project chose to stop requiring downloads of anyone — so the
 * search went with it. What is left needs nothing but the browser: the grid draws stored
 * thumbnails, generated on this device by a worker, so a folder of 4000-pixel photographs scrolls
 * like a folder of ten.
 */

export default function PhotosApp({ args }: AppProps) {
  const initial = (args as { fileId?: string } | undefined) ?? {};
  const [photos, setPhotos] = useState<VfsNode[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(initial.fileId ?? null);

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

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return photos;
    return photos.filter((node) => node.name.toLowerCase().includes(needle));
  }, [photos, filter]);

  const selectedNode = photos.find((node) => node.id === selected) ?? null;

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Icon name="search" size={15} />
          <input
            className={styles.input}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by name…"
            aria-label="Filter pictures by name"
            type="search"
          />
        </div>

        <span className={styles.count}>
          {shown.length} picture{shown.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className={styles.body}>
        <div className={styles.grid}>
          {shown.length === 0 ? (
            <div className={styles.empty}>
              <p>
                {photos.length === 0
                  ? 'No pictures yet. Drop some into Files, or load the sample set from Settings.'
                  : 'Nothing here matches that name.'}
              </p>
            </div>
          ) : (
            shown.map((node) => (
              <Thumb
                key={node.id}
                node={node}
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
            </dl>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** A grid cell. Draws the stored thumbnail, falling back to the original if none exists yet. */
function Thumb({
  node,
  selected,
  onSelect,
}: {
  node: VfsNode;
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
      // No thumbnail yet (the worker has not reached it): show the original this once.
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
    </button>
  );
}

function Preview({ node }: { node: VfsNode }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await vfs.read(node.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([data], { type: node.mime }));
        setUrl(objectUrl);
      } catch {
        // The grid already drew a thumbnail for this one; a preview that cannot be read stays
        // empty rather than rejecting into the console.
        if (!cancelled) setUrl(null);
      }
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

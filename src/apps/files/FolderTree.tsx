import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSetting } from '../../kernel/settings';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, type VfsNode } from '../../kernel/vfs/types';
import { Icon } from '../../shell/Icon';
import { AppIcon } from '../../shell/PixelIcon';
import styles from './Explorer.module.css';
import { treeRows } from './treeRows';

/**
 * The folder tree down the left of Files.
 *
 * Both desktops this imitates navigate by a tree here, not a flat list: folders open in place to
 * show the folders inside them, and the one you are in is highlighted wherever it is. Under classic
 * it is drawn the period's way — +/− boxes and dotted lines joining each folder to its parent —
 * and under modern with chevrons and no lines. The structure and the keyboard are the same.
 *
 * Folders are listed lazily: a folder's subfolders are read when it becomes visible, which is also
 * how the tree knows whether to offer an expander at all. A listing is re-read when the file system
 * says it changed, so a folder created anywhere appears here without being asked for.
 */

export function FolderTree({
  currentId,
  ancestors,
  recycle,
  onNavigate,
  onRecycle,
}: {
  /** The folder being shown, or null while the Recycle Bin is. */
  currentId: string | null;
  /** The ids from the root down to the current folder, so it can be revealed. */
  ancestors: string[];
  recycle: boolean;
  onNavigate: (id: string) => void;
  onRecycle: () => void;
}) {
  const classic = useSetting('skin') === 'classic';
  const [children, setChildren] = useState<Map<string, VfsNode[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_ID]));
  const [focusId, setFocusId] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const loaded = useRef(children);
  useEffect(() => {
    loaded.current = children;
  });

  const load = useCallback(async (id: string) => {
    try {
      const nodes = await vfs.list(id);
      const folders = nodes
        .filter((node) => node.kind === 'directory' && !node.trashed)
        .sort((a, b) => a.name.localeCompare(b.name));
      setChildren((current) => new Map(current).set(id, folders));
    } catch {
      // A folder that vanished between being shown and being read simply has nothing under it.
      setChildren((current) => new Map(current).set(id, []));
    }
  }, []);

  // Wherever you navigate to is revealed: every folder above it opens.
  const ancestorKey = ancestors.join('/');
  useEffect(() => {
    if (!ancestorKey) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const id of ancestorKey.split('/').slice(0, -1)) next.add(id);
      return next;
    });
  }, [ancestorKey]);

  // A change re-reads the listings it touched that the tree has already read.
  useEffect(
    () =>
      vfs.onChange((change) => {
        for (const parent of change.parents) if (loaded.current.has(parent)) void load(parent);
      }),
    [load],
  );

  const rows = useMemo(
    () => treeRows({ id: ROOT_ID, name: 'Home' }, children, expanded),
    [children, expanded],
  );

  // Read the listing of every visible folder not yet read: that is what decides its expander.
  const unread = rows
    .filter((row) => !children.has(row.id))
    .map((row) => row.id)
    .join('/');
  useEffect(() => {
    if (unread) for (const id of unread.split('/')) void load(id);
  }, [unread, load]);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* Keyboard: the tree pattern — arrows move, right opens or steps in, left closes or steps out. */
  const RECYCLE = 'recycle-bin';
  const order = [...rows.map((row) => row.id), RECYCLE];
  const active = focusId ?? (recycle ? RECYCLE : currentId) ?? ROOT_ID;

  useEffect(() => {
    if (!focusId) return;
    treeRef.current?.querySelector<HTMLElement>(`[data-tree-id="${focusId}"]`)?.focus();
  }, [focusId]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = order.indexOf(active);
    const row = rows.find((candidate) => candidate.id === active);
    const go = (id: string | undefined) => {
      if (!id) return;
      event.preventDefault();
      setFocusId(id);
    };
    switch (event.key) {
      case 'ArrowDown':
        go(order[index + 1]);
        break;
      case 'ArrowUp':
        go(order[index - 1]);
        break;
      case 'Home':
        go(order[0]);
        break;
      case 'End':
        go(order.at(-1));
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (row?.hasChildren && !row.expanded) toggle(row.id);
        else if (row?.hasChildren) go(order[index + 1]);
        break;
      case 'ArrowLeft': {
        event.preventDefault();
        if (row?.expanded && row.hasChildren) {
          toggle(row.id);
          break;
        }
        // Step out to the nearest row above at a lower depth: the parent.
        const parent = row
          ? rows.slice(0, rows.indexOf(row)).findLast((candidate) => candidate.depth < row.depth)
          : undefined;
        go(parent?.id);
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (active === RECYCLE) onRecycle();
        else onNavigate(active);
        break;
      default:
    }
  };

  return (
    <ul
      ref={treeRef}
      className={styles.tree}
      role="tree"
      aria-label="Folders"
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => {
        const current = !recycle && row.id === currentId;
        return (
          <li
            key={row.id}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-selected={current}
            tabIndex={row.id === active ? 0 : -1}
            data-tree-id={row.id}
            className={`${styles.treeRow} ${current ? styles.treeRowActive : ''}`}
            onClick={() => {
              setFocusId(row.id);
              onNavigate(row.id);
            }}
          >
            {classic ? (
              <>
                {/*
                  The period's guide lines: a column per ancestor level, dotted where that level
                  carries on below, then this row's own elbow joining it to its parent. The +/− box
                  sits on the elbow, where the line turns, which is where the era drew it.
                */}
                {row.continues.slice(1).map((line, level) => (
                  <span key={level} className={`${styles.guide} ${line ? styles.guideLine : ''}`} />
                ))}
                {row.depth > 0 ? (
                  <span className={`${styles.elbow} ${row.last ? styles.elbowLast : ''}`}>
                    {row.hasChildren ? (
                      <span
                        className={`${styles.plusBox} ${row.expanded ? '' : styles.plusBoxClosed}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(row.id);
                        }}
                        aria-hidden
                      />
                    ) : null}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <span style={{ width: row.depth * 14 }} className={styles.indent} />
                <span
                  className={styles.expander}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (row.hasChildren) toggle(row.id);
                  }}
                  aria-hidden
                >
                  {row.hasChildren ? (
                    <Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} size={12} />
                  ) : null}
                </span>
              </>
            )}

            <AppIcon
              name={row.depth === 0 ? 'drive' : current && classic ? 'folder-open' : 'folder'}
              size={16}
            />
            <span className={styles.treeLabel}>{row.name}</span>
          </li>
        );
      })}

      <li
        role="treeitem"
        aria-level={1}
        aria-selected={recycle}
        tabIndex={active === RECYCLE ? 0 : -1}
        data-tree-id={RECYCLE}
        className={`${styles.treeRow} ${styles.treeRowGap} ${recycle ? styles.treeRowActive : ''}`}
        onClick={() => {
          setFocusId(RECYCLE);
          onRecycle();
        }}
      >
        {classic ? null : <span className={styles.expander} aria-hidden />}
        <AppIcon name="trash" size={16} />
        <span className={styles.treeLabel}>Recycle Bin</span>
      </li>
    </ul>
  );
}

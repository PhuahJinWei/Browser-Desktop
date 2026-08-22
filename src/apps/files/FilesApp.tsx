import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { openFile } from '../../kernel/apps';
import { setWindowTitle } from '../../kernel/windows';
import { notify, notifyError } from '../../kernel/notifications';
import { PRIORITY, schedule } from '../../kernel/jobs';
import { useDirectory, usePath, useTrash, vfs } from '../../kernel/vfs/client';
import { ROOT_ID, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { Icon, iconForFile } from '../../shell/Icon';
import { useVirtualList } from '../../shell/useVirtualList';
import { collectDroppedEntries, pickDirectory, pickFiles } from './import';
import styles from './FilesApp.module.css';

/**
 * Files.
 *
 * The app that makes the file system real: browse, select, rename, move, trash, restore, import.
 * Rows are windowed so a directory of thousands stays as smooth as one of ten, and every
 * destructive action goes through the trash rather than deleting outright.
 */

type ViewMode = 'list' | 'grid';
type SortKey = 'name' | 'size' | 'modified' | 'kind';

interface FilesArgs {
  directoryId?: string;
  selectId?: string;
}

const ROW_HEIGHT = 34;

export default function FilesApp({ windowId, args }: AppProps) {
  const initial = (args as FilesArgs | undefined) ?? {};
  const [directoryId, setDirectoryId] = useState<string>(initial.directoryId ?? ROOT_ID);
  const [showTrash, setShowTrash] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(
    new Set(initial.selectId ? [initial.selectId] : []),
  );
  const [cursor, setCursor] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<SortKey>('name');
  const [filter, setFilter] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; node: VfsNode | null } | null>(null);

  const listing = useDirectory(showTrash ? null : directoryId);
  const trash = useTrash();
  const path = usePath(showTrash ? null : directoryId);
  const containerRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => {
    const source = showTrash ? trash.nodes : listing.nodes;
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? source.filter((node) => node.name.toLowerCase().includes(needle))
      : source;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      // Folders always lead, whatever the sort: it is the one ordering rule people rely on.
      const kindDelta = Number(b.kind === 'directory') - Number(a.kind === 'directory');
      if (kindDelta !== 0) return kindDelta;
      switch (sort) {
        case 'size':
          return b.size - a.size;
        case 'modified':
          return b.modifiedAt - a.modifiedAt;
        case 'kind':
          return a.mime.localeCompare(b.mime) || a.name.localeCompare(b.name);
        default:
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
    });
    return sorted;
  }, [showTrash, trash.nodes, listing.nodes, filter, sort]);

  const virtual = useVirtualList(nodes.length, ROW_HEIGHT);

  /* Keep the window title in step with where we are. */
  useEffect(() => {
    const title = showTrash ? 'Trash' : (path.at(-1)?.name ?? 'Files');
    setWindowTitle(windowId, title === 'Home' ? 'Files' : title);
  }, [windowId, path, showTrash]);

  useEffect(() => {
    setCursor(0);
    setSelection(new Set());
  }, [directoryId, showTrash]);

  /* Selection ------------------------------------------------------------------------------- */

  const selectAt = useCallback(
    (index: number, event?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
      const node = nodes[index];
      if (!node) return;
      setCursor(index);

      setSelection((current) => {
        if (event?.shiftKey) {
          const from = Math.min(cursor, index);
          const to = Math.max(cursor, index);
          return new Set(nodes.slice(from, to + 1).map((candidate) => candidate.id));
        }
        if (event?.ctrlKey || event?.metaKey) {
          const next = new Set(current);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        }
        return new Set([node.id]);
      });
    },
    [nodes, cursor],
  );

  const selectedNodes = useMemo(
    () => nodes.filter((node) => selection.has(node.id)),
    [nodes, selection],
  );

  /* Actions --------------------------------------------------------------------------------- */

  const open = useCallback(
    (node: VfsNode) => {
      if (showTrash) return;
      if (node.kind === 'directory') setDirectoryId(node.id);
      else openFile(node);
    },
    [showTrash],
  );

  const goUp = useCallback(() => {
    const parent = path.at(-2);
    if (parent) setDirectoryId(parent.id);
  }, [path]);

  const newFolder = useCallback(async () => {
    try {
      const node = await vfs.createDirectory(directoryId, 'New folder');
      setSelection(new Set([node.id]));
      setRenaming(node.id);
    } catch (error) {
      notifyError('Could not create the folder', error);
    }
  }, [directoryId]);

  const trashSelected = useCallback(async () => {
    if (selectedNodes.length === 0) return;
    try {
      const ids = selectedNodes.map((node) => node.id);
      await vfs.trash(ids);
      setSelection(new Set());
      notify({
        title: `Moved ${ids.length} item${ids.length === 1 ? '' : 's'} to Trash`,
        level: 'success',
        action: {
          label: 'Undo',
          run: () => void vfs.restore(ids),
        },
      });
    } catch (error) {
      notifyError('Could not move to Trash', error);
    }
  }, [selectedNodes]);

  const restoreSelected = useCallback(async () => {
    if (selectedNodes.length === 0) return;
    await vfs.restore(selectedNodes.map((node) => node.id));
    setSelection(new Set());
  }, [selectedNodes]);

  const deleteSelected = useCallback(async () => {
    if (selectedNodes.length === 0) return;
    const names = selectedNodes.map((node) => node.name).join(', ');
    // Permanent deletion is the one action with no undo, so it asks.
    if (
      !confirm(
        `Permanently delete ${selectedNodes.length} item(s)?\n\n${names}\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    const result = await vfs.deleteForever(selectedNodes.map((node) => node.id));
    setSelection(new Set());
    notify({
      title: `Deleted ${result.nodes.length} item${result.nodes.length === 1 ? '' : 's'}`,
      body:
        result.blobs > 0
          ? `${result.blobs} stored file${result.blobs === 1 ? '' : 's'} freed`
          : undefined,
      level: 'info',
    });
  }, [selectedNodes]);

  const rename = useCallback(async (id: string, name: string) => {
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await vfs.rename(id, trimmed);
    } catch (error) {
      notifyError('Could not rename', error);
    }
  }, []);

  /* Import ---------------------------------------------------------------------------------- */

  const runImport = useCallback(
    async (entries: Awaited<ReturnType<typeof collectDroppedEntries>>, label: string) => {
      if (entries.length === 0) return;

      const job = schedule(
        { label, kind: 'import', priority: PRIORITY.userBatch },
        async (context) => {
          context.setProgress(0, `0 / ${entries.length}`);
          return vfs.importEntries(directoryId, entries, {
            onProgress: (progress) => {
              context.setProgress(
                progress.total ? progress.completed / progress.total : null,
                `${progress.completed} / ${progress.total}`,
              );
            },
          });
        },
      );

      try {
        const result = await job.promise;
        notify({
          level: result.skipped.length > 0 ? 'warning' : 'success',
          title: `Imported ${result.created.length} file${result.created.length === 1 ? '' : 's'}`,
          body:
            result.skipped.length > 0
              ? `${result.skipped.length} skipped — ${result.skipped[0]?.reason ?? ''}`
              : formatBytes(result.bytes),
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          notifyError('Import failed', error);
        }
      }
    },
    [directoryId],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setDropActive(false);
      try {
        const entries = await collectDroppedEntries(event.dataTransfer);
        await runImport(entries, `Import ${entries.length} file${entries.length === 1 ? '' : 's'}`);
      } catch (error) {
        notifyError('Could not read what was dropped', error);
      }
    },
    [runImport],
  );

  /* Keyboard -------------------------------------------------------------------------------- */

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (renaming) return;

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          const next = Math.min(nodes.length - 1, cursor + 1);
          selectAt(next, event);
          virtual.scrollToIndex(next);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const next = Math.max(0, cursor - 1);
          selectAt(next, event);
          virtual.scrollToIndex(next);
          break;
        }
        case 'Home':
          event.preventDefault();
          selectAt(0);
          virtual.scrollToIndex(0);
          break;
        case 'End':
          event.preventDefault();
          selectAt(nodes.length - 1);
          virtual.scrollToIndex(nodes.length - 1);
          break;
        case 'Enter': {
          event.preventDefault();
          const node = nodes[cursor];
          if (node) open(node);
          break;
        }
        case 'Backspace':
          event.preventDefault();
          if (!showTrash) goUp();
          break;
        case 'F2': {
          event.preventDefault();
          const node = nodes[cursor];
          if (node && !showTrash) setRenaming(node.id);
          break;
        }
        case 'Delete':
          event.preventDefault();
          void (showTrash ? deleteSelected() : trashSelected());
          break;
        case 'a':
        case 'A':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            setSelection(new Set(nodes.map((node) => node.id)));
          }
          break;
        default:
          break;
      }
    },
    [
      renaming,
      nodes,
      cursor,
      selectAt,
      virtual,
      open,
      showTrash,
      goUp,
      deleteSelected,
      trashSelected,
    ],
  );

  /* Render ---------------------------------------------------------------------------------- */

  const empty = !listing.loading && nodes.length === 0;

  return (
    <div
      className={`${styles.app} ${dropActive ? styles.dropping : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!showTrash) setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false);
      }}
      onDrop={onDrop}
    >
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={goUp}
          disabled={showTrash || path.length < 2}
          aria-label="Go to the parent folder"
          title="Parent folder (Backspace)"
        >
          <Icon name="arrow-up" size={16} />
        </button>

        <nav className={styles.breadcrumbs} aria-label="Location">
          {showTrash ? (
            <span className={styles.crumbCurrent}>
              <Icon name="trash" size={14} /> Trash
            </span>
          ) : (
            path.map((node, index) => (
              <span key={node.id} className={styles.crumb}>
                {index > 0 ? (
                  <Icon name="chevron-right" size={13} className={styles.crumbSeparator} />
                ) : null}
                {index === path.length - 1 ? (
                  <span className={styles.crumbCurrent}>
                    {node.id === ROOT_ID ? 'Home' : node.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.crumbLink}
                    onClick={() => setDirectoryId(node.id)}
                  >
                    {node.id === ROOT_ID ? 'Home' : node.name}
                  </button>
                )}
              </span>
            ))
          )}
        </nav>

        <input
          className={styles.filter}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name"
          aria-label="Filter this folder by name"
          type="search"
        />

        <div className={styles.toolbarActions}>
          {!showTrash ? (
            <>
              <button type="button" className={styles.button} onClick={newFolder}>
                <Icon name="plus" size={15} /> Folder
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={async () => {
                  const entries = await pickFiles();
                  await runImport(entries, `Import ${entries.length} file(s)`);
                }}
              >
                <Icon name="upload" size={15} /> Import
              </button>
              {pickDirectory.supported ? (
                <button
                  type="button"
                  className={styles.iconButton}
                  title="Import a whole folder"
                  aria-label="Import a folder"
                  onClick={async () => {
                    const entries = await pickDirectory();
                    await runImport(entries, `Import folder (${entries.length} files)`);
                  }}
                >
                  <Icon name="folder-open" size={16} />
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className={styles.button}
              onClick={async () => {
                if (!confirm('Permanently delete everything in the Trash?')) return;
                const result = await vfs.emptyTrash();
                notify({ title: `Emptied Trash (${result.nodes.length} items)`, level: 'info' });
              }}
              disabled={trash.nodes.length === 0}
            >
              <Icon name="trash" size={15} /> Empty
            </button>
          )}

          <button
            type="button"
            className={`${styles.iconButton} ${showTrash ? styles.iconButtonActive : ''}`}
            onClick={() => setShowTrash((current) => !current)}
            aria-pressed={showTrash}
            title="Trash"
            aria-label="Show the Trash"
          >
            <Icon name="trash" size={16} />
          </button>

          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setView((current) => (current === 'list' ? 'grid' : 'list'))}
            title={view === 'list' ? 'Grid view' : 'List view'}
            aria-label={view === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          >
            <Icon name={view === 'list' ? 'grid' : 'list'} size={16} />
          </button>

          <select
            className={styles.sort}
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            aria-label="Sort by"
          >
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="modified">Modified</option>
            <option value="kind">Type</option>
          </select>
        </div>
      </div>

      <div
        className={view === 'list' ? styles.listScroll : styles.gridScroll}
        ref={view === 'list' ? virtual.ref : containerRef}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelection(new Set());
        }}
        tabIndex={0}
        role="listbox"
        aria-multiselectable
        aria-label={showTrash ? 'Trash contents' : 'Folder contents'}
      >
        {empty ? (
          <div className={styles.empty}>
            {showTrash ? (
              <>
                <Icon name="trash" size={26} />
                <p>The Trash is empty.</p>
              </>
            ) : filter ? (
              <>
                <Icon name="search" size={26} />
                <p>Nothing here matches “{filter}”.</p>
              </>
            ) : (
              <>
                <Icon name="upload" size={26} />
                <p>This folder is empty.</p>
                <p className={styles.emptyHint}>Drop files here, or use Import.</p>
              </>
            )}
          </div>
        ) : view === 'list' ? (
          <div style={{ height: virtual.totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${virtual.offsetY}px)` }}>
              {nodes
                .slice(virtual.startIndex, virtual.startIndex + virtual.visibleCount)
                .map((node, offset) => {
                  const index = virtual.startIndex + offset;
                  return (
                    <FileRow
                      key={node.id}
                      node={node}
                      selected={selection.has(node.id)}
                      focused={index === cursor}
                      renaming={renaming === node.id}
                      onRename={(name) => void rename(node.id, name)}
                      onCancelRename={() => setRenaming(null)}
                      onPointerDown={(event) => selectAt(index, event)}
                      onDoubleClick={() => open(node)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (!selection.has(node.id)) selectAt(index);
                        setMenu({ x: event.clientX, y: event.clientY, node });
                      }}
                    />
                  );
                })}
            </div>
          </div>
        ) : (
          <div className={styles.grid}>
            {nodes.map((node, index) => (
              <button
                key={node.id}
                type="button"
                className={`${styles.tile} ${selection.has(node.id) ? styles.tileSelected : ''}`}
                onClick={(event) => selectAt(index, event)}
                onDoubleClick={() => open(node)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (!selection.has(node.id)) selectAt(index);
                  setMenu({ x: event.clientX, y: event.clientY, node });
                }}
              >
                <Icon name={iconForFile(node)} size={26} />
                <span className={styles.tileName}>{node.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.statusBar}>
        <span>
          {nodes.length} item{nodes.length === 1 ? '' : 's'}
          {selection.size > 0 ? ` · ${selection.size} selected` : ''}
        </span>
        {selectedNodes.length === 1 && selectedNodes[0]!.kind === 'file' ? (
          <span className={styles.statusDetail}>
            {formatBytes(selectedNodes[0]!.size)} ·{' '}
            {selectedNodes[0]!.indexState === 'indexed'
              ? 'indexed'
              : selectedNodes[0]!.indexState === 'skipped'
                ? 'not indexable'
                : (selectedNodes[0]!.indexState ?? 'not indexed')}
          </span>
        ) : null}
      </div>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          node={menu.node}
          inTrash={showTrash}
          multiple={selection.size > 1}
          onClose={() => setMenu(null)}
          onOpen={() => menu.node && open(menu.node)}
          onRename={() => menu.node && setRenaming(menu.node.id)}
          onTrash={() => void trashSelected()}
          onRestore={() => void restoreSelected()}
          onDelete={() => void deleteSelected()}
        />
      ) : null}

      {dropActive ? (
        <div className={styles.dropOverlay} aria-hidden>
          <Icon name="upload" size={30} />
          <p>Drop to import into {path.at(-1)?.name ?? 'this folder'}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

interface FileRowProps {
  node: VfsNode;
  selected: boolean;
  focused: boolean;
  renaming: boolean;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onPointerDown: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

function FileRow({
  node,
  selected,
  focused,
  renaming,
  onRename,
  onCancelRename,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
}: FileRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select the stem, not the extension: renaming almost never means changing the type.
    const dot = node.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : node.name.length);
  }, [renaming, node.name]);

  return (
    <div
      className={`${styles.row} ${selected ? styles.rowSelected : ''} ${focused ? styles.rowFocused : ''}`}
      style={{ height: ROW_HEIGHT }}
      onMouseDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      role="option"
      aria-selected={selected}
    >
      <Icon name={iconForFile(node)} size={16} className={styles.rowIcon} />
      {renaming ? (
        <input
          ref={inputRef}
          className={styles.renameInput}
          defaultValue={node.name}
          onBlur={(event) => onRename(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRename((event.target as HTMLInputElement).value);
            else if (event.key === 'Escape') onCancelRename();
            event.stopPropagation();
          }}
        />
      ) : (
        <span className={styles.rowName}>{node.name}</span>
      )}
      <span className={styles.rowMeta}>
        {node.kind === 'directory' ? '—' : formatBytes(node.size)}
      </span>
      <span className={styles.rowMeta}>
        {new Date(node.modifiedAt).toLocaleDateString(undefined, {
          day: '2-digit',
          month: 'short',
          year: '2-digit',
        })}
      </span>
      {node.indexState === 'indexed' ? (
        <Icon name="sparkle" size={13} className={styles.rowIndexed} label="Indexed for search" />
      ) : (
        <span className={styles.rowIndexSpacer} />
      )}
    </div>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  node: VfsNode | null;
  inTrash: boolean;
  multiple: boolean;
  onClose: () => void;
  onOpen: () => void;
  onRename: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
}

function ContextMenu({
  x,
  y,
  node,
  inTrash,
  multiple,
  onClose,
  onOpen,
  onRename,
  onTrash,
  onRestore,
  onDelete,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    const timer = setTimeout(() => {
      globalThis.addEventListener('pointerdown', close);
      globalThis.addEventListener('keydown', onKey);
    }, 0);
    ref.current?.querySelector('button')?.focus();
    return () => {
      clearTimeout(timer);
      globalThis.removeEventListener('pointerdown', close);
      globalThis.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Flip the menu when it would otherwise run off the viewport.
  const style = {
    left: Math.min(x, globalThis.innerWidth - 200),
    top: Math.min(y, globalThis.innerHeight - 220),
  };

  const item = (label: string, run: () => void, danger = false) => (
    <button
      type="button"
      className={`${styles.menuItem} ${danger ? styles.menuDanger : ''}`}
      onClick={() => {
        run();
        onClose();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className={styles.menu} style={style} ref={ref} role="menu">
      {inTrash ? (
        <>
          {item('Restore', onRestore)}
          {item('Delete permanently', onDelete, true)}
        </>
      ) : (
        <>
          {node && !multiple ? item(node.kind === 'directory' ? 'Open' : 'Open', onOpen) : null}
          {node && !multiple ? item('Rename', onRename) : null}
          {item(multiple ? 'Move to Trash' : 'Move to Trash', onTrash, true)}
        </>
      )}
    </div>
  );
}

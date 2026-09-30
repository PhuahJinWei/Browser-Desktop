import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { appsFor, launchApp, openFile } from '../../kernel/apps';
import { setWindowTitle } from '../../kernel/windows';
import { notify, notifyError } from '../../kernel/notifications';
import { PRIORITY, schedule } from '../../kernel/jobs';
import {
  cancelCut,
  copyFiles,
  cutFiles,
  pasteFiles,
  useFileClipboard,
} from '../../kernel/fileClipboard';
import { useDirectory, usePath, useTrash, vfs } from '../../kernel/vfs/client';
import { ROOT_ID, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { isWallpaperCandidate, setWallpaperFromFile } from '../../kernel/wallpaper';
import { ContextMenu, separator, useContextMenu, type MenuSpec } from '../../shell/ContextMenu';
import { MenuBar, type MenuBarMenu } from '../../shell/MenuBar';
import { closeWindow } from '../../kernel/windows';
import { Icon, iconForFile } from '../../shell/Icon';
import { useVirtualList } from '../../shell/useVirtualList';
import { thumbnailUrl } from '../../services/index/thumbnails';
import { ContentSearch } from './ContentSearch';
import { collectDroppedEntries, pickDirectory, pickFiles } from './import';
import styles from './Explorer.module.css';

/**
 * The file explorer, which two apps are made of.
 *
 * Files and the Recycle Bin are one window that can be looking at two things. They were briefly
 * separate implementations and it was the wrong call: every improvement then had to be made twice,
 * and the two drifted the same afternoon they were split. What actually differs between them is
 * small and nameable — where the rows come from, what the columns are called, and what you are
 * allowed to do to a selection — so that is what `recycle` switches, and everything else, from the
 * places pane to the sort arrows to the narrow-window rules, is shared by construction.
 *
 * It is also how the thing being imitated works: a recycle bin of this era was not its own program,
 * it was the file manager pointed at a different place. The bin is reached by opening its own
 * window rather than from the places pane, but the location stays state rather than a prop:
 * navigating to a folder from inside the bin leaves it, and that has to be expressible.
 *
 * Rows are windowed so a directory of thousands stays as smooth as one of ten, and every
 * destructive action outside the bin goes through it rather than deleting outright.
 */

type ViewMode = 'list' | 'grid';
type SortKey = 'name' | 'size' | 'modified' | 'kind' | 'origin';

/**
 * What the Type column says.
 *
 * Read from the extension rather than the recorded mime, because that is the name the user gave the
 * file and the one they will recognise — a `.md` written by Notepad and a `.md` dragged in from
 * outside can carry different mimes, and both are a Markdown file.
 */
const TYPE_NAMES: Record<string, string> = {
  md: 'Markdown file',
  txt: 'Text document',
  json: 'JSON file',
  csv: 'CSV file',
  pdf: 'PDF document',
  png: 'PNG image',
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  gif: 'GIF image',
  webp: 'WebP image',
  svg: 'SVG image',
  mp3: 'MP3 audio',
  wav: 'WAV audio',
  webm: 'WebM video',
  mp4: 'MP4 video',
  html: 'HTML document',
  css: 'Stylesheet',
  js: 'JavaScript file',
};

function typeLabel(node: VfsNode): string {
  if (node.kind === 'directory') return 'File folder';
  const dot = node.name.lastIndexOf('.');
  const ext = dot > 0 ? node.name.slice(dot + 1).toLowerCase() : '';
  return TYPE_NAMES[ext] ?? (ext ? `${ext.toUpperCase()} file` : 'File');
}

interface ExplorerArgs {
  directoryId?: string;
  selectId?: string;
  /** Open looking at the Recycle Bin. What apps/recycle-bin/RecycleBinApp.tsx passes. */
  recycle?: boolean;
  /**
   * Open with this in the search box. Non-empty also runs it as a search inside every file, which
   * is how the Start menu and the command palette hand a query over; empty just focuses the box.
   */
  search?: string;
}

const ROW_HEIGHT = 34;

interface Column {
  key: SortKey;
  label: string;
  /** The grid track it occupies. Kept here so the header and the rows cannot disagree. */
  width: string;
  align?: 'right';
  /** Dropped when the window is narrower than this. Omitted means the column always shows. */
  hideBelow?: number;
}

/**
 * What each context's columns are.
 *
 * The two lists differ in one entry and two names — the bin knows where a file came from and when
 * it was thrown away, a folder knows when its files were last changed — and everything downstream
 * reads this rather than branching on `recycle` again: the header, the row cells, the track sizes
 * and the View menu's "Arrange by" entries are all generated from it.
 */
function columnsFor(recycle: boolean): Column[] {
  return recycle
    ? [
        { key: 'name', label: 'Name', width: 'minmax(0, 1.4fr)' },
        { key: 'origin', label: 'Original Location', width: 'minmax(0, 1fr)', hideBelow: 760 },
        { key: 'modified', label: 'Date Deleted', width: '116px', hideBelow: 430 },
        { key: 'kind', label: 'Type', width: '104px', hideBelow: 580 },
        { key: 'size', label: 'Size', width: '74px', align: 'right' },
      ]
    : [
        { key: 'name', label: 'Name', width: 'minmax(0, 1fr)' },
        { key: 'modified', label: 'Date modified', width: '104px', hideBelow: 420 },
        { key: 'kind', label: 'Type', width: '116px', hideBelow: 720 },
        { key: 'size', label: 'Size', width: '78px', align: 'right' },
      ];
}

/** A stable empty listing, so `useOrigins` is not handed a fresh array on every render. */
const EMPTY: VfsNode[] = [];

/**
 * Where each trashed node came from, resolved once per distinct folder.
 *
 * `trashedFrom` is the id of the folder a node was thrown away from — enough for restore to put it
 * back, but not something a person can read. This turns those ids into paths, caching by id because
 * a folder emptied of twenty files is twenty rows sharing one answer.
 */
function useOrigins(nodes: VfsNode[]): Map<string, string> {
  const [paths, setPaths] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    const wanted = [...new Set(nodes.map((node) => node.trashedFrom).filter(Boolean))] as string[];
    if (wanted.length === 0) return;
    let cancelled = false;

    void (async () => {
      const resolved = await Promise.all(
        wanted.map(async (id) => {
          try {
            const chain = await vfs.pathOf(id);
            return [
              id,
              chain.map((node, i) => (i === 0 ? 'Home' : node.name)).join(' \\ '),
            ] as const;
          } catch {
            // The folder it came from was itself deleted. Restore still works — it recreates the
            // path — so the honest label is that we cannot name it, not that it is gone.
            return [id, '—'] as const;
          }
        }),
      );
      if (!cancelled) setPaths(new Map(resolved));
    })();

    return () => {
      cancelled = true;
    };
  }, [nodes]);

  return paths;
}

export function Explorer({ windowId, args }: AppProps) {
  const initial = (args as ExplorerArgs | undefined) ?? {};
  /*
   * Where we are, and how we got here.
   *
   * One piece of state rather than a stack and an index side by side: they are only ever meaningful
   * together, and two `useState` calls can be updated out of step by a handler that returns early
   * between them.
   */
  const [nav, setNav] = useState<{ stack: string[]; index: number }>(() => ({
    stack: [initial.directoryId ?? ROOT_ID],
    index: 0,
  }));
  const directoryId = nav.stack[nav.index] ?? ROOT_ID;
  const [selection, setSelection] = useState<Set<string>>(
    new Set(initial.selectId ? [initial.selectId] : []),
  );
  const [cursor, setCursor] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Which of the two things this window is looking at. See the note at the top of the file. */
  const [recycle, setRecycle] = useState(initial.recycle ?? false);
  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [filter, setFilter] = useState(initial.search ?? '');
  /**
   * Whether the search box is filtering this folder by name or searching inside every file.
   *
   * One box for both, as a file manager has: typing narrows the folder you are looking at, and
   * Enter widens it to everything. The mode is separate from the text so that editing a search does
   * not drop you back into the folder with every keystroke.
   */
  const [searching, setSearching] = useState(
    Boolean(initial.search?.trim()) && !(initial.recycle ?? false),
  );
  const searchBox = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const rootRef = useRef<HTMLDivElement>(null);
  const [appWidth, setAppWidth] = useState(0);

  /*
   * Measured by hand before the first paint, then watched — the same shape `Desktop.tsx` uses for
   * the window area, and for the same reason.
   *
   * A `ResizeObserver` alone delivers its first callback after a frame has already been painted, so
   * the columns would be chosen from a guessed width and then corrected: open a narrow window and
   * you would watch two columns appear and leave again. `useLayoutEffect` runs before the browser
   * paints, so the corrected set is the only one ever on screen.
   *
   * A zero is not a measurement — it is what a detached or hidden box reports — so the width stays
   * at zero until a real one arrives, and zero renders the columns that never hide.
   */
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const measure = (width: number) => {
      if (width > 1) setAppWidth(Math.round(width));
    };

    measure(element.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width;
      if (width !== undefined) measure(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const listing = useDirectory(recycle ? null : directoryId);
  const trash = useTrash();
  // The places pane lists the top of the file system, so it watches the root whatever folder is
  // open. A second subscription rather than a snapshot: a folder created anywhere should appear
  // here without this app being told.
  const rootListing = useDirectory(ROOT_ID);
  const path = usePath(recycle ? null : directoryId);
  const containerRef = useRef<HTMLDivElement>(null);

  const origins = useOrigins(recycle ? trash.nodes : EMPTY);
  /*
   * Which columns fit is decided here rather than in CSS, and that is a correction.
   *
   * It used to be a container query that hid cells and swapped a track-list variable. The two have
   * to agree exactly — hide a cell without dropping its track and every column after it slides one
   * place along, still perfectly aligned with the header and describing the wrong thing. Deciding
   * once, from a measured width, means the header, the rows and the track list cannot disagree
   * because there is only one decision.
   */
  const columns = useMemo(
    () => columnsFor(recycle).filter((column) => !column.hideBelow || appWidth >= column.hideBelow),
    [recycle, appWidth],
  );
  // 22px for the icon, then the columns, then the gutter the indexed mark sits in.
  const tracks = `22px ${columns.map((column) => column.width).join(' ')} 20px`;

  const nodes = useMemo(() => {
    const source = recycle ? trash.nodes : listing.nodes;
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? source.filter((node) => node.name.toLowerCase().includes(needle))
      : source;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      // Folders always lead, whatever the sort: it is the one ordering rule people rely on, and it
      // survives the direction flip too — reversing Size must not bury the folders at the bottom.
      const kindDelta = Number(b.kind === 'directory') - Number(a.kind === 'directory');
      if (kindDelta !== 0) return kindDelta;
      // Name is the tiebreak everywhere, so equal sizes or a shared type stay in a stable order
      // rather than shuffling as the listing updates.
      const byName = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      switch (sort) {
        case 'size':
          return (a.size - b.size) * sortDir || byName;
        case 'modified':
          return (a.modifiedAt - b.modifiedAt) * sortDir || byName;
        case 'origin':
          return (
            (origins.get(a.trashedFrom ?? '') ?? '').localeCompare(
              origins.get(b.trashedFrom ?? '') ?? '',
            ) * sortDir || byName
          );
        case 'kind':
          return typeLabel(a).localeCompare(typeLabel(b)) * sortDir || byName;
        default:
          return byName * sortDir;
      }
    });
    return sorted;
  }, [recycle, trash.nodes, listing.nodes, filter, sort, sortDir, origins]);

  const virtual = useVirtualList(nodes.length, ROW_HEIGHT);

  const places = useMemo(
    () => rootListing.nodes.filter((node) => node.kind === 'directory'),
    [rootListing.nodes],
  );

  /* Navigation ------------------------------------------------------------------------------ */

  const navigate = useCallback((id: string) => {
    // Navigating anywhere leaves the bin, the same way it does in the thing being imitated.
    setRecycle(false);
    setSearching(false);
    setNav((current) => {
      if (current.stack[current.index] === id) return current;
      // Going somewhere new discards what "forward" used to mean, which is what every file manager
      // and browser does — the branch you did not take is not somewhere you can still return to.
      const stack = [...current.stack.slice(0, current.index + 1), id];
      return { stack, index: stack.length - 1 };
    });
  }, []);

  // Back from search results is the folder they were searched from, not the one before it.
  const back = useCallback(() => {
    if (searching) {
      setSearching(false);
      return;
    }
    setNav((c) => (c.index > 0 ? { ...c, index: c.index - 1 } : c));
  }, [searching]);
  const forward = useCallback(
    () => setNav((c) => (c.index < c.stack.length - 1 ? { ...c, index: c.index + 1 } : c)),
    [],
  );
  const canBack = nav.index > 0 || searching;
  const canForward = nav.index < nav.stack.length - 1;

  /* A column header both chooses the column and, on a second click, reverses it. */
  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sort === key) {
        setSortDir((current) => (current === 1 ? -1 : 1));
        return;
      }
      setSort(key);
      // Each column opens the way that column is usually read: names A to Z, sizes and dates
      // biggest and newest first.
      setSortDir(key === 'name' || key === 'kind' || key === 'origin' ? 1 : -1);
    },
    [sort],
  );

  /* Keep the window title in step with where we are. */
  useEffect(() => {
    if (recycle) {
      setWindowTitle(windowId, 'Recycle Bin');
      return;
    }
    if (searching) {
      setWindowTitle(windowId, 'Search Results');
      return;
    }
    const title = path.at(-1)?.name ?? 'Files';
    setWindowTitle(windowId, title === 'Home' ? 'Files' : title);
  }, [windowId, path, recycle, searching]);

  useEffect(() => {
    if (initial.search !== undefined) searchBox.current?.focus();
    // Once, on open: it is the caller asking for the box, not a standing instruction.
  }, []);

  const searchEverything = useCallback(() => {
    setSelection(new Set());
    setSearching(true);
  }, []);

  /*
   * Moving to another folder starts with nothing selected. Only moving, though: an effect also runs
   * when the window first mounts, and resetting then threw away the `selectId` a caller had asked
   * for — so "show it in Files" opened the right folder with nothing highlighted, for every caller.
   *
   * Compared against what was last shown rather than skipped once with a flag, because development
   * builds run mount effects twice. A skip-once flag is spent by the first run and the second clears
   * the selection anyway; a comparison gives the same answer however often it is asked.
   */
  const shown = useRef({ directoryId, recycle });
  useEffect(() => {
    if (shown.current.directoryId === directoryId && shown.current.recycle === recycle) return;
    shown.current = { directoryId, recycle };
    setCursor(0);
    setSelection(new Set());
  }, [directoryId, recycle]);

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

  /* What the second status panel weighs: the selection, or the whole listing. */
  const shownBytes = (selection.size > 0 ? selectedNodes : nodes).reduce(
    (sum, node) => sum + node.size,
    0,
  );

  /* Actions --------------------------------------------------------------------------------- */

  const open = useCallback(
    (node: VfsNode) => {
      // In the bin, the double-click action is restore: nothing in there is meant to be opened
      // where it currently is.
      if (recycle) {
        void restoreSelectedRef.current();
        return;
      }
      if (node.kind === 'directory') navigate(node.id);
      else openFile(node);
    },
    [navigate, recycle],
  );

  /* `open` is built before the actions are, and only ever calls this after a click. */
  const restoreSelectedRef = useRef<() => Promise<void>>(async () => {});

  const goUp = useCallback(() => {
    const parent = path.at(-2);
    if (parent) navigate(parent.id);
  }, [path, navigate]);

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

  /* The clipboard --------------------------------------------------------------------------- */

  const clipboard = useFileClipboard();
  /* Cut items are drawn ghosted until they are pasted somewhere or the cut is abandoned. */
  const cutIds = useMemo(
    () => new Set(clipboard?.mode === 'cut' ? clipboard.ids : []),
    [clipboard],
  );

  const copySelected = useCallback(
    () => copyFiles(selectedNodes.map((node) => node.id)),
    [selectedNodes],
  );

  const cutSelected = useCallback(
    () => cutFiles(selectedNodes.map((node) => node.id)),
    [selectedNodes],
  );

  const pasteInto = useCallback(
    async (targetId: string) => {
      try {
        const landed = await pasteFiles(targetId);
        // What arrived is selected, the way a new folder is — but only if it arrived in this view.
        if (targetId === directoryId && landed.length > 0) {
          setSelection(new Set(landed.map((node) => node.id)));
        }
      } catch (error) {
        notifyError('Could not paste', error);
      }
    },
    [directoryId],
  );

  const restoreSelected = useCallback(async () => {
    if (selectedNodes.length === 0) return;
    try {
      const ids = selectedNodes.map((node) => node.id);
      await vfs.restore(ids);
      setSelection(new Set());
      notify({
        title: `Restored ${ids.length} item${ids.length === 1 ? '' : 's'}`,
        body: 'Each one went back where it was thrown away from.',
        level: 'success',
      });
    } catch (error) {
      notifyError('Could not restore', error);
    }
  }, [selectedNodes]);

  const deleteSelected = useCallback(async () => {
    if (selectedNodes.length === 0) return;
    const names = selectedNodes.map((node) => node.name).join(', ');
    // The one action on this desktop with no undo, so it is the one action that asks.
    if (
      !confirm(
        `Permanently delete ${selectedNodes.length} item(s)?\n\n${names}\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      const result = await vfs.deleteForever(selectedNodes.map((node) => node.id));
      setSelection(new Set());
      notify({
        title: `Deleted ${result.nodes.length} item${result.nodes.length === 1 ? '' : 's'}`,
        ...(result.blobs > 0
          ? { body: `${result.blobs} stored file${result.blobs === 1 ? '' : 's'} freed` }
          : {}),
        level: 'info',
      });
    } catch (error) {
      notifyError('Could not delete', error);
    }
  }, [selectedNodes]);

  const emptyBin = useCallback(async () => {
    if (trash.nodes.length === 0) return;
    if (!confirm('Permanently delete everything in the Recycle Bin?\n\nThis cannot be undone.'))
      return;
    try {
      const result = await vfs.emptyTrash();
      setSelection(new Set());
      notify({ title: `Emptied the Recycle Bin (${result.nodes.length} items)`, level: 'info' });
    } catch (error) {
      notifyError('Could not empty the Recycle Bin', error);
    }
  }, [trash.nodes.length]);

  restoreSelectedRef.current = restoreSelected;

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
          if (!recycle) goUp();
          break;
        case 'F2': {
          event.preventDefault();
          const node = nodes[cursor];
          if (node && !recycle) setRenaming(node.id);
          break;
        }
        case 'Delete':
          event.preventDefault();
          void (recycle ? deleteSelected() : trashSelected());
          break;
        case 'a':
        case 'A':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            setSelection(new Set(nodes.map((node) => node.id)));
          }
          break;
        /*
         * Bound here, on the list, rather than on the window: a text field anywhere else in the app
         * keeps its own Ctrl+C, and so does the rename box inside a row, which is why the whole
         * handler stands down while renaming. The Recycle Bin gets none of the three — nothing can
         * be pasted into it, and its items only ever leave by being restored.
         */
        case 'c':
        case 'C':
          if ((event.ctrlKey || event.metaKey) && !recycle) {
            event.preventDefault();
            copySelected();
          }
          break;
        case 'x':
        case 'X':
          if ((event.ctrlKey || event.metaKey) && !recycle) {
            event.preventDefault();
            cutSelected();
          }
          break;
        case 'v':
        case 'V':
          if ((event.ctrlKey || event.metaKey) && !recycle) {
            event.preventDefault();
            void pasteInto(directoryId);
          }
          break;
        case 'Escape':
          // Only when there is a cut to abandon; otherwise Escape belongs to whatever is above this.
          if (clipboard?.mode === 'cut') {
            event.preventDefault();
            event.stopPropagation();
            cancelCut();
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
      goUp,
      trashSelected,
      recycle,
      deleteSelected,
      copySelected,
      cutSelected,
      pasteInto,
      directoryId,
      clipboard,
    ],
  );

  /* Menus ----------------------------------------------------------------------------------- */

  /*
   * File, Edit, View, Help — the same four in both contexts, because the bar is part of the window
   * rather than part of what the window is showing. What changes is what is on them: File offers
   * Restore and Empty in the bin and New folder and Import outside it, and View names the columns
   * that context actually has.
   */
  const menus: MenuBarMenu[] = [
    {
      id: 'file',
      label: 'File',
      items: () =>
        recycle
          ? [
              {
                id: 'file.restore',
                label: 'Restore',
                // Bold: it is what double-clicking a row already does.
                primary: true,
                disabled: selection.size === 0,
                run: () => void restoreSelected(),
              },
              {
                id: 'file.delete',
                label: 'Delete',
                disabled: selection.size === 0,
                danger: true,
                run: () => void deleteSelected(),
              },
              separator('file.s1'),
              {
                id: 'file.empty',
                label: 'Empty Recycle Bin',
                disabled: trash.nodes.length === 0,
                danger: true,
                run: () => void emptyBin(),
              },
              separator('file.s2'),
              { id: 'file.close', label: 'Close', run: () => closeWindow(windowId) },
            ]
          : [
              { id: 'file.new', label: 'New folder', run: () => void newFolder() },
              {
                id: 'file.import',
                label: 'Import…',
                run: async () => {
                  const entries = await pickFiles();
                  await runImport(entries, `Import ${entries.length} file(s)`);
                },
              },
              separator('file.s1'),
              {
                id: 'file.rename',
                label: 'Rename',
                shortcut: 'F2',
                disabled: selection.size !== 1,
                run: () => selectedNodes[0] && setRenaming(selectedNodes[0].id),
              },
              {
                id: 'file.trash',
                label: 'Move to Recycle Bin',
                shortcut: 'Del',
                disabled: selection.size === 0,
                danger: true,
                run: () => void trashSelected(),
              },
              separator('file.s2'),
              { id: 'file.close', label: 'Close', run: () => closeWindow(windowId) },
            ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: () => [
        !recycle && {
          id: 'edit.cut',
          label: 'Cut',
          shortcut: 'Ctrl+X',
          disabled: selection.size === 0,
          run: cutSelected,
        },
        !recycle && {
          id: 'edit.copy',
          label: 'Copy',
          shortcut: 'Ctrl+C',
          disabled: selection.size === 0,
          run: copySelected,
        },
        // Greyed while the clipboard is empty, and live the moment it is not — a real feature in its
        // off state, rather than a row that is permanently grey.
        !recycle && {
          id: 'edit.paste',
          label: 'Paste',
          shortcut: 'Ctrl+V',
          disabled: clipboard === null,
          run: () => void pasteInto(directoryId),
        },
        separator('edit.s1'),
        {
          id: 'edit.all',
          label: 'Select All',
          shortcut: 'Ctrl+A',
          disabled: nodes.length === 0,
          run: () => setSelection(new Set(nodes.map((node) => node.id))),
        },
        {
          id: 'edit.invert',
          label: 'Invert Selection',
          disabled: nodes.length === 0,
          run: () =>
            setSelection((current) => {
              const next = new Set<string>();
              for (const node of nodes) if (!current.has(node.id)) next.add(node.id);
              return next;
            }),
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: () => [
        { id: 'view.icons', label: 'Icons', checked: view === 'grid', run: () => setView('grid') },
        {
          id: 'view.details',
          label: 'Details',
          checked: view === 'list',
          run: () => setView('list'),
        },
        separator('view.s1'),
        // The era called this "Arrange Icons by". The entries are this context's own columns, so a
        // sort stays reachable in Icons view where there are no headings to click.
        ...columnsFor(recycle).map((column) => ({
          id: `view.by.${column.key}`,
          label: `Arrange by ${column.label}`,
          checked: sort === column.key,
          run: () => toggleSort(column.key),
        })),
        separator('view.s2'),
        {
          id: 'view.refresh',
          label: 'Refresh',
          run: () => {
            if (recycle) trash.reload();
            else listing.reload();
            rootListing.reload();
          },
        },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: () => [
        {
          id: 'help.about',
          label: 'About Tabula',
          run: () => void launchApp('about', { args: { section: 'about' } }),
        },
      ],
    },
  ];

  const fileMenu = (node: VfsNode): MenuSpec => {
    const many = selection.size > 1;

    if (recycle) {
      return [
        {
          id: 'restore',
          label: many ? `Restore ${selection.size} items` : 'Restore',
          primary: true,
          run: () => void restoreSelected(),
        },
        separator('bin.s1'),
        {
          id: 'delete',
          label: many ? `Delete ${selection.size} items permanently` : 'Delete permanently',
          run: () => void deleteSelected(),
          danger: true,
        },
      ];
    }

    // "Open with" lists every app that claims the file, so a picture can go to the Viewer as
    // easily as to Photos. The first one is what plain Open already does, hence the slice.
    const openers = node.kind === 'file' ? appsFor(node) : [];

    return [
      {
        id: 'open',
        label: node.kind === 'directory' ? 'Open folder' : 'Open',
        run: () => open(node),
        disabled: many,
      },
      ...openers.slice(1).map((app) => ({
        id: `open.${app.id}`,
        label: `Open with ${app.name}`,
        run: () => void launchApp(app.id, { args: { fileId: node.id }, title: node.name }),
        disabled: many,
      })),
      separator('file.s1'),
      { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X', run: cutSelected },
      { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C', run: copySelected },
      node.kind === 'directory' && {
        id: 'pasteInto',
        label: 'Paste into folder',
        disabled: clipboard === null,
        run: () => void pasteInto(node.id),
      },
      separator('file.clip'),
      {
        id: 'rename',
        label: 'Rename',
        shortcut: 'F2',
        run: () => setRenaming(node.id),
        disabled: many,
      },
      isWallpaperCandidate(node) && {
        id: 'wallpaper',
        label: 'Set as desktop wallpaper',
        run: () => setWallpaperFromFile(node.id, node.name),
        disabled: many,
      },
      separator('file.s2'),
      {
        id: 'trash',
        label: many ? `Move ${selection.size} items to Trash` : 'Move to Trash',
        shortcut: 'Del',
        run: () => void trashSelected(),
        danger: true,
      },
    ];
  };

  /* The menu for the empty space below the files, which is about the folder rather than a file. */
  /*
   * The same menu opens in the Recycle Bin, which is a view rather than a folder. Anything that
   * creates or pastes acts on `directoryId` — a folder the bin is not showing — so there it would put
   * things somewhere the user cannot see from where they asked. The bin offers what it can act on.
   */
  const folderMenu = (): MenuSpec => [
    !recycle && { id: 'folder.new', label: 'New folder', run: () => void newFolder() },
    !recycle && {
      id: 'folder.import',
      label: 'Import files…',
      run: () => {
        void pickFiles().then((entries) => {
          if (entries.length > 0) void runImport(entries, 'Import');
        });
      },
    },
    recycle && {
      id: 'folder.empty',
      label: 'Empty Recycle Bin',
      disabled: trash.nodes.length === 0,
      danger: true,
      run: () => void emptyBin(),
    },
    separator('folder.s1'),
    !recycle && {
      id: 'folder.paste',
      label: 'Paste',
      shortcut: 'Ctrl+V',
      disabled: clipboard === null,
      run: () => void pasteInto(directoryId),
    },
    separator('folder.s2'),
    {
      id: 'folder.selectAll',
      label: 'Select all',
      shortcut: 'Ctrl+A',
      run: () => setSelection(new Set(nodes.map((entry) => entry.id))),
      disabled: nodes.length === 0,
    },
  ];

  /* Render ---------------------------------------------------------------------------------- */

  const empty = !listing.loading && nodes.length === 0;

  return (
    <div
      ref={rootRef}
      className={`${styles.app} ${dropActive ? styles.dropping : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false);
      }}
      onDrop={onDrop}
    >
      {/*
        Two bars, not one.

        Everything used to live in a single row that wrapped, and a row of controls that reflows into
        a column is the shape of a phone app rather than a file manager. Where you are and how you
        move goes on top; what you can do to what is selected goes underneath. Neither wraps — below
        the width they need the command bar sheds its labels and the places pane leaves, which is
        what a desktop does instead of stacking.

        There is no Refresh button, though both explorers this is modelled on have one. The listing
        is a live subscription: it is already correct, and a button that redraws what is on screen
        would be a control that does nothing.
      */}
      <MenuBar menus={menus} label={recycle ? 'Recycle Bin' : 'Files'} />

      <div className={styles.navRow}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={back}
          disabled={!canBack}
          aria-label="Back"
          title="Back"
        >
          <Icon name="arrow-left" size={16} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={forward}
          disabled={!canForward}
          aria-label="Forward"
          title="Forward"
        >
          {/* The same glyph turned around, so the pair can never drift apart. */}
          <Icon name="arrow-left" size={16} className={styles.flip} />
        </button>
        {/*
          Refresh really refetches. The listing is a live subscription, so it is almost always
          already correct and this will redraw the same rows — but `reload()` goes back to the
          worker for them rather than redrawing what is in memory, which is the difference between
          a button that does something and a button that looks like it does.

          It stands where the parent-folder button did. Going up is not lost: Backspace still does
          it, and the breadcrumb above is a row of buttons to every ancestor.
        */}
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => {
            if (recycle) trash.reload();
            else listing.reload();
            rootListing.reload();
          }}
          aria-label="Refresh this folder"
          title="Refresh"
        >
          <Icon name="refresh" size={16} />
        </button>

        <nav className={styles.address} aria-label="Location">
          {recycle ? (
            <span className={styles.crumbCurrent}>
              <Icon name="trash" size={14} /> Recycle Bin
            </span>
          ) : searching ? (
            <span className={styles.crumbCurrent}>
              <Icon name="search" size={14} /> Search Results
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
                    onClick={() => navigate(node.id)}
                  >
                    {node.id === ROOT_ID ? 'Home' : node.name}
                  </button>
                )}
              </span>
            ))
          )}
        </nav>

        <input
          ref={searchBox}
          className={styles.filter}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !recycle && filter.trim()) {
              event.preventDefault();
              searchEverything();
            } else if (event.key === 'Escape' && (filter || searching)) {
              event.preventDefault();
              setFilter('');
              setSearching(false);
            }
          }}
          placeholder={recycle ? 'Search the Recycle Bin' : 'Search'}
          aria-label={
            recycle
              ? 'Filter the Recycle Bin by name'
              : 'Search: type to filter this folder by name, press Enter to search inside every file'
          }
          type="search"
        />
      </div>

      <div
        className={styles.commandBar}
        role="toolbar"
        aria-label={recycle ? 'Recycle Bin actions' : 'File actions'}
      >
        {recycle ? (
          <>
            <button
              type="button"
              className={styles.button}
              onClick={() => void restoreSelected()}
              disabled={selection.size === 0}
              title="Put the selected items back where they came from"
            >
              <Icon name="restore" size={15} />
              <span className={styles.buttonLabel}>Restore</span>
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => void deleteSelected()}
              disabled={selection.size === 0}
              title="Delete the selected items permanently (Delete)"
            >
              <Icon name="close" size={15} />
              <span className={styles.buttonLabel}>Delete</span>
            </button>

            <span className={styles.commandDivider} aria-hidden />

            <button
              type="button"
              className={styles.button}
              onClick={() => void emptyBin()}
              disabled={trash.nodes.length === 0}
              title="Delete everything in the Recycle Bin permanently"
            >
              <Icon name="trash" size={15} />
              <span className={styles.buttonLabel}>Empty Recycle Bin</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.button} onClick={newFolder}>
              <Icon name="plus" size={15} />
              <span className={styles.buttonLabel}>New folder</span>
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={async () => {
                const entries = await pickFiles();
                await runImport(entries, `Import ${entries.length} file(s)`);
              }}
            >
              <Icon name="upload" size={15} />
              <span className={styles.buttonLabel}>Import</span>
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

            <span className={styles.commandDivider} aria-hidden />

            <button
              type="button"
              className={styles.iconButton}
              onClick={cutSelected}
              disabled={selection.size === 0}
              title="Cut (Ctrl+X)"
              aria-label="Cut"
            >
              <Icon name="cut" size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={copySelected}
              disabled={selection.size === 0}
              title="Copy (Ctrl+C)"
              aria-label="Copy"
            >
              <Icon name="copy" size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void pasteInto(directoryId)}
              disabled={clipboard === null}
              title="Paste (Ctrl+V)"
              aria-label="Paste"
            >
              <Icon name="paste" size={16} />
            </button>

            <span className={styles.commandDivider} aria-hidden />

            <button
              type="button"
              className={styles.iconButton}
              onClick={() => selectedNodes[0] && setRenaming(selectedNodes[0].id)}
              disabled={selection.size !== 1}
              title="Rename (F2)"
              aria-label="Rename"
            >
              <Icon name="edit" size={16} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void trashSelected()}
              disabled={selection.size === 0}
              title="Move to Recycle Bin (Delete)"
              aria-label="Move to Recycle Bin"
            >
              <Icon name="trash" size={16} />
            </button>
          </>
        )}

        <span className={styles.commandSpacer} />

        <select
          className={styles.sort}
          value={sort}
          onChange={(event) => toggleSort(event.target.value as SortKey)}
          aria-label="Sort by"
        >
          <option value="name">Name</option>
          <option value="modified">Date modified</option>
          <option value="kind">Type</option>
          <option value="size">Size</option>
        </select>
      </div>

      <div className={styles.body}>
        {/*
          The places pane. Not a tree — a tree of one level is a list wearing a disclosure triangle,
          and every folder that matters at this depth is already here. Trash sits below a rule
          because it is a view of the file system rather than a folder in it.
        */}
        <nav className={styles.places} aria-label="Places">
          <button
            type="button"
            className={`${styles.place} ${
              !recycle && directoryId === ROOT_ID ? styles.placeActive : ''
            }`}
            onClick={() => navigate(ROOT_ID)}
            aria-current={!recycle && directoryId === ROOT_ID ? 'true' : undefined}
          >
            <Icon name="drive" size={15} />
            <span className={styles.placeName}>Home</span>
          </button>

          {places.map((node) => (
            <button
              key={node.id}
              type="button"
              className={`${styles.place} ${
                !recycle && directoryId === node.id ? styles.placeActive : ''
              }`}
              onClick={() => navigate(node.id)}
              aria-current={!recycle && directoryId === node.id ? 'true' : undefined}
            >
              <Icon name="folder" size={15} />
              <span className={styles.placeName}>{node.name}</span>
            </button>
          ))}
        </nav>

        <div className={styles.pane}>
          {searching ? (
            <ContentSearch query={filter} onQuery={setFilter} />
          ) : (
            <>
              {!recycle && filter.trim() ? (
                <button type="button" className={styles.searchOffer} onClick={searchEverything}>
                  <Icon name="search" size={14} />
                  <span>Search inside every file for “{filter.trim()}”</span>
                  <kbd>Enter</kbd>
                </button>
              ) : null}
              {/*
            The column header is what turns a list of rows into a table you can interrogate: it
            names what the two unlabelled columns of numbers were, and it is where sorting belongs.
            It only exists in list view, because a grid has no columns to head.
          */}
              {view === 'list' ? (
                <div className={styles.columns} style={{ gridTemplateColumns: tracks }}>
                  {/*
                No gutter cells at either end. The icon a row draws is part of what that row is
                called, so the Name heading covers it — which is what both file managers this is
                modelled on do, and why their header runs edge to edge instead of starting after a
                blank stub. The last heading absorbs the trailing track the same way. Everything
                between places itself, and the spans keep the columns on the tracks the rows use.
              */}
                  {columns.map((column, index) => (
                    <SortHeader
                      key={column.key}
                      column={column}
                      sort={sort}
                      dir={sortDir}
                      onSort={toggleSort}
                      span={index === 0 || index === columns.length - 1}
                    />
                  ))}
                </div>
              ) : null}

              <div
                className={view === 'list' ? styles.listScroll : styles.gridScroll}
                ref={view === 'list' ? virtual.ref : containerRef}
                onKeyDown={onKeyDown}
                onContextMenu={(event) => openMenu(event, folderMenu())}
                onClick={(event) => {
                  if (event.target === event.currentTarget) setSelection(new Set());
                }}
                tabIndex={0}
                role="listbox"
                aria-multiselectable
                aria-label={recycle ? 'Recycle Bin contents' : 'Folder contents'}
              >
                {empty ? (
                  <div className={styles.empty}>
                    {recycle ? (
                      <>
                        <Icon name="trash" size={26} />
                        <p>The Recycle Bin is empty.</p>
                        <p className={styles.emptyHint}>
                          Anything you throw away in Files waits here until you empty it.
                        </p>
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
                              columns={columns}
                              tracks={tracks}
                              origin={origins.get(node.trashedFrom ?? '')}
                              selected={selection.has(node.id)}
                              cut={cutIds.has(node.id)}
                              focused={index === cursor}
                              renaming={renaming === node.id}
                              onRename={(name) => void rename(node.id, name)}
                              onCancelRename={() => setRenaming(null)}
                              onPointerDown={(event) => selectAt(index, event)}
                              onDoubleClick={() => open(node)}
                              onContextMenu={(event) => {
                                if (!selection.has(node.id)) selectAt(index);
                                openMenu(event, fileMenu(node));
                              }}
                            />
                          );
                        })}
                    </div>
                  </div>
                ) : (
                  <div className={styles.grid}>
                    {nodes.map((node, index) => (
                      <Tile
                        key={node.id}
                        node={node}
                        origin={origins.get(node.trashedFrom ?? '')}
                        selected={selection.has(node.id)}
                        cut={cutIds.has(node.id)}
                        onPointerDown={(event) => selectAt(index, event)}
                        onDoubleClick={() => open(node)}
                        onContextMenu={(event) => {
                          if (!selection.has(node.id)) selectAt(index);
                          openMenu(event, fileMenu(node));
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/*
        Two panels, which is how this era's status bars were built: one fact each in its own well,
        rather than a single strip of text.
      */}
      <div className={styles.statusBar}>
        <span className={styles.statusPanel}>
          {searching
            ? 'Searching every file'
            : selection.size > 0
              ? `${selection.size} object(s) selected`
              : `${nodes.length} object(s)`}
        </span>
        <span className={`${styles.statusPanel} ${styles.statusSize}`}>
          {shownBytes > 0 ? formatBytes(shownBytes) : ''}
        </span>

        <span className={styles.statusSpacer} />

        <div className={styles.viewToggle} role="group" aria-label="View">
          <button
            type="button"
            className={`${styles.viewButton} ${view === 'list' ? styles.viewButtonActive : ''}`}
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            title="Details"
            aria-label="Details view"
          >
            <Icon name="list" size={15} />
          </button>
          <button
            type="button"
            className={`${styles.viewButton} ${view === 'grid' ? styles.viewButtonActive : ''}`}
            onClick={() => setView('grid')}
            aria-pressed={view === 'grid'}
            title="Icons"
            aria-label="Icon view"
          >
            <Icon name="grid" size={15} />
          </button>
        </div>
      </div>

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}

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

/** What one cell says. The header names the column; this fills it. */
function cellText(node: VfsNode, column: Column, origin: string | undefined): string {
  switch (column.key) {
    case 'origin':
      return origin ?? '…';
    case 'modified':
      return new Date(node.modifiedAt).toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    case 'kind':
      return typeLabel(node);
    case 'size':
      return node.kind === 'directory' ? '' : formatBytes(node.size);
    default:
      return node.name;
  }
}

/** What hovering a file tells you: the whole name, then the facts the columns abbreviate. */
function hoverLabel(node: VfsNode, origin: string | undefined): string {
  const when = new Date(node.modifiedAt).toLocaleString();
  const what =
    node.kind === 'directory' ? 'File folder' : `${typeLabel(node)} · ${formatBytes(node.size)}`;
  return [node.name, what, origin ? `From ${origin}` : null, when].filter(Boolean).join('\n');
}

/**
 * A grid tile.
 *
 * Draws the stored thumbnail for a picture, and the type icon for everything else. The thumbnails
 * already existed — a worker writes one for every image it indexes, and Photos has been drawing
 * them all along — so this is Files finally asking for what was already on disk rather than any
 * new machinery. Falling back to the icon rather than to the original is deliberate here: Photos
 * shows one folder of pictures, while Files shows folders of anything, and decoding a 4000-pixel
 * original for a 96-pixel tile is the stutter the thumbnails exist to avoid.
 */
function Tile({
  node,
  origin,
  selected,
  cut,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
}: {
  node: VfsNode;
  /*
   * Where a binned item came from, as a row is given it. Losing this prop would still compile: a bare
   * `origin` in this function resolves to the browser's own `window.origin`, and every tooltip would
   * quietly name the page's address instead.
   */
  origin: string | undefined;
  selected: boolean;
  cut: boolean;
  onPointerDown: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = node.kind === 'file' && node.mime.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    void (async () => {
      const thumb = await thumbnailUrl(node.id);
      if (!cancelled) setUrl(thumb);
    })();
    return () => {
      cancelled = true;
      // Nothing to revoke: thumbnail URLs are pooled and shared across every view that draws them.
    };
  }, [node.id, isImage]);

  return (
    <button
      type="button"
      className={`${styles.tile} ${selected ? styles.tileSelected : ''} ${cut ? styles.tileCut : ''}`}
      onClick={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={hoverLabel(node, origin)}
    >
      <span className={styles.tileArt}>
        {url ? (
          <img src={url} alt="" className={styles.tileImage} draggable={false} />
        ) : (
          <Icon name={iconForFile(node)} size={26} />
        )}
      </span>
      <span className={styles.tileName}>{node.name}</span>
    </button>
  );
}

/**
 * One column heading.
 *
 * A real button rather than a styled cell, because it is one: clicking sorts, and a keyboard has to
 * be able to reach it. `aria-sort` on the pressed column is what tells a screen reader which way
 * the list is ordered — the arrow says it to everyone else.
 */
function SortHeader({
  column,
  sort,
  dir,
  onSort,
  span,
}: {
  column: Column;
  sort: SortKey;
  dir: 1 | -1;
  onSort: (column: SortKey) => void;
  /** Covers the icon track at the start of the row, or the indexed one at the end. */
  span: boolean;
}) {
  const active = sort === column.key;
  return (
    <button
      type="button"
      className={`${styles.column} ${active ? styles.columnActive : ''} ${
        column.align === 'right' ? styles.columnRight : ''
      }`}
      // Which column this is, for the rules that drop one on a narrow window. A positional
      // selector would renumber itself the moment a column is added or hidden.
      data-col={column.key}
      style={span ? { gridColumn: 'span 2' } : undefined}
      onClick={() => onSort(column.key)}
      aria-sort={active ? (dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <span className={styles.columnLabel}>{column.label}</span>
      {active ? (
        <Icon
          name="chevron-down"
          size={12}
          className={`${styles.columnArrow} ${dir === 1 ? styles.flipY : ''}`}
        />
      ) : null}
    </button>
  );
}

interface FileRowProps {
  node: VfsNode;
  columns: Column[];
  tracks: string;
  origin: string | undefined;
  selected: boolean;
  cut: boolean;
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
  columns,
  tracks,
  origin,
  selected,
  cut,
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
      className={`${styles.row} ${selected ? styles.rowSelected : ''} ${focused ? styles.rowFocused : ''} ${cut ? styles.rowCut : ''}`}
      style={{ height: ROW_HEIGHT, gridTemplateColumns: tracks }}
      // A name column is the first thing to be truncated, and the row was the one place on this
      // desktop that could not tell you what it had cut off.
      title={hoverLabel(node, origin)}
      onMouseDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      role="option"
      aria-selected={selected}
    >
      <Icon name={iconForFile(node)} size={16} className={styles.rowIcon} />
      {columns.map((column) =>
        column.key === 'name' ? (
          renaming ? (
            <input
              key={column.key}
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
            <span key={column.key} className={styles.rowName}>
              {node.name}
            </span>
          )
        ) : (
          <span
            key={column.key}
            className={column.key === 'size' ? styles.rowMeta : styles.rowText}
            data-col={column.key}
          >
            {cellText(node, column, origin)}
          </span>
        ),
      )}
      {node.indexState === 'indexed' ? (
        <Icon name="sparkle" size={13} className={styles.rowIndexed} label="Indexed for search" />
      ) : (
        <span className={styles.rowIndexSpacer} />
      )}
    </div>
  );
}

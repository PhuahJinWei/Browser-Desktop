import { useCallback, useEffect, useRef, useState } from 'react';
import { launchApp, type AppProps } from '../../kernel/apps';
import { notifyError } from '../../kernel/notifications';
import { useSetting } from '../../kernel/settings';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, type VfsNode } from '../../kernel/vfs/types';
import { closeWindow, setWindowTitle } from '../../kernel/windows';
import { separator } from '../../shell/ContextMenu';
import { Icon } from '../../shell/Icon';
import { MenuBar, type MenuBarMenu } from '../../shell/MenuBar';
import { AppIcon } from '../../shell/PixelIcon';
import styles from './NotepadApp.module.css';

/**
 * Notepad.
 *
 * Writes Markdown files into a Notes folder in the file system — not into a private store. That is
 * the point: a note is an ordinary file, so it gets indexed, searched, opened in the Viewer and
 * trashed like anything else, with no special cases anywhere.
 *
 * Its shape follows the skin, because the two desktops' Notepads are different programs. Classic is
 * the 1990s one: one document per window, opened and switched with File ▸ Open, Search ▸ Find, no
 * status bar. Modern is the current one: documents as tabs along the top, Edit ▸ Find, and a status
 * bar with the caret's line and column. The notes list down the side that this app used to have
 * belonged to neither; Open is where the notes are listed now.
 *
 * **Saving is something the user does.** Explicit, with a flush on close underneath it, because a
 * browser tab cannot reliably stop a window closing to ask "save changes?". Closing a tab is the
 * same: the text is saved, never dropped. A new note is untitled and has no file until it has
 * something in it — an empty note closed is simply gone, rather than an empty file left behind.
 */

const NOTES_FOLDER = 'Notes';

interface NotepadArgs {
  fileId?: string;
  create?: boolean;
}

/** One open document: a tab under modern, the window's only document under classic. */
interface Doc {
  key: string;
  /** Null until an untitled document is first saved. */
  node: VfsNode | null;
  draft: string;
  /** What the file holds on disk. `draft !== baseline` is the whole definition of unsaved. */
  baseline: string;
}

let docCounter = 0;
const untitled = (): Doc => ({ key: `doc-${++docCounter}`, node: null, draft: '', baseline: '' });
const nameOf = (doc: Doc) => doc.node?.name ?? 'Untitled';
const isDirty = (doc: Doc) => doc.draft !== doc.baseline;

async function notesFolder(): Promise<string> {
  const children = await vfs.list(ROOT_ID);
  const existing = children.find((node) => node.kind === 'directory' && node.name === NOTES_FOLDER);
  return (existing ?? (await vfs.createDirectory(ROOT_ID, NOTES_FOLDER))).id;
}

export default function NotepadApp({ windowId, args }: AppProps) {
  const { fileId: initialFileId } = (args as NotepadArgs | undefined) ?? {};
  const classic = useSetting('skin') === 'classic';
  const [docs, setDocs] = useState<Doc[]>(() => [untitled()]);
  const [activeKey, setActiveKey] = useState(() => docs[0]!.key);
  const [saving, setSaving] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [dialog, setDialog] = useState<'open' | 'rename' | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const active = docs.find((doc) => doc.key === activeKey) ?? docs[0]!;
  const dirty = isDirty(active);

  /*
   * The latest documents, for the work that must not be rebuilt when they change: the flush on
   * close runs once, at unmount, and has to see the text as it is then rather than as it was when
   * the effect was set up.
   */
  const latest = useRef(docs);
  useEffect(() => {
    latest.current = docs;
  });

  const update = useCallback((key: string, patch: Partial<Doc>) => {
    setDocs((current) => current.map((doc) => (doc.key === key ? { ...doc, ...patch } : doc)));
  }, []);

  /* Open ------------------------------------------------------------------------------------- */

  /** Reads a file into a document. Resolves to null, having said why, when it cannot. */
  const load = useCallback(async (id: string): Promise<Doc | null> => {
    try {
      const node = await vfs.stat(id);
      if (!node) return null;
      const text = await vfs.readText(id);
      return { key: `doc-${++docCounter}`, node, draft: text, baseline: text };
    } catch (error) {
      notifyError('Could not open the note', error);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!initialFileId) return;
    void load(initialFileId).then((doc) => {
      if (!doc) return;
      setDocs([doc]);
      setActiveKey(doc.key);
    });
  }, [initialFileId, load]);

  useEffect(() => {
    setWindowTitle(windowId, `${dirty ? '*' : ''}${nameOf(active)} — Notepad`);
  }, [windowId, active, dirty]);

  /* Save ------------------------------------------------------------------------------------- */

  /**
   * Writes a document. An untitled one gets a file of its own in Notes, named for the day, and the
   * file system's own uniquing settles a second note on the same day.
   */
  const save = useCallback(
    async (doc: Doc): Promise<void> => {
      const text = doc.draft;
      setSaving(true);
      try {
        const data = new TextEncoder().encode(text).buffer as ArrayBuffer;
        let node: VfsNode;
        if (doc.node?.parentId) {
          node = await vfs.writeFile({
            parentId: doc.node.parentId,
            name: doc.node.name,
            data,
            mime: doc.node.mime || 'text/markdown',
            overwrite: true,
          });
        } else {
          const stamp = new Date().toLocaleDateString(undefined, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
          node = await vfs.writeFile({
            parentId: await notesFolder(),
            name: `Note ${stamp}.md`,
            data,
            mime: 'text/markdown',
          });
        }
        // The baseline describes the text written, not whatever has been typed since.
        update(doc.key, { node, baseline: text });
      } catch (error) {
        notifyError('Could not save the note', error);
      } finally {
        setSaving(false);
      }
    },
    [update],
  );

  /** Saves what would otherwise be lost. An untitled document with nothing in it is not kept. */
  const flush = useCallback(
    async (doc: Doc) => {
      if (!isDirty(doc)) return;
      if (doc.node === null && doc.draft.trim() === '') return;
      await save(doc);
    },
    [save],
  );

  const saveNow = useCallback(() => {
    if (dirty || active.node === null) void save(active);
  }, [active, dirty, save]);

  // The net: every open document is flushed when the window closes.
  useEffect(
    () => () => {
      for (const doc of latest.current) void flush(doc);
    },
    [flush],
  );

  /* Documents -------------------------------------------------------------------------------- */

  /** Shows a document: alongside the others under modern, instead of the current one under classic. */
  const show = useCallback(
    (doc: Doc) => {
      if (classic) {
        void flush(active);
        setDocs([doc]);
      } else {
        setDocs((current) => {
          const already = doc.node && current.find((open) => open.node?.id === doc.node?.id);
          if (already) {
            setActiveKey(already.key);
            return current;
          }
          // The tab you were on, if it is an untouched untitled one, gives way to what was opened.
          const keep = current.filter(
            (open) => !(open.key === activeKey && open.node === null && open.draft === ''),
          );
          return [...keep, doc];
        });
      }
      setActiveKey(doc.key);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [active, activeKey, classic, flush],
  );

  const newDocument = useCallback(() => show(untitled()), [show]);

  const openFile = useCallback(
    async (id: string) => {
      setDialog(null);
      const doc = await load(id);
      if (doc) show(doc);
      // A file that could not be read has said so; the keyboard goes back to the page either way.
      else textareaRef.current?.focus();
    },
    [load, show],
  );

  const closeDocument = useCallback(
    (key: string) => {
      const doc = docs.find((candidate) => candidate.key === key);
      if (!doc) return;
      void flush(doc);
      if (docs.length === 1) {
        closeWindow(windowId);
        return;
      }
      const index = docs.indexOf(doc);
      const remaining = docs.filter((candidate) => candidate.key !== key);
      setDocs(remaining);
      if (key === activeKey) setActiveKey(remaining[Math.max(0, index - 1)]!.key);
    },
    [docs, activeKey, flush, windowId],
  );

  const rename = useCallback(
    async (name: string) => {
      setDialog(null);
      const node = active.node;
      const trimmed = name.trim();
      if (!node || !trimmed) return;
      // A note that loses its extension stops being Markdown to every other app on the desktop, so
      // a bare name gets one back rather than being taken literally.
      const withSuffix = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
      try {
        update(active.key, { node: await vfs.rename(node.id, withSuffix) });
      } catch (error) {
        notifyError('Could not rename the note', error);
      }
    },
    [active, update],
  );

  /* Editing ---------------------------------------------------------------------------------- */

  const trackCaret = () => {
    const element = textareaRef.current;
    if (!element) return;
    const before = element.value.slice(0, element.selectionStart);
    const lines = before.split('\n');
    setCaret({ line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 });
  };

  /*
   * The caret moves without an event on the field itself when a different document's text is put
   * in it, or when Find selects a match. `selectionchange` is the one signal for every move,
   * whatever caused it, so the status bar reads from that rather than guessing when to look.
   */
  useEffect(() => {
    const onSelection = () => {
      const element = textareaRef.current;
      if (!element || document.activeElement !== element) return;
      const lines = element.value.slice(0, element.selectionStart).split('\n');
      setCaret({ line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 });
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  const selectAll = useCallback(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  /** Time/Date, stamped at the caret. Locale decides the format, as it does for the clock. */
  const insertTimeDate = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    const now = new Date();
    const stamp = `${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ${now.toLocaleDateString()}`;
    const from = element.selectionStart;
    const to = element.selectionEnd;
    update(active.key, { draft: active.draft.slice(0, from) + stamp + active.draft.slice(to) });
    // React writes the new value on the next commit, so the caret has to be placed after it.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(from + stamp.length, from + stamp.length);
    });
  }, [active, update]);

  /** Finds the next match after the caret, wrapping to the top, and selects it. */
  const findNext = useCallback(() => {
    const element = textareaRef.current;
    if (!element || !findText) return;
    const haystack = element.value.toLowerCase();
    const needle = findText.toLowerCase();
    let at = haystack.indexOf(needle, element.selectionEnd);
    if (at === -1) at = haystack.indexOf(needle);
    if (at === -1) return;
    element.focus();
    element.setSelectionRange(at, at + needle.length);
    trackCaret();
  }, [findText]);

  /* Menu bar --------------------------------------------------------------------------------- */

  /*
   * Rebuilt per render on purpose — every entry's label, checked state and disabled state is read
   * from the state above, and a menu that was memoised would describe the document open when it
   * was built. They are thunks so that only the one being opened is ever constructed.
   *
   * Find lives where each desktop put it: a Search menu of its own under classic, inside Edit under
   * modern. Time/Date shows no accelerator: the original bound it to F5, and taking F5 away from
   * someone trying to reload a web page is not a period detail worth having.
   */
  const find = [
    { id: 'find.find', label: 'Find…', shortcut: 'Ctrl+F', run: () => setFindOpen(true) },
    { id: 'find.next', label: 'Find Next', shortcut: 'F3', disabled: !findText, run: findNext },
  ];

  const menuBar: MenuBarMenu[] = [
    {
      id: 'file',
      label: 'File',
      items: () => [
        { id: 'file.new', label: classic ? 'New' : 'New tab', run: newDocument },
        { id: 'file.open', label: 'Open…', shortcut: 'Ctrl+O', run: () => setDialog('open') },
        {
          id: 'file.save',
          label: 'Save',
          shortcut: 'Ctrl+S',
          disabled: !dirty && active.node !== null,
          run: saveNow,
        },
        {
          id: 'file.rename',
          label: 'Rename…',
          shortcut: 'F2',
          disabled: active.node === null,
          run: () => setDialog('rename'),
        },
        separator('file.s1'),
        {
          id: 'file.reveal',
          label: 'Show in Files',
          disabled: !active.node?.parentId,
          run: () => {
            const node = active.node;
            if (!node?.parentId) return;
            launchApp('files', {
              args: { directoryId: node.parentId, selectId: node.id },
              title: 'Files',
            });
          },
        },
        separator('file.s2'),
        classic
          ? { id: 'file.exit', label: 'Exit', run: () => closeWindow(windowId) }
          : { id: 'file.closeTab', label: 'Close tab', run: () => closeDocument(active.key) },
        !classic && { id: 'file.close', label: 'Close window', run: () => closeWindow(windowId) },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: () => [
        { id: 'edit.selectAll', label: 'Select All', shortcut: 'Ctrl+A', run: selectAll },
        { id: 'edit.timeDate', label: 'Time/Date', run: insertTimeDate },
        ...(classic
          ? [
              separator('edit.s1'),
              {
                id: 'edit.wrap',
                label: 'Word Wrap',
                checked: wordWrap,
                run: () => setWordWrap((on) => !on),
              },
            ]
          : [separator('edit.s1'), ...find]),
      ],
    },
    ...(classic
      ? [{ id: 'search', label: 'Search', items: () => find }]
      : [
          {
            id: 'view',
            label: 'View',
            items: () => [
              {
                id: 'view.wrap',
                label: 'Word wrap',
                checked: wordWrap,
                run: () => setWordWrap((on) => !on),
              },
            ],
          },
        ]),
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

  /* Keyboard --------------------------------------------------------------------------------- */

  const onKeyDown = (event: React.KeyboardEvent) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    // Each of these would otherwise reach the browser and act on the page rather than the note.
    if (ctrl && key === 's') {
      event.preventDefault();
      saveNow();
    } else if (ctrl && key === 'o') {
      event.preventDefault();
      setDialog('open');
    } else if (ctrl && key === 'f') {
      event.preventDefault();
      setFindOpen(true);
    } else if (event.key === 'F3') {
      event.preventDefault();
      findNext();
    } else if (event.key === 'F2' && active.node) {
      event.preventDefault();
      setDialog('rename');
    }
  };

  /* Render ----------------------------------------------------------------------------------- */

  return (
    <div className={styles.app} onKeyDown={onKeyDown}>
      {classic ? null : (
        <div className={styles.tabs} role="tablist" aria-label="Open notes">
          {docs.map((doc) => (
            <div
              key={doc.key}
              className={`${styles.tab} ${doc.key === active.key ? styles.tabActive : ''}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={doc.key === active.key}
                className={styles.tabLabel}
                onClick={() => setActiveKey(doc.key)}
                title={nameOf(doc)}
              >
                {nameOf(doc)}
              </button>
              {/* A dot for unsaved, as the current Notepad marks a tab; it is the close button's place. */}
              <button
                type="button"
                className={styles.tabClose}
                aria-label={`Close ${nameOf(doc)}`}
                onClick={() => closeDocument(doc.key)}
              >
                {isDirty(doc) ? <span className={styles.unsavedDot} aria-hidden /> : null}
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.newTab}
            aria-label="New tab"
            title="New tab"
            onClick={newDocument}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      )}

      <MenuBar menus={menuBar} label="Notepad" />

      {findOpen ? (
        <div className={styles.findBar} role="search">
          <label className={styles.findLabel}>
            Find what:
            <input
              autoFocus
              className={styles.findInput}
              value={findText}
              onChange={(event) => setFindText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  findNext();
                } else if (event.key === 'Escape') {
                  event.stopPropagation();
                  setFindOpen(false);
                  textareaRef.current?.focus();
                }
              }}
            />
          </label>
          <button
            type="button"
            className={styles.findButton}
            onClick={findNext}
            disabled={!findText}
          >
            Find Next
          </button>
          <button
            type="button"
            className={styles.findButton}
            onClick={() => {
              setFindOpen(false);
              textareaRef.current?.focus();
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className={styles.editor}
        value={active.draft}
        onChange={(event) => {
          update(active.key, { draft: event.target.value });
          trackCaret();
        }}
        onKeyUp={trackCaret}
        onClick={trackCaret}
        onFocus={trackCaret}
        onSelect={trackCaret}
        wrap={wordWrap ? 'soft' : 'off'}
        spellCheck={!classic}
        autoFocus
        aria-label={`${nameOf(active)} text`}
      />

      {/* The 1990s Notepad had no status bar; the current one has one, and this is its content. */}
      {classic ? null : (
        <div className={styles.statusBar}>
          <span>
            Ln {caret.line}, Col {caret.column}
          </span>
          <span>{active.draft.length.toLocaleString()} characters</span>
          <span className={styles.statusRight}>{saving ? 'Saving…' : dirty ? 'Unsaved' : ''}</span>
          <span>Markdown</span>
          <span>UTF-8</span>
        </div>
      )}

      {dialog === 'open' ? (
        <OpenDialog onOpen={(id) => void openFile(id)} onCancel={() => setDialog(null)} />
      ) : null}
      {dialog === 'rename' && active.node ? (
        <RenameDialog
          name={active.node.name}
          onRename={(name) => void rename(name)}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Dialogs                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/**
 * Open: every text file on the desktop, newest first.
 *
 * Both desktops' Notepads open through a file dialog, and this is that dialog reduced to what this
 * file system needs — it is small and flat enough that a list of every note beats a folder tree.
 */
function OpenDialog({ onOpen, onCancel }: { onOpen: (id: string) => void; onCancel: () => void }) {
  const [files, setFiles] = useState<VfsNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [folders, setFolders] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void vfs.allNodes().then((nodes) => {
      const text = nodes
        .filter(
          (node) =>
            node.kind === 'file' &&
            !node.trashed &&
            (node.mime.startsWith('text/') || /\.(md|txt)$/i.test(node.name)),
        )
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
      setFolders(
        new Map(
          nodes
            .filter((node) => node.kind === 'directory')
            .map((node) => [node.id, node.id === ROOT_ID ? 'Home' : node.name]),
        ),
      );
      setFiles(text);
      setSelected(text[0]?.id ?? null);
    });
  }, []);

  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (files?.length)
      listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [files]);

  // Focus follows the selection once it has rendered, while the keyboard is in the list.
  useEffect(() => {
    const list = listRef.current;
    if (list?.contains(document.activeElement)) {
      list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }
  }, [selected]);

  return (
    <Dialog title="Open" onCancel={onCancel}>
      <ul
        ref={listRef}
        className={styles.fileList}
        role="listbox"
        aria-label="Notes and text files"
      >
        {files === null ? <li className={styles.fileEmpty}>Reading…</li> : null}
        {files?.length === 0 ? <li className={styles.fileEmpty}>No text files yet.</li> : null}
        {files?.map((file) => (
          <li
            key={file.id}
            role="option"
            aria-selected={selected === file.id}
            tabIndex={selected === file.id ? 0 : -1}
            className={`${styles.fileRow} ${selected === file.id ? styles.fileRowSelected : ''}`}
            onClick={() => setSelected(file.id)}
            onDoubleClick={() => onOpen(file.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && selected) onOpen(selected);
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              const list = files ?? [];
              const index = list.findIndex((candidate) => candidate.id === selected);
              const next = list[index + (event.key === 'ArrowDown' ? 1 : -1)];
              if (next) setSelected(next.id);
            }}
          >
            <AppIcon name="file-text" size={16} />
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileFolder}>{folders.get(file.parentId ?? '') ?? ''}</span>
          </li>
        ))}
      </ul>
      <div className={styles.dialogButtons}>
        <button
          type="button"
          className={styles.dialogPrimary}
          disabled={!selected}
          onClick={() => selected && onOpen(selected)}
        >
          Open
        </button>
        <button type="button" className={styles.dialogButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function RenameDialog({
  name,
  onRename,
  onCancel,
}: {
  name: string;
  onRename: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // The whole name is shown, extension included, but only the stem is selected: renaming almost
  // never means changing the type.
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const dot = name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, [name]);

  return (
    <Dialog title="Rename" onCancel={onCancel}>
      <form
        className={styles.renameForm}
        onSubmit={(event) => {
          event.preventDefault();
          onRename(ref.current?.value ?? name);
        }}
      >
        <label className={styles.findLabel}>
          New name:
          <input ref={ref} className={styles.findInput} defaultValue={name} />
        </label>
        <div className={styles.dialogButtons}>
          <button type="submit" className={styles.dialogPrimary}>
            Rename
          </button>
          <button type="button" className={styles.dialogButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** A dialog inside the window: modal to it, dismissed by Escape or Cancel. */
function Dialog({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Once, on open, so the keyboard starts inside the dialog. A list that arrives later focuses its
  // own selected row; doing that here on every render would pull focus out of the field being typed in.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, button:not(:disabled)')?.focus();
  }, []);

  return (
    <div className={styles.scrim} role="presentation" onPointerDown={onCancel}>
      <div
        ref={ref}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className={styles.dialogTitle}>{title}</div>
        <div className={styles.dialogBody}>{children}</div>
      </div>
    </div>
  );
}

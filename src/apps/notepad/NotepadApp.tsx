import { useCallback, useEffect, useRef, useState } from 'react';
import { launchApp, type AppProps } from '../../kernel/apps';
import { closeWindow, setWindowTitle } from '../../kernel/windows';
import { notifyError } from '../../kernel/notifications';
import { useDirectory, vfs } from '../../kernel/vfs/client';
import { ROOT_ID } from '../../kernel/vfs/types';
import { ContextMenu, separator, useContextMenu } from '../../shell/ContextMenu';
import { MenuBar, type MenuBarMenu } from '../../shell/MenuBar';
import { Icon } from '../../shell/Icon';
import { nodeMenuItems } from '../../shell/nodeMenu';
import styles from './NotepadApp.module.css';

/**
 * Notepad.
 *
 * Writes Markdown files into a Notes folder in the file system — not into a private store. That is
 * the point: a note is an ordinary file, so it gets indexed, searched, opened in the Viewer and
 * trashed like anything else, with no special cases anywhere.
 *
 * **Saving is something the user does.** This app used to autosave on a 900 ms debounce and rename
 * the file from its first heading as you typed, which meant the document on disk was never quite
 * the one you had decided on, and the file in Files renamed itself under the pointer. A toolbar
 * with a Save button that can be greyed out says more about the state of your work than any amount
 * of "Saving…" ever did.
 *
 * The bar across the top is a real menu bar — the same `ContextMenu` the rest of the desktop drops
 * at the pointer, anchored under a title instead. Every entry on it does something: a File menu of
 * greyed-out entries would be a picture of Notepad rather than Notepad. That is also why there is
 * no Search menu and why Time/Date carries no accelerator — see the menus themselves.
 *
 * The debounce is gone; the flush on close is not. A browser tab cannot reliably interrupt its own
 * closing to ask "save changes?", so the choice is between an explicit save model with a silent
 * net underneath it and one that loses work when a window is closed. Switching notes flushes for
 * the same reason. The net is never the *only* way text reaches disk, which is what separates it
 * from autosave.
 */

const NOTES_FOLDER = 'Notes';

interface NotepadArgs {
  fileId?: string;
  create?: boolean;
}

export default function NotepadApp({ windowId, args }: AppProps) {
  const { fileId: initialFileId, create } = (args as NotepadArgs | undefined) ?? {};
  const [folderId, setFolderId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialFileId ?? null);
  const [draft, setDraft] = useState('');
  /** What the active note holds on disk. `draft !== baseline` is the whole definition of unsaved. */
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // On by default, unlike the original. This edits Markdown prose in a resizable window, where
  // wrapping off means every paragraph is one line you scroll sideways to read.
  const [wordWrap, setWordWrap] = useState(true);
  const listing = useDirectory(folderId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const loadedId = useRef<string | null>(null);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const notes = listing.nodes.filter((node) => node.kind === 'file');

  /*
   * Live values for the callbacks that must not be rebuilt when they change.
   *
   * `save` used to depend on the notes array, which is rebuilt on every listing update — so `save`
   * changed identity constantly, and any effect depending on it re-ran just as often. Reading the
   * array from a ref keeps `save` stable across the app's whole life and is why the flush effect
   * below can depend on nothing but the note it is guarding.
   */
  const notesRef = useRef(notes);
  const activeIdRef = useRef(activeId);
  const latest = useRef({ draft, baseline });
  useEffect(() => {
    notesRef.current = notes;
    activeIdRef.current = activeId;
    latest.current = { draft, baseline };
  });

  /* Find or create the Notes folder once. */
  useEffect(() => {
    void (async () => {
      const children = await vfs.list(ROOT_ID);
      const existing = children.find(
        (node) => node.kind === 'directory' && node.name === NOTES_FOLDER,
      );
      const folder = existing ?? (await vfs.createDirectory(ROOT_ID, NOTES_FOLDER));
      setFolderId(folder.id);
    })();
  }, []);

  const newNote = useCallback(async () => {
    if (!folderId) return;
    try {
      const stamp = new Date().toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      // Empty, like a real one. The name collides with the last note made today, and the file
      // system's own uniquing settles it rather than this app inventing a scheme.
      const node = await vfs.writeText(folderId, `Note ${stamp}.md`, '', {
        mime: 'text/markdown',
      });
      loadedId.current = node.id;
      setActiveId(node.id);
      setDraft('');
      setBaseline('');
      setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (error) {
      notifyError('Could not create the note', error);
    }
  }, [folderId]);

  /* Open the requested note, or the newest, or start one. */
  useEffect(() => {
    if (!folderId || listing.loading) return;
    if (activeId) return;

    if (create || notes.length === 0) {
      void newNote();
      return;
    }
    const newest = [...notes].sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
    if (newest) setActiveId(newest.id);
  }, [folderId, listing.loading, activeId, create, notes, newNote]);

  /* Load the active note's text, but never clobber unsaved edits to the same note. */
  useEffect(() => {
    if (!activeId || loadedId.current === activeId) return;
    let cancelled = false;
    void (async () => {
      try {
        const text = await vfs.readText(activeId);
        if (cancelled) return;
        loadedId.current = activeId;
        setDraft(text);
        setBaseline(text);
      } catch (error) {
        if (!cancelled) notifyError('Could not open the note', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const activeNode = notes.find((node) => node.id === activeId) ?? null;
  const dirty = activeId !== null && draft !== baseline;

  useEffect(() => {
    const name = activeNode?.name ?? 'Untitled';
    // The asterisk is the era's own unsaved marker, and it is in the taskbar button too — which is
    // the only place you can see it once the window is behind another one.
    setWindowTitle(windowId, `${dirty ? '*' : ''}${name} — Notepad`);
  }, [windowId, activeNode, dirty]);

  /* Save ------------------------------------------------------------------------------------- */

  const save = useCallback(
    async (id: string, text: string) => {
      if (!folderId) return;
      const node = notesRef.current.find((candidate) => candidate.id === id);
      if (!node) return;

      setSaving(true);
      try {
        await vfs.writeFile({
          parentId: folderId,
          name: node.name,
          data: new TextEncoder().encode(text).buffer as ArrayBuffer,
          mime: 'text/markdown',
          overwrite: true,
        });
        // A flush-on-switch resolves after the editor already holds a different note. The baseline
        // describes what is on screen, so it is only this write's business while that is still true.
        if (activeIdRef.current === id) setBaseline(text);
      } catch (error) {
        notifyError('Could not save the note', error);
      } finally {
        setSaving(false);
      }
    },
    [folderId],
  );

  const saveNow = useCallback(() => {
    if (!activeId || !dirty) return;
    void save(activeId, draft);
  }, [activeId, dirty, draft, save]);

  /*
   * The net: flush a pending edit when the note changes or the window closes.
   *
   * The draft is read from a ref rather than listed as a dependency, and that is the whole point of
   * this effect's shape. With it in the dependency array the cleanup ran on every keystroke, each
   * pass writing the text as of the *previous* one — and two of those arriving together produced
   * identical bytes for one content-addressed file, which OPFS refuses outright: "Access Handles
   * cannot be created if there is another open Access Handle". Reading from a ref that a later
   * effect updates means the cleanup sees the values as they were while the note was still active,
   * which is exactly what needs saving.
   */
  useEffect(() => {
    const id = activeId;
    return () => {
      if (!id) return;
      const { draft: text, baseline: disk } = latest.current;
      if (text === disk) return;
      void save(id, text);
    };
  }, [activeId, save]);

  /* Rename ----------------------------------------------------------------------------------- */

  const rename = useCallback(async (id: string, name: string) => {
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    // A note that loses its extension stops being Markdown to every other app on the desktop, so a
    // bare name gets one back rather than being taken literally.
    const withSuffix = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
    try {
      await vfs.rename(id, withSuffix);
    } catch (error) {
      notifyError('Could not rename the note', error);
    }
  }, []);

  /* Editing commands the menus drive --------------------------------------------------------- */

  const selectAll = useCallback(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  /** Notepad's Time/Date, stamped at the caret. Locale decides the format, as it does for the clock. */
  const insertTimeDate = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    const now = new Date();
    const stamp = `${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ${now.toLocaleDateString()}`;
    const from = element.selectionStart;
    const to = element.selectionEnd;
    setDraft((current) => current.slice(0, from) + stamp + current.slice(to));
    // React writes the new value on the next commit, so the caret has to be placed after it.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(from + stamp.length, from + stamp.length);
    });
  }, []);

  /* Menu bar --------------------------------------------------------------------------------- */

  /*
   * The bar's contents.
   *
   * Rebuilt per render on purpose — every entry's label, checked state and disabled state is read
   * from the state above, and a menu that was memoised would be showing the note you had open when
   * it was built. They are thunks so that only the one being opened is ever constructed.
   *
   * There is no Search menu. Notepad's was find-in-document, this desktop's Search is a semantic
   * index over your files, and a menu that offered either under the other's name would be worse
   * than the gap. Time/Date shows no accelerator for a related reason: the original bound it to F5,
   * and taking F5 away from someone trying to reload a web page is not a period detail worth having.
   */
  const menuBar: MenuBarMenu[] = [
    {
      id: 'file',
      label: 'File',
      items: () => [
        { id: 'file.new', label: 'New', run: () => void newNote() },
        { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', disabled: !dirty, run: saveNow },
        {
          id: 'file.rename',
          label: 'Rename…',
          shortcut: 'F2',
          disabled: !activeId,
          run: () => activeId && setRenaming(activeId),
        },
        separator('file.s1'),
        {
          id: 'file.reveal',
          label: 'Show in Files',
          disabled: !folderId,
          run: () =>
            void launchApp('files', {
              args: { directoryId: folderId, ...(activeId ? { selectId: activeId } : {}) },
              title: 'Files',
            }),
        },
        separator('file.s2'),
        { id: 'file.close', label: 'Close', run: () => closeWindow(windowId) },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: () => [
        { id: 'edit.selectAll', label: 'Select All', shortcut: 'Ctrl+A', run: selectAll },
        { id: 'edit.timeDate', label: 'Time/Date', disabled: !activeId, run: insertTimeDate },
        separator('edit.s1'),
        {
          id: 'edit.wrap',
          label: 'Word Wrap',
          checked: wordWrap,
          run: () => setWordWrap((on) => !on),
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

  /* Keyboard --------------------------------------------------------------------------------- */

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      // Without this the browser offers to save the *page*, which is never what Ctrl+S means here.
      event.preventDefault();
      saveNow();
      return;
    }
    if (event.key === 'F2' && activeId) {
      event.preventDefault();
      setRenaming(activeId);
    }
  };

  const moveSelection = (direction: 1 | -1) => {
    if (notes.length === 0) return;
    const index = notes.findIndex((note) => note.id === activeId);
    const next = notes[Math.min(notes.length - 1, Math.max(0, index + direction))];
    if (next) setActiveId(next.id);
  };

  const onListKeyDown = (event: React.KeyboardEvent, noteId: string) => {
    switch (event.key) {
      case 'ArrowDown':
        moveSelection(1);
        break;
      case 'ArrowUp':
        moveSelection(-1);
        break;
      case 'F2':
        setRenaming(noteId);
        break;
      case 'Enter':
        textareaRef.current?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  /* Render ----------------------------------------------------------------------------------- */

  return (
    <div className={styles.app} onKeyDown={onKeyDown}>
      <MenuBar menus={menuBar} label="Notepad" />

      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>Notes</div>
          <ul className={styles.list} role="listbox" aria-label="Notes" tabIndex={-1}>
            {notes.map((note) => {
              const active = note.id === activeId;
              return (
                <li
                  key={note.id}
                  className={`${styles.listItem} ${active ? styles.listItemActive : ''}`}
                  role="option"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setActiveId(note.id)}
                  onKeyDown={(event) => onListKeyDown(event, note.id)}
                  onContextMenu={(event) =>
                    openMenu(event, [
                      { id: 'note.open', label: 'Open', run: () => setActiveId(note.id) },
                      { id: 'note.rename', label: 'Rename…', run: () => setRenaming(note.id) },
                      separator('note.s1'),
                      { id: 'note.new', label: 'New note', run: () => void newNote() },
                      separator('note.s2'),
                      // The note is a file like any other, so it gets the file menu too — minus
                      // "Open", which the entry above already is.
                      ...nodeMenuItems(note, {
                        omitOpen: true,
                        onTrashed: () => note.id === activeId && setActiveId(null),
                      }),
                    ])
                  }
                >
                  {renaming === note.id ? (
                    <RenameField
                      name={note.name}
                      onCommit={(name) => void rename(note.id, name)}
                      onCancel={() => setRenaming(null)}
                    />
                  ) : (
                    <>
                      <span className={styles.listName}>{note.name.replace(/\.md$/, '')}</span>
                      <span className={styles.listDate}>
                        {new Date(note.modifiedAt).toLocaleDateString(undefined, {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
            {notes.length === 0 && !listing.loading ? (
              <li className={styles.listEmpty}>No notes yet.</li>
            ) : null}
          </ul>
        </aside>

        <main className={styles.editorPane}>
          {activeId ? (
            <>
              <textarea
                ref={textareaRef}
                className={styles.editor}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                wrap={wordWrap ? 'soft' : 'off'}
                spellCheck
                placeholder="Write here. Notes are ordinary Markdown files, so everything you type becomes searchable."
                aria-label="Note text"
              />
              <div className={styles.statusBar}>
                <span>{activeNode?.name}</span>
                <span className={styles.saveState}>
                  {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
                </span>
                <span>{draft.length.toLocaleString()} characters</span>
              </div>
            </>
          ) : (
            <div className={styles.placeholder}>
              <Icon name="note" size={26} />
              <p>Select a note, or create one.</p>
            </div>
          )}
        </main>
      </div>

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </div>
  );
}

/**
 * The rename field, which is the row itself for as long as it is being renamed.
 *
 * Shows the whole file name including the extension, because that is what is about to be written —
 * but selects only the stem, since renaming almost never means changing the type.
 */
function RenameField({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const dot = name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, [name]);

  return (
    <input
      ref={ref}
      className={styles.renameInput}
      defaultValue={name}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit((event.target as HTMLInputElement).value);
        else if (event.key === 'Escape') onCancel();
        event.stopPropagation();
      }}
    />
  );
}

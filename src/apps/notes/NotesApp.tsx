import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { setWindowTitle } from '../../kernel/windows';
import { notifyError } from '../../kernel/notifications';
import { useDirectory, vfs } from '../../kernel/vfs/client';
import { ROOT_ID } from '../../kernel/vfs/types';
import { ContextMenu, separator, useContextMenu } from '../../shell/ContextMenu';
import { Icon } from '../../shell/Icon';
import { nodeMenuItems } from '../../shell/nodeMenu';
import styles from './NotesApp.module.css';

/**
 * Notes.
 *
 * Writes Markdown files into a Notes folder in the file system — not into a private store. That
 * is the point: a note is an ordinary file, so it gets indexed, searched, opened in the Viewer and
 * trashed like anything else, with no special cases anywhere.
 *
 * Autosave is debounced, because every keystroke would otherwise hash and re-index the file.
 */

const NOTES_FOLDER = 'Notes';
const SAVE_DELAY = 900;

interface NotesArgs {
  fileId?: string;
  create?: boolean;
}

export default function NotesApp({ windowId, args }: AppProps) {
  const { fileId: initialFileId, create } = (args as NotesArgs | undefined) ?? {};
  const [folderId, setFolderId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialFileId ?? null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const listing = useDirectory(folderId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedId = useRef<string | null>(null);
  /** What is known to be on disk for each note, so an unchanged draft is not written again. */
  const savedText = useRef(new Map<string, string>());
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

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

  const notes = listing.nodes.filter((node) => node.kind === 'file');

  const newNote = useCallback(async () => {
    if (!folderId) return;
    try {
      const stamp = new Date().toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const node = await vfs.writeText(folderId, `Note ${stamp}.md`, '# \n\n', {
        mime: 'text/markdown',
      });
      setActiveId(node.id);
      setDraft('# \n\n');
      loadedId.current = node.id;
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
        savedText.current.set(activeId, text);
        setDraft(text);
        setStatus('idle');
      } catch (error) {
        if (!cancelled) notifyError('Could not open the note', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const activeNode = notes.find((node) => node.id === activeId) ?? null;

  useEffect(() => {
    setWindowTitle(windowId, activeNode ? `${activeNode.name} — Notes` : 'Notes');
  }, [windowId, activeNode]);

  /* Autosave. */
  const save = useCallback(
    async (id: string, text: string) => {
      if (!folderId) return;
      const node = notes.find((candidate) => candidate.id === id);
      if (!node) return;

      // Nothing changed since the last successful save: rewriting identical bytes would only
      // churn the index and, if two of them overlapped, contend for the same blob file.
      if (savedText.current.get(id) === text) {
        setStatus('saved');
        return;
      }

      setStatus('saving');
      try {
        // A note's title is its first heading; keeping the file name in step means Files and
        // Search show something meaningful rather than "Note 12 Aug 2026.md".
        const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
        const desired = heading ? `${heading.slice(0, 60).replace(/[/\\:*?"<>|]/g, '')}.md` : null;

        await vfs.writeFile({
          parentId: folderId,
          name: node.name,
          data: new TextEncoder().encode(text).buffer as ArrayBuffer,
          mime: 'text/markdown',
          overwrite: true,
        });

        savedText.current.set(id, text);

        if (desired && desired !== node.name && desired !== '.md') {
          await vfs.rename(id, desired);
        }
        setStatus('saved');
      } catch (error) {
        setStatus('idle');
        notifyError('Could not save the note', error);
      }
    },
    [folderId, notes],
  );

  const onChange = useCallback(
    (text: string) => {
      setDraft(text);
      setStatus('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const id = activeId;
      if (!id) return;
      saveTimer.current = setTimeout(() => void save(id, text), SAVE_DELAY);
    },
    [activeId, save],
  );

  /*
   * Flush a pending edit when the note changes or the window closes.
   *
   * The draft and the save function are read from a ref rather than listed as dependencies, and
   * that is the whole point of this effect's shape. With them in the dependency array the cleanup
   * ran on every keystroke — and, because each save refreshes the folder listing and so rebuilds
   * `save`, once more after every save. The debounce never got to fire, each pass wrote the text
   * as of the *previous* keystroke, and two of those arriving together produced identical bytes
   * for one content-addressed file, which OPFS refuses outright: "Access Handles cannot be created
   * if there is another open Access Handle".
   *
   * Reading from a ref that a later effect updates means the cleanup sees the values as they were
   * when the note was still the active one, which is exactly what needs saving.
   */
  const latest = useRef({ draft, save });
  useEffect(() => {
    latest.current = { draft, save };
  });

  useEffect(() => {
    const id = activeId;
    return () => {
      if (!saveTimer.current || !id) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      void latest.current.save(id, latest.current.draft);
    };
  }, [activeId]);

  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span>Notes</span>
          <button
            type="button"
            className={styles.newButton}
            onClick={() => void newNote()}
            title="New note"
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
        <ul className={styles.list}>
          {notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className={`${styles.listItem} ${note.id === activeId ? styles.listItemActive : ''}`}
                onClick={() => setActiveId(note.id)}
                onContextMenu={(event) =>
                  openMenu(event, [
                    { id: 'note.open', label: 'Open', run: () => setActiveId(note.id) },
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
                <span className={styles.listName}>{note.name.replace(/\.md$/, '')}</span>
                <span className={styles.listDate}>
                  {new Date(note.modifiedAt).toLocaleDateString(undefined, {
                    day: '2-digit',
                    month: 'short',
                  })}
                </span>
              </button>
            </li>
          ))}
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
              onChange={(event) => onChange(event.target.value)}
              spellCheck
              placeholder="# Title&#10;&#10;Write here. Notes are ordinary Markdown files, so everything you type becomes searchable."
              aria-label="Note text"
            />
            <div className={styles.statusBar}>
              <span>{activeNode?.name}</span>
              <span className={styles.saveState}>
                {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved · indexing' : ''}
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

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </div>
  );
}

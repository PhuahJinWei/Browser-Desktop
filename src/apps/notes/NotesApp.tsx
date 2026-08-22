import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { setWindowTitle } from '../../kernel/windows';
import { notifyError } from '../../kernel/notifications';
import { useDirectory, vfs } from '../../kernel/vfs/client';
import { ROOT_ID } from '../../kernel/vfs/types';
import { Icon } from '../../shell/Icon';
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

  /* Flush pending edits when the note changes or the window closes. */
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (activeId) void save(activeId, draft);
      }
    },
    [activeId, draft, save],
  );

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
    </div>
  );
}

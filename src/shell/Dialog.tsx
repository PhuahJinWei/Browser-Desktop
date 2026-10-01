import { useEffect, useRef, useState } from 'react';
import { vfs } from '../kernel/vfs/client';
import { ROOT_ID, type VfsNode } from '../kernel/vfs/types';
import type { IconName } from './Icon';
import { AppIcon } from './PixelIcon';
import styles from './Dialog.module.css';

/**
 * Dialogs inside a window: modal to it, never to the desktop.
 *
 * The era's programs and the current ones both open files through a dialog, and this is that
 * dialog reduced to what this file system needs — it is small and flat enough that a list of every
 * matching file, newest first, beats a folder tree. Shared, because Notepad, Sound Recorder and
 * Media Player each open files the same way, and three copies of one dialog drift apart.
 *
 * Each draws in the current skin: a navy caption over grey under classic, a rounded card under
 * modern.
 */

/** The frame: a scrim over the window, the box, Escape or a click outside to cancel. */
export function Dialog({
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
        <div className={styles.title}>{title}</div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}

/** OK and Cancel, right-aligned, the first one the default. */
export function DialogButtons({
  primary,
  onPrimary,
  disabled = false,
  onCancel,
  submit = false,
}: {
  primary: string;
  onPrimary?: () => void;
  disabled?: boolean;
  onCancel: () => void;
  /** The primary button submits the form it is in, rather than calling `onPrimary`. */
  submit?: boolean;
}) {
  return (
    <div className={styles.buttons}>
      <button
        type={submit ? 'submit' : 'button'}
        className={styles.primary}
        disabled={disabled}
        onClick={submit ? undefined : onPrimary}
      >
        {primary}
      </button>
      <button type="button" className={styles.button} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** Open: every file the app can open, newest first, with the folder each is in. */
export function OpenDialog({
  accepts,
  icon,
  label,
  empty,
  onOpen,
  onCancel,
}: {
  accepts: (node: VfsNode) => boolean;
  icon: IconName;
  /** What the list holds, for a screen reader: "Notes and text files". */
  label: string;
  /** Said when there is nothing to open. */
  empty: string;
  onOpen: (id: string) => void;
  onCancel: () => void;
}) {
  const [files, setFiles] = useState<VfsNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [folders, setFolders] = useState<Map<string, string>>(new Map());
  const listRef = useRef<HTMLUListElement>(null);
  const acceptsRef = useRef(accepts);

  useEffect(() => {
    void vfs.allNodes().then((nodes) => {
      const found = nodes
        .filter((node) => node.kind === 'file' && !node.trashed && acceptsRef.current(node))
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
      setFolders(
        new Map(
          nodes
            .filter((node) => node.kind === 'directory')
            .map((node) => [node.id, node.id === ROOT_ID ? 'Home' : node.name]),
        ),
      );
      setFiles(found);
      setSelected(found[0]?.id ?? null);
    });
  }, []);

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
      <ul ref={listRef} className={styles.fileList} role="listbox" aria-label={label}>
        {files === null ? <li className={styles.fileEmpty}>Reading…</li> : null}
        {files?.length === 0 ? <li className={styles.fileEmpty}>{empty}</li> : null}
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
            <AppIcon name={icon} size={16} />
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileFolder}>{folders.get(file.parentId ?? '') ?? ''}</span>
          </li>
        ))}
      </ul>
      <DialogButtons
        primary="Open"
        disabled={!selected}
        onPrimary={() => selected && onOpen(selected)}
        onCancel={onCancel}
      />
    </Dialog>
  );
}

/** A name for something: the whole name shown, only the stem selected. */
export function NameDialog({
  title,
  name,
  action,
  onSubmit,
  onCancel,
}: {
  title: string;
  name: string;
  action: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // Renaming almost never means changing the type, so the extension is left unselected.
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const dot = name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, [name]);

  return (
    <Dialog title={title} onCancel={onCancel}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(ref.current?.value ?? name);
        }}
      >
        <label className={styles.field}>
          New name:
          <input ref={ref} className={styles.input} defaultValue={name} />
        </label>
        <DialogButtons primary={action} submit onCancel={onCancel} />
      </form>
    </Dialog>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatShortcut, searchCommands, useCommands, type CommandMatch } from '../kernel/commands';
import { openFile, searchFiles } from '../kernel/apps';
import { vfs } from '../kernel/vfs/client';
import { iconForFile, Icon } from './Icon';
import type { VfsNode } from '../kernel/vfs/types';
import styles from './CommandPalette.module.css';

/**
 * The command palette.
 *
 * Commands and files in one list, because "open Settings" and "open notes.md" are the same
 * intent as far as the user is concerned. Commands come from the registry that also defines the
 * keyboard shortcuts, so what the palette shows is what the keys actually do.
 */

interface FileMatch {
  node: VfsNode;
  path: string;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const commands = useCommands();

  const matches = useMemo(() => searchCommands(query, commands).slice(0, 12), [query, commands]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* File name matches, debounced so each keystroke does not hit the worker. */
  useEffect(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) {
      setFiles([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const nodes = await vfs.allNodes();
      if (cancelled) return;
      const hits = nodes
        .filter(
          (node) => !node.trashed && node.id !== 'root' && node.name.toLowerCase().includes(needle),
        )
        .sort((a, b) => a.name.length - b.name.length)
        .slice(0, 8)
        .map((node) => ({ node, path: node.name }));
      setFiles(hits);
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const trimmed = query.trim();
  const items: (
    | { type: 'command'; match: CommandMatch }
    | { type: 'file'; match: FileMatch }
    | { type: 'search'; query: string }
  )[] = [
    ...matches.map((match) => ({ type: 'command' as const, match })),
    ...files.map((match) => ({ type: 'file' as const, match })),
    // Last, because a name or a command is the likelier intent — but always there, so a query that
    // matches neither still goes somewhere instead of ending at "No matches".
    ...(trimmed.length >= 2 ? [{ type: 'search' as const, query: trimmed }] : []),
  ];

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const items = listRef.current?.querySelectorAll('li');
    items?.[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const activate = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    if (item.type === 'command') void item.match.command.run();
    else if (item.type === 'file') openFile(item.match.node);
    else searchFiles(item.query);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((current) => Math.min(items.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className={styles.overlay} onPointerDown={onClose} role="presentation">
      <div
        className={styles.palette}
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className={styles.inputRow}>
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Run a command or open a file…"
            aria-label="Command or file"
            aria-controls="palette-results"
            aria-activedescendant={`palette-item-${selected}`}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className={styles.esc}>Esc</kbd>
        </div>

        <ul className={styles.results} id="palette-results" ref={listRef} role="listbox">
          {items.length === 0 ? (
            <li className={styles.empty}>No matches</li>
          ) : (
            items.map((item, index) => {
              const active = index === selected;
              if (item.type === 'command') {
                const { command, positions } = item.match;
                return (
                  <li
                    key={`command-${command.id}`}
                    id={`palette-item-${index}`}
                    role="option"
                    aria-selected={active}
                    className={`${styles.item} ${active ? styles.itemActive : ''}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      activate(index);
                    }}
                    onPointerEnter={() => setSelected(index)}
                  >
                    <span className={styles.section}>{command.section}</span>
                    <span className={styles.label}>
                      <Highlight text={command.title} positions={positions} />
                    </span>
                    {command.shortcut ? (
                      <kbd className={styles.shortcut}>{formatShortcut(command.shortcut)}</kbd>
                    ) : null}
                  </li>
                );
              }

              if (item.type === 'search') {
                return (
                  <li
                    key="search"
                    id={`palette-item-${index}`}
                    role="option"
                    aria-selected={active}
                    className={`${styles.item} ${active ? styles.itemActive : ''}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      activate(index);
                    }}
                    onPointerEnter={() => setSelected(index)}
                  >
                    <span className={styles.section}>
                      <Icon name="search" size={13} />
                    </span>
                    <span className={styles.label}>
                      Search inside every file for “{item.query}”
                    </span>
                    <span className={styles.hint}>Files</span>
                  </li>
                );
              }

              const { node } = item.match;
              return (
                <li
                  key={`file-${node.id}`}
                  id={`palette-item-${index}`}
                  role="option"
                  aria-selected={active}
                  className={`${styles.item} ${active ? styles.itemActive : ''}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    activate(index);
                  }}
                  onPointerEnter={() => setSelected(index)}
                >
                  <span className={styles.section}>
                    <Icon name={iconForFile(node)} size={13} />
                  </span>
                  <span className={styles.label}>{node.name}</span>
                  <span className={styles.hint}>open</span>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

/** Marks the characters the query matched, so the reason a result appears is visible. */
function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {[...text].map((character, index) =>
        set.has(index) ? (
          <mark key={index} className={styles.mark}>
            {character}
          </mark>
        ) : (
          <span key={index}>{character}</span>
        ),
      )}
    </>
  );
}

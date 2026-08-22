import { createStore, useStoreSelector } from './store';

/**
 * One registry behind the command palette, the keyboard shortcuts and the launcher.
 *
 * Keeping them separate is how desktops end up with a menu item that works, a shortcut that does
 * something subtly different, and a palette entry nobody updated. Here a command is declared once,
 * with its own key binding, and all three surfaces read the same list.
 */

export interface Command {
  id: string;
  title: string;
  section: 'Apps' | 'File' | 'View' | 'Search' | 'System';
  /** Extra words the palette should match on. */
  keywords?: string[];
  /** Accelerator in the form `Ctrl+K`, `Ctrl+Shift+P`, `Alt+Tab`, `F2`. */
  shortcut?: string;
  /** Hidden from the palette when this returns false. */
  when?: () => boolean;
  run: () => void | Promise<void>;
}

interface CommandState {
  commands: Command[];
}

const store = createStore<CommandState>({ commands: [] });

export function registerCommands(commands: Command[]): () => void {
  store.set((state) => ({
    // Re-registering an id replaces it, so a hot-swapped app never leaves a stale entry behind.
    commands: [
      ...state.commands.filter((existing) => !commands.some((c) => c.id === existing.id)),
      ...commands,
    ],
  }));

  return () => {
    const ids = new Set(commands.map((command) => command.id));
    store.set((state) => ({ commands: state.commands.filter((c) => !ids.has(c.id)) }));
  };
}

export function listCommands(): Command[] {
  return store.get().commands.filter((command) => command.when?.() ?? true);
}

export function runCommand(id: string): void {
  const command = store.get().commands.find((candidate) => candidate.id === id);
  if (command) void command.run();
}

export function useCommands(): Command[] {
  return useStoreSelector(store, (state) => state.commands);
}

/* -------------------------------------------------------------------------------------------- */
/* Matching                                                                                       */
/* -------------------------------------------------------------------------------------------- */

export interface CommandMatch {
  command: Command;
  score: number;
  /** Character positions in the title that matched, for highlighting. */
  positions: number[];
}

/**
 * Subsequence matching, the behaviour people expect from a command palette: `nf` finds
 * "**N**ew **F**older". Scoring rewards matches at word starts and consecutive runs, so the
 * obvious candidate rises above an incidental one.
 */
export function matchCommand(query: string, command: Command): CommandMatch | null {
  const haystack = command.title;
  const needle = query.trim().toLowerCase();
  if (!needle) return { command, score: 0, positions: [] };

  const lower = haystack.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let cursor = 0;
  let previousIndex = -2;

  for (const character of needle) {
    if (character === ' ') continue;
    const index = lower.indexOf(character, cursor);
    if (index === -1) {
      // Fall back to keywords: they match as a whole, worth less than a title hit.
      const keywords = command.keywords?.join(' ').toLowerCase() ?? '';
      return keywords.includes(needle) ? { command, score: 1, positions: [] } : null;
    }
    positions.push(index);
    score += 10;
    if (index === previousIndex + 1) score += 8;
    if (index === 0 || /[\s(/-]/.test(lower[index - 1] ?? '')) score += 6;
    previousIndex = index;
    cursor = index + 1;
  }

  // Prefer shorter titles when scores are otherwise equal: the more specific command wins.
  score -= Math.round(haystack.length / 12);
  return { command, score, positions };
}

export function searchCommands(
  query: string,
  commands: Command[] = listCommands(),
): CommandMatch[] {
  return commands
    .filter((command) => command.when?.() ?? true)
    .map((command) => matchCommand(query, command))
    .filter((match): match is CommandMatch => match !== null)
    .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title));
}

/* -------------------------------------------------------------------------------------------- */
/* Shortcuts                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/** Normalises a KeyboardEvent into the same form as a command's `shortcut` string. */
export function accelerator(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join('+');
}

/**
 * True when the event came from somewhere that owns its own keystrokes.
 *
 * Without this, typing "n" in a rename box would create a new folder. Single-key shortcuts are
 * suppressed in editable fields; combinations with a modifier still work, because Ctrl+S in a
 * text editor should still save.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Displays an accelerator with the platform's symbols. */
export function formatShortcut(shortcut: string): string {
  const isApple =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  if (!isApple) return shortcut;
  return shortcut.replace('Ctrl', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, '');
}

import type { AppProps } from '../../kernel/apps';
import { Explorer } from './Explorer';

/**
 * Files.
 *
 * The explorer, opened on the file system. Everything it can do lives in `Explorer.tsx`, which the
 * Recycle Bin opens on a different context — so a change to the chrome, the columns, the places
 * pane or the narrow-window rules lands in both windows without being written twice.
 */
export default function FilesApp({ windowId, args }: AppProps) {
  return <Explorer windowId={windowId} args={args} />;
}

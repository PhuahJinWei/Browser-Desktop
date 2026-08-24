import type { AppProps } from '../../kernel/apps';
import { Explorer } from '../files/Explorer';

/**
 * The Recycle Bin.
 *
 * The same explorer Files is, opened looking at what has been thrown away. It is its own app and
 * its own icon because that is what a wastebasket on a desktop is — but it is not its own
 * implementation, and briefly making it one was a mistake: the two immediately began to drift, and
 * every improvement to one had to be carried to the other by hand.
 *
 * `Explorer.tsx` holds the whole window. What being the Recycle Bin changes is small and named
 * there: where the rows come from, what two of the columns are called, and what you are allowed to
 * do to a selection.
 */
export default function RecycleBinApp({ windowId, args }: AppProps) {
  return <Explorer windowId={windowId} args={{ ...(args as object | null), recycle: true }} />;
}

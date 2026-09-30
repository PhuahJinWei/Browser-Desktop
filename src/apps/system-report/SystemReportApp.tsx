import { useEffect } from 'react';
import { SystemReport } from './SystemReport';
import type { AppProps } from '../../kernel/apps';
import { setWindowTitle } from '../../kernel/windows';

/**
 * My Computer — the System Report as a Windows-shaped machine properties surface.
 *
 * Its id is still `about`, because that key has already been persisted in layouts and sessions.
 * Help menus can ask for the About page directly while the desktop icon opens the overview.
 */
export default function SystemReportApp({ windowId, args }: AppProps) {
  // Sessions written before this app was renamed carry "About" as window data. Correct it at the
  // boundary rather than teaching the general session format about one application's history.
  useEffect(() => setWindowTitle(windowId, 'My Computer'), [windowId]);

  const section =
    typeof args === 'object' && args !== null && 'section' in args
      ? (args as { section?: unknown }).section
      : undefined;
  return <SystemReport initialPage={section === 'about' ? 'about' : 'general'} />;
}

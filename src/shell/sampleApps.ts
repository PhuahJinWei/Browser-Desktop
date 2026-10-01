import { installApp, listInstalledApps } from '../kernel/installedApps';
import { SAMPLE_APPS } from './sampleAppSources';

export { SAMPLE_APPS };

/**
 * Installs the bundled apps, and replaces any whose source has changed since it was last written.
 *
 * This used to install only what was missing, which meant an edit to a bundled app reached every
 * new desktop and no existing one. These three are the SDK's reference implementation, so a copy
 * that has silently fallen behind the source in this file is worse than no copy at all. Comparing
 * the stored source is enough to notice: `installApp` writes by id, so a changed app replaces
 * itself and keeps the permissions and the folder already attached to that id.
 */
export async function installSampleApps(): Promise<number> {
  const stored = new Map(listInstalledApps().map((app) => [app.id, app.source]));
  let installed = 0;

  for (const app of SAMPLE_APPS) {
    if (stored.get(app.id) === app.source) continue;
    try {
      await installApp(app.source, 'bundled');
      installed++;
    } catch {
      // A malformed bundled app is a bug, but it must not stop the desktop from starting.
    }
  }
  return installed;
}

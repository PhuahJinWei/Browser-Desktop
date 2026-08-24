import { useEffect, useState } from 'react';
import { boot as registerServiceWorker, type BootResult } from '../kernel/boot';
import { probeCapabilities, type Capabilities } from '../kernel/capabilities';
import { probeWorkerCapabilities, type WorkerCapabilities } from '../kernel/worker-probe';
import { applySettings, settingsStore, updateSettings } from '../kernel/settings';
import { notifyError } from '../kernel/notifications';
import { vfs } from '../kernel/vfs/client';
import { ensurePersistentStorage } from '../kernel/persistence';
import { startIndexer } from '../services/index/client';
import { CapabilitiesProvider } from './capabilitiesContext';
import { Desktop } from './Desktop';
import { registerSystemCommands } from './systemCommands';
import { loadSampleData } from './sampleData';
import { installSampleApps } from './sampleApps';
import { installApp, loadInstalledApps, unpackAppLink } from '../kernel/installedApps';
import { dismissBootSplash, failBootSplash, setBootStep } from './bootSplash';

/**
 * Boot.
 *
 * The order matters. Isolation has to be settled first, because it decides whether the WASM
 * backend gets threads. The capability probe comes next, because it decides which backend runs at
 * all. Only then is there enough information to start the file system and the indexer.
 *
 * The splash is not decoration: it is the probe reporting what it found, which is the most
 * honest possible opening for an app whose whole claim is that it runs on your hardware. It is
 * also not rendered here — it is static markup in index.html, painted before this file has been
 * fetched, and this component only reports into it through ./bootSplash.
 */

export function Shell() {
  const [ready, setReady] = useState(false);
  const [system, setSystem] = useState<{
    capabilities: Capabilities;
    workerCapabilities: WorkerCapabilities | null;
    boot: BootResult;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Settings first. index.html carries the default skin so the pre-script frame is already
        // right; this picks up a stored preference and everything the attribute cannot express.
        applySettings(settingsStore.get());
        const unsubscribe = settingsStore.subscribe(() => applySettings(settingsStore.get()));

        setBootStep('isolation', 'running');
        const bootResult = await registerServiceWorker();
        if (cancelled) return;
        // A reload is about to happen; there is no point continuing to boot.
        if (bootResult.isolation === 'reloading') return;
        setBootStep(
          'isolation',
          bootResult.isolation === 'isolated' || bootResult.isolation === 'isolated-dev'
            ? 'done'
            : 'warn',
          bootResult.detail,
        );

        setBootStep('probe', 'running');
        const capabilities = await probeCapabilities();
        const workerCapabilities = await probeWorkerCapabilities();
        if (cancelled) return;
        setBootStep('probe', capabilities.tier === 'C' ? 'warn' : 'done', capabilities.tierReason);
        setSystem({ capabilities, workerCapabilities, boot: bootResult });

        setBootStep('vfs', 'running');
        await vfs.init();
        if (cancelled) return;
        setBootStep('vfs', 'done', 'Origin private file system mounted');

        // Ask the browser not to evict what the user puts here. Deliberately not awaited: the
        // answer is the browser's to give on its own schedule, Firefox gives it by prompting, and
        // nothing below depends on it. About reports whatever it decides.
        void ensurePersistentStorage();

        setBootStep('search', 'running');
        const backend =
          settingsStore.get().backend === 'auto'
            ? capabilities.gpu.available &&
              capabilities.wasm.threads &&
              capabilities.crossOriginIsolated
              ? 'wasm'
              : capabilities.gpu.available
                ? 'webgpu'
                : 'wasm'
            : settingsStore.get().backend === 'webgpu'
              ? 'webgpu'
              : 'wasm';

        // First visit: create the sample corpus so the desktop has something to search.
        if (!settingsStore.get().sampleDataLoaded) {
          try {
            await loadSampleData();
          } catch (error) {
            notifyError('Could not create the sample documents', error);
            updateSettings({ sampleDataLoaded: true });
          }
        }

        await startIndexer(backend);

        // Apps last: they are the only thing here that runs code the desktop did not write.
        await loadInstalledApps();
        await installSampleApps();

        // An app shared as a link arrives in the fragment, which browsers never send to a server.
        const shared = unpackAppLink(location.hash);
        if (shared) {
          history.replaceState(null, '', location.pathname + location.search);
          try {
            await installApp(shared, 'link');
          } catch (error) {
            notifyError('That app link could not be installed', error);
          }
        }
        if (cancelled) return;
        setBootStep('search', 'done', `Embeddings on ${backend}`);

        // A brief pause so the completed checklist is legible rather than a flicker.
        setTimeout(() => !cancelled && setReady(true), 260);

        return () => unsubscribe();
      } catch (error) {
        if (!cancelled) failBootSplash(error instanceof Error ? error.message : String(error));
      }
      return undefined;
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* System commands live as long as the shell does. */
  useEffect(() => registerSystemCommands(), []);

  /*
   * Effects run after the commit, so by the time this fires the desktop below has been painted.
   * That ordering is the whole point: the splash fades to reveal a desktop, never to a blank page.
   */
  useEffect(() => {
    if (ready && system) dismissBootSplash();
  }, [ready, system]);

  /* Until then the splash from index.html is still up, and it is the only thing on screen. */
  if (!ready || !system) return null;

  return (
    <CapabilitiesProvider
      capabilities={system.capabilities}
      workerCapabilities={system.workerCapabilities}
      boot={system.boot}
    >
      <Desktop />
    </CapabilitiesProvider>
  );
}

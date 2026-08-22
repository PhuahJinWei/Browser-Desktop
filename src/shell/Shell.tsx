import { useEffect, useState } from 'react';
import { boot as registerServiceWorker, type BootResult } from '../kernel/boot';
import { probeCapabilities, type Capabilities } from '../kernel/capabilities';
import { probeWorkerCapabilities, type WorkerCapabilities } from '../kernel/worker-probe';
import { applySettings, settingsStore, updateSettings } from '../kernel/settings';
import { notifyError } from '../kernel/notifications';
import { vfs } from '../kernel/vfs/client';
import { ensurePersistentStorage } from '../kernel/persistence';
import { startIndexer } from '../services/index/client';
import { refreshModelStates } from '../kernel/models';
import { CapabilitiesProvider } from './capabilitiesContext';
import { Desktop } from './Desktop';
import { registerSystemCommands } from './systemCommands';
import { loadSampleData } from './sampleData';
import { installSampleApps } from './sampleApps';
import { installApp, loadInstalledApps, unpackAppLink } from '../kernel/installedApps';
import { Icon } from './Icon';
import styles from './Shell.module.css';

/**
 * Boot.
 *
 * The order matters. Isolation has to be settled first, because it decides whether the WASM
 * backend gets threads. The capability probe comes next, because it decides which backend runs at
 * all. Only then is there enough information to start the file system and the indexer.
 *
 * The splash is not decoration: it is the probe reporting what it found, which is the most
 * honest possible opening for an app whose whole claim is that it runs on your hardware.
 */

interface BootStep {
  label: string;
  detail?: string;
  state: 'pending' | 'running' | 'done' | 'warn';
}

export function Shell() {
  const [steps, setSteps] = useState<BootStep[]>([
    { label: 'Isolating the page', state: 'pending' },
    { label: 'Probing this machine', state: 'pending' },
    { label: 'Mounting the file system', state: 'pending' },
    { label: 'Starting search', state: 'pending' },
  ]);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [system, setSystem] = useState<{
    capabilities: Capabilities;
    workerCapabilities: WorkerCapabilities | null;
    boot: BootResult;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const update = (index: number, patch: Partial<BootStep>) =>
      setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));

    void (async () => {
      try {
        // Settings first: the theme must be applied before anything paints.
        applySettings(settingsStore.get());
        const unsubscribe = settingsStore.subscribe(() => applySettings(settingsStore.get()));

        update(0, { state: 'running' });
        const bootResult = await registerServiceWorker();
        if (cancelled) return;
        // A reload is about to happen; there is no point continuing to boot.
        if (bootResult.isolation === 'reloading') return;
        update(0, {
          state:
            bootResult.isolation === 'isolated' || bootResult.isolation === 'isolated-dev'
              ? 'done'
              : 'warn',
          detail: bootResult.detail,
        });

        update(1, { state: 'running' });
        const capabilities = await probeCapabilities();
        const workerCapabilities = await probeWorkerCapabilities();
        if (cancelled) return;
        update(1, {
          state: capabilities.tier === 'C' ? 'warn' : 'done',
          detail: capabilities.tierReason,
        });
        setSystem({ capabilities, workerCapabilities, boot: bootResult });

        update(2, { state: 'running' });
        await vfs.init();
        if (cancelled) return;
        update(2, { state: 'done', detail: 'Origin private file system mounted' });

        // Ask the browser not to evict what the user puts here. Deliberately not awaited: the
        // answer is the browser's to give on its own schedule, Firefox gives it by prompting, and
        // nothing below depends on it. About reports whatever it decides.
        void ensurePersistentStorage();

        update(3, { state: 'running' });
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
        void refreshModelStates();

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
        update(3, { state: 'done', detail: `Embeddings on ${backend}` });

        // A brief pause so the completed checklist is legible rather than a flicker.
        setTimeout(() => !cancelled && setReady(true), 260);

        return () => unsubscribe();
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      }
      return undefined;
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* System commands live as long as the shell does. */
  useEffect(() => registerSystemCommands(), []);

  if (failure) {
    return (
      <div className={styles.boot}>
        <div className={styles.card}>
          <h1 className={styles.title}>Tabula could not start</h1>
          <p className={styles.failure}>{failure}</p>
          <button type="button" className={styles.retry} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (!ready || !system) {
    return (
      <div className={styles.boot}>
        <div className={styles.card}>
          <div className={styles.brand}>
            <Icon name="apps" size={22} />
            <div>
              <h1 className={styles.title}>Tabula</h1>
              <p className={styles.subtitle}>A desktop in a tab</p>
            </div>
          </div>

          <ul className={styles.steps}>
            {steps.map((step) => (
              <li key={step.label} className={`${styles.step} ${styles[step.state]}`}>
                <span className={styles.stepIcon}>
                  {step.state === 'done' ? (
                    <Icon name="check" size={14} />
                  ) : step.state === 'warn' ? (
                    <Icon name="alert" size={14} />
                  ) : step.state === 'running' ? (
                    <span className={styles.dot} />
                  ) : (
                    <span className={styles.pending} />
                  )}
                </span>
                <span className={styles.stepLabel}>{step.label}</span>
                {step.detail ? <span className={styles.stepDetail}>{step.detail}</span> : null}
              </li>
            ))}
          </ul>

          <p className={styles.note}>
            Everything runs on this device. Nothing you open is uploaded.
          </p>
        </div>
      </div>
    );
  }

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

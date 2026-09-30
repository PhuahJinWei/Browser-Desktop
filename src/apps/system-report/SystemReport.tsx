import { useCallback, useEffect, useMemo, useState } from 'react';
import packageInfo from '../../../package.json';
import { boot, restartForUpdate, type BootResult } from '../../kernel/boot';
import { probeCapabilities, preferredBackend, type Capabilities } from '../../kernel/capabilities';
import { usePersistence } from '../../kernel/persistence';
import { probeWorkerCapabilities, type WorkerCapabilities } from '../../kernel/worker-probe';
import { createBenchClient } from '../../services/bench/client';
import type {
  BenchFailure,
  EmbeddingBenchResult,
  OpfsBenchResult,
} from '../../services/bench/client';
import { useCapabilities } from '../../shell/capabilitiesContext';
import { Icon, type IconName } from '../../shell/Icon';
import { AppIcon } from '../../shell/PixelIcon';
import styles from './SystemReport.module.css';

type BenchRow = (EmbeddingBenchResult | BenchFailure) & { label: string };
export type ComputerPage = 'general' | 'hardware' | 'capabilities' | 'performance' | 'about';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const BATCH_SIZE = 16;
const BATCHES = 8;

const PAGES = [
  { id: 'general', label: 'General', icon: 'computer' },
  { id: 'hardware', label: 'Hardware', icon: 'cpu' },
  { id: 'capabilities', label: 'Capabilities', icon: 'bolt' },
  { id: 'performance', label: 'Performance', icon: 'gauge' },
  { id: 'about', label: 'About Tabula', icon: 'info' },
] as const satisfies readonly { id: ComputerPage; label: string; icon: IconName }[];

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'Not reported';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function Status({ state, children }: { state: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  return <span className={`${styles.chip} ${styles[state]}`}>{children}</span>;
}

function Reading({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className={styles.reading}>
      <dt>{label}</dt>
      <dd>
        {value}
        {note ? <span className={styles.readingNote}>{note}</span> : null}
      </dd>
    </div>
  );
}

function Spec({ icon, label, value }: { icon: IconName; label: string; value: React.ReactNode }) {
  return (
    <div className={styles.spec}>
      <span className={styles.specIcon}>
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.specCopy}>
        <span className={styles.specLabel}>{label}</span>
        <span className={styles.specValue}>{value}</span>
      </span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      {children}
    </section>
  );
}

const yes = (value: boolean, on = 'Available', off = 'Unavailable') => (
  <Status state={value ? 'ok' : 'warn'}>{value ? on : off}</Status>
);

/**
 * The desktop's machine properties.
 *
 * The values are atmospheric because they are arranged like an operating-system property sheet,
 * but they are not fictional: each one is either measured at boot or explicitly labelled as a
 * browser report. That distinction is what lets the metaphor feel convincing without claiming a
 * CPU model or a physical disk that JavaScript cannot actually see.
 */
export function SystemReport({ initialPage = 'general' }: { initialPage?: ComputerPage }) {
  const [page, setPage] = useState<ComputerPage>(initialPage);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [workerCaps, setWorkerCaps] = useState<WorkerCapabilities | null>(null);
  const [bootResult, setBootResult] = useState<BootResult | null>(null);
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [opfs, setOpfs] = useState<OpfsBenchResult | BenchFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const persistence = usePersistence();
  const system = useCapabilities();

  useEffect(() => setPage(initialPage), [initialPage]);

  useEffect(() => {
    if (system) {
      setBootResult(system.boot);
      setCaps(system.capabilities);
      setWorkerCaps(system.workerCapabilities);
      return;
    }
    void (async () => {
      setBootResult(await boot());
      setCaps(await probeCapabilities());
      setWorkerCaps(await probeWorkerCapabilities());
    })();
  }, [system]);

  const runEmbeddingBench = useCallback(async (device: 'webgpu' | 'wasm') => {
    setBusy(device);
    setProgress(`Loading ${MODEL} on ${device}…`);
    const client = createBenchClient();
    try {
      const result = await client.call(
        'benchEmbeddings',
        [{ device, dtype: 'q8', model: MODEL, batchSize: BATCH_SIZE, batches: BATCHES }],
        {
          onProgress: (payload) => {
            const event = payload as {
              status?: string;
              file?: string;
              progress?: number;
              batch?: number;
              of?: number;
            };
            if (event.status === 'batch')
              setProgress(`Running batch ${event.batch}/${event.of} on ${device}…`);
            else if (event.status === 'progress' && event.file)
              setProgress(`Loading ${event.file} — ${Math.round(event.progress ?? 0)}%`);
            else if (event.status) setProgress(`${event.status} ${event.file ?? ''}`.trim());
          },
        },
      );
      setRows((previous) => [...previous, { ...result, label: device }]);
    } catch (error) {
      setRows((previous) => [
        ...previous,
        {
          ok: false,
          device,
          error: error instanceof Error ? error.message : String(error),
          label: device,
        },
      ]);
    } finally {
      client.terminate();
      setBusy(null);
      setProgress('');
    }
  }, []);

  const runOpfsBench = useCallback(async () => {
    setBusy('opfs');
    setProgress('Writing and reading a 64 MB file in browser storage…');
    const client = createBenchClient();
    try {
      setOpfs(await client.call('benchOpfs', [{ fileSizeMb: 64 }]));
    } catch (error) {
      setOpfs({
        ok: false,
        device: 'opfs',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      client.terminate();
      setBusy(null);
      setProgress('');
    }
  }, []);

  const report = useMemo(
    () => ({
      tool: 'tabula-system-report',
      schemaVersion: 1,
      capabilities: caps,
      workerCapabilities: workerCaps,
      boot: bootResult,
      embeddings: rows,
      opfs,
      userAgent: navigator.userAgent,
    }),
    [caps, workerCaps, bootResult, rows, opfs],
  );

  useEffect(() => {
    (globalThis as { __tabulaReport?: unknown }).__tabulaReport = report;
  }, [report]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tabula-system-report-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [report]);

  if (!caps || !bootResult) {
    return (
      <main className={styles.loading}>
        <AppIcon name="computer" size={32} />
        <p>Reading this computer…</p>
      </main>
    );
  }

  const embeddingBackend = preferredBackend(caps, 'text-embedding');
  const heavyBackend = preferredBackend(caps, 'image-text-embedding');
  const gpuName = [caps.gpu.vendor?.toUpperCase(), caps.gpu.architecture?.toUpperCase()]
    .filter(Boolean)
    .join(' ');
  const isolationOk =
    bootResult.isolation === 'isolated' || bootResult.isolation === 'isolated-dev';
  const storageUsed = caps.storage.usageBytes ?? 0;
  const storageQuota = caps.storage.quotaBytes ?? 0;
  const storagePercent = storageQuota > 0 ? Math.min(100, (storageUsed / storageQuota) * 100) : 0;
  const current = PAGES.find((entry) => entry.id === page) ?? PAGES[0];

  return (
    <main className={styles.app}>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="My Computer sections">
          <div className={styles.navHeading}>
            <AppIcon name="computer" size={24} />
            <span>My Computer</span>
          </div>
          {PAGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`${styles.navItem} ${page === entry.id ? styles.navItemActive : ''}`}
              aria-current={page === entry.id ? 'page' : undefined}
              onClick={() => setPage(entry.id)}
            >
              <Icon name={entry.icon} size={16} className={styles.navIcon} />
              <span>{entry.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.pane}>
          <header className={styles.pageHeader}>
            <p className={styles.breadcrumb}>My Computer</p>
            <h1>{current.label}</h1>
          </header>

          {bootResult.updateWaiting ? (
            <div className={styles.updateBar}>
              <span>A newer build of Tabula is ready.</span>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void restartForUpdate()}
              >
                Restart now
              </button>
            </div>
          ) : null}

          {page === 'general' ? (
            <div className={styles.page}>
              <section className={styles.hero}>
                <div className={styles.heroIcon}>
                  <AppIcon name="computer" size={48} />
                </div>
                <div className={styles.heroCopy}>
                  <p className={styles.eyebrow}>TABULA COMPUTER</p>
                  <h2>Browser Desktop</h2>
                  <p>
                    A complete local machine inside this tab, powered by the hardware beneath it.
                  </p>
                </div>
                <div className={styles.heroStatus}>
                  <Status state={caps.tier === 'C' ? 'warn' : 'ok'}>
                    Hardware tier {caps.tier}
                  </Status>
                  <Status state={caps.gpu.available ? 'ok' : 'warn'}>
                    {caps.gpu.available ? 'WebGPU ready' : 'WASM graphics'}
                  </Status>
                </div>
              </section>

              <Group title="Device specifications">
                <div className={styles.specGrid}>
                  <Spec
                    icon="cpu"
                    label="Processor"
                    value={`${caps.hardwareConcurrency} logical processors available`}
                  />
                  <Spec
                    icon="drive"
                    label="Installed memory"
                    value={
                      caps.deviceMemoryGb
                        ? `${caps.deviceMemoryGb} GB reported by the browser`
                        : 'Not reported by this browser'
                    }
                  />
                  <Spec
                    icon="computer"
                    label="Graphics"
                    value={
                      caps.gpu.available
                        ? `${gpuName || 'WebGPU adapter'} · WebGPU`
                        : 'WebAssembly fallback'
                    }
                  />
                  <Spec
                    icon="bolt"
                    label="System type"
                    value={`${isolationOk ? 'Isolated' : 'Standard'} browser process · ${
                      caps.wasm.threads ? 'multi-threaded' : 'single-threaded'
                    } WASM`}
                  />
                </div>
              </Group>

              <Group title="Local storage">
                <div className={styles.storageSummary}>
                  <Icon name="drive" size={26} />
                  <div className={styles.storageCopy}>
                    <div className={styles.storageLine}>
                      <strong>Browser storage</strong>
                      <span>
                        {formatBytes(storageUsed)} used of {formatBytes(storageQuota)}
                      </span>
                    </div>
                    <div className={styles.storageTrack} aria-hidden="true">
                      <span
                        style={{ width: `${Math.max(storagePercent, storageUsed ? 1 : 0)}%` }}
                      />
                    </div>
                    <p>
                      {persistence.persisted
                        ? 'Protected from automatic browser cleanup.'
                        : 'Best-effort storage; the browser controls retention.'}
                    </p>
                  </div>
                </div>
              </Group>

              <p className={styles.tierReason}>{caps.tierReason}</p>
            </div>
          ) : null}

          {page === 'hardware' ? (
            <div className={styles.page}>
              <Group title="Graphics adapter">
                <dl className={styles.readings}>
                  <Reading label="WebGPU" value={yes(caps.gpu.available)} />
                  <Reading
                    label="Vendor"
                    value={<code>{caps.gpu.vendor ?? 'Not reported'}</code>}
                  />
                  <Reading
                    label="Architecture"
                    value={<code>{caps.gpu.architecture ?? 'Not reported'}</code>}
                  />
                  <Reading
                    label="Description"
                    value={<code>{caps.gpu.description || caps.gpu.device || 'Not reported'}</code>}
                  />
                  <Reading label="Maximum buffer" value={formatBytes(caps.gpu.maxBufferBytes)} />
                  <Reading label="16-bit shaders" value={yes(caps.gpu.shaderF16)} />
                  {caps.gpu.fallbackAdapter ? (
                    <Reading
                      label="Adapter mode"
                      value={<Status state="warn">Software fallback</Status>}
                    />
                  ) : null}
                </dl>
              </Group>

              <Group title="Processor and memory">
                <dl className={styles.readings}>
                  <Reading
                    label="Logical processors"
                    value={<code>{caps.hardwareConcurrency}</code>}
                  />
                  <Reading
                    label="Memory"
                    value={
                      <code>
                        {caps.deviceMemoryGb ? `${caps.deviceMemoryGb} GB` : 'Not reported'}
                      </code>
                    }
                    note="Rounded value exposed by the browser"
                  />
                  <Reading label="WASM SIMD" value={yes(caps.wasm.simd)} />
                  <Reading label="WASM threads" value={yes(caps.wasm.threads)} />
                  <Reading label="Shared memory" value={yes(caps.sharedArrayBuffer)} />
                  <Reading
                    label="Process isolation"
                    value={yes(caps.crossOriginIsolated, 'Enabled', 'Disabled')}
                  />
                </dl>
              </Group>

              <Group title="Storage device">
                <dl className={styles.readings}>
                  <Reading
                    label="File system"
                    value={yes(caps.storage.opfs, 'OPFS available', 'OPFS unavailable')}
                  />
                  <Reading
                    label="Synchronous access"
                    value={
                      workerCaps ? (
                        yes(workerCaps.syncAccessHandle)
                      ) : (
                        <Status state="warn">Detecting…</Status>
                      )
                    }
                    note="Worker-only storage path"
                  />
                  <Reading
                    label="Database"
                    value={yes(
                      caps.storage.indexedDB,
                      'IndexedDB available',
                      'IndexedDB unavailable',
                    )}
                  />
                  <Reading
                    label="Retention"
                    value={
                      persistence.persisted ? (
                        <Status state="ok">Persistent</Status>
                      ) : (
                        <Status state="warn">Best effort</Status>
                      )
                    }
                  />
                  <Reading label="Capacity" value={formatBytes(caps.storage.quotaBytes)} />
                  <Reading label="In use" value={formatBytes(caps.storage.usageBytes)} />
                </dl>
              </Group>
            </div>
          ) : null}

          {page === 'capabilities' ? (
            <div className={styles.page}>
              <p className={styles.intro}>
                These are interfaces this browser makes available to Tabula. They describe the
                virtual machine, not promises about physical hardware.
              </p>
              <div className={styles.groupGrid}>
                <Group title="Files and folders">
                  <dl className={styles.readings}>
                    <Reading
                      label="Directory picker"
                      value={yes(caps.fileSystemAccess.directoryPicker)}
                      {...(caps.fileSystemAccess.directoryPicker
                        ? {}
                        : { note: 'Drag and drop remains available' })}
                    />
                    <Reading label="File picker" value={yes(caps.fileSystemAccess.filePicker)} />
                    <Reading
                      label="Dropped handles"
                      value={yes(caps.fileSystemAccess.dragDropHandles)}
                    />
                  </dl>
                </Group>
                <Group title="Media">
                  <dl className={styles.readings}>
                    <Reading label="WebCodecs" value={yes(caps.media.webCodecs)} />
                    <Reading label="Offscreen canvas" value={yes(caps.media.offscreenCanvas)} />
                    <Reading label="Image bitmap" value={yes(caps.media.imageBitmap)} />
                    <Reading label="Service worker" value={yes(caps.serviceWorker)} />
                  </dl>
                </Group>
                <Group title="Browser AI interfaces">
                  <dl className={styles.readings}>
                    <Reading
                      label="Prompt API"
                      value={yes(caps.builtinAi.promptApi, 'Present', 'Absent')}
                    />
                    <Reading
                      label="Availability"
                      value={<code>{caps.builtinAi.availability ?? 'Not reported'}</code>}
                    />
                    <Reading
                      label="Summarizer"
                      value={yes(caps.builtinAi.summarizer, 'Present', 'Absent')}
                    />
                    <Reading
                      label="Translator"
                      value={yes(caps.builtinAi.translator, 'Present', 'Absent')}
                    />
                    <Reading label="WebNN" value={yes(caps.webnn, 'Present', 'Absent')} />
                  </dl>
                  <p className={styles.groupNote}>
                    Tabula reports these interfaces but does not use them for text generation. Its
                    search models only point into files already on this computer.
                  </p>
                </Group>
                <Group title="Kernel choices">
                  <dl className={styles.readings}>
                    <Reading label="Text search" value={<code>{embeddingBackend}</code>} />
                    <Reading label="Heavy inference" value={<code>{heavyBackend}</code>} />
                    <Reading label="Hardware tier" value={<code>Tier {caps.tier}</code>} />
                    <Reading
                      label="Last detected"
                      value={<code>{new Date(caps.probedAt).toLocaleString()}</code>}
                    />
                  </dl>
                </Group>
              </div>
            </div>
          ) : null}

          {page === 'performance' ? (
            <div className={styles.page}>
              <Group title="Embedding benchmark">
                <p className={styles.intro}>
                  {BATCHES} batches of {BATCH_SIZE} sentences through <code>{MODEL}</code> (int8),
                  after a warm-up pass. The test runs locally in a worker.
                </p>
                <div className={styles.controls}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={busy !== null || !caps.gpu.available}
                    onClick={() => void runEmbeddingBench('webgpu')}
                  >
                    Run on WebGPU
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy !== null}
                    onClick={() => void runEmbeddingBench('wasm')}
                  >
                    Run on WASM
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy !== null || !caps.storage.opfs}
                    onClick={() => void runOpfsBench()}
                  >
                    Test storage
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={rows.length === 0 && !opfs}
                    onClick={exportJson}
                  >
                    Export report
                  </button>
                </div>
                <p className={styles.progress} role="status" aria-live="polite">
                  {progress || (busy ? 'Working…' : '\u00a0')}
                </p>

                {rows.length > 0 ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <caption className="visually-hidden">
                        Embedding benchmark results by backend
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Backend</th>
                          <th scope="col">Load</th>
                          <th scope="col">Warm-up</th>
                          <th scope="col">ms / chunk</th>
                          <th scope="col">chunks / s</th>
                          <th scope="col">Threads</th>
                          <th scope="col">Read</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, index) => (
                          <tr key={index}>
                            <th scope="row">
                              <code>{row.label}</code>
                            </th>
                            {row.ok ? (
                              <>
                                <td>{row.loadMs} ms</td>
                                <td>{row.warmupMs} ms</td>
                                <td className={styles.number}>{row.msPerChunk}</td>
                                <td className={styles.number}>{row.chunksPerSecond}</td>
                                <td>{row.numThreads}</td>
                                <td>{formatBytes(row.transferredBytes)}</td>
                              </>
                            ) : (
                              <td colSpan={6} className={styles.error}>
                                {row.error}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={styles.emptyResult}>
                    No performance tests have been run in this session.
                  </p>
                )}

                {opfs ? (
                  <p className={styles.opfsResult}>
                    {opfs.ok ? (
                      <>
                        Browser storage, {opfs.fileSizeMb} MB — write{' '}
                        <strong>{opfs.writeMbPerSecond} MB/s</strong>, read{' '}
                        <strong>{opfs.readMbPerSecond} MB/s</strong>{' '}
                        <span>
                          ({opfs.usedSyncAccessHandle ? 'sync access handle' : 'stream fallback'})
                        </span>
                      </>
                    ) : (
                      <span className={styles.error}>Storage test failed: {opfs.error}</span>
                    )}
                  </p>
                ) : null}
              </Group>
            </div>
          ) : null}

          {page === 'about' ? (
            <div className={styles.page}>
              <section className={styles.aboutHero}>
                <div className={styles.aboutMark}>
                  <AppIcon name="computer" size={48} />
                </div>
                <div>
                  <p className={styles.eyebrow}>BROWSER DESKTOP</p>
                  <h2>Tabula</h2>
                  <p>Version {packageInfo.version}</p>
                </div>
              </section>

              <Group title="About this desktop">
                <div className={styles.aboutCopy}>
                  <p>
                    Tabula is a local-first AI desktop that runs entirely in one browser tab. Its
                    windows, files, apps, search index and models are delivered as static files.
                  </p>
                  <p>
                    There is no account, backend, sync service, telemetry or text generator. Files
                    placed here remain in browser storage on this device.
                  </p>
                </div>
              </Group>

              <Group title="System information">
                <dl className={styles.readings}>
                  <Reading label="Product" value="Tabula Browser Desktop" />
                  <Reading label="Version" value={<code>{packageInfo.version}</code>} />
                  <Reading label="Runtime" value="Static browser application" />
                  <Reading
                    label="Network"
                    value="Serving origin only; Watch can load one consented YouTube frame"
                  />
                  <Reading label="Build status" value={bootResult.detail} />
                  <Reading label="Browser" value={<code>{navigator.userAgent}</code>} />
                </dl>
              </Group>

              <p className={styles.license}>
                Tabula is open-source software released under the MIT License.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

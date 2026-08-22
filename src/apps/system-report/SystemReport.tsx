import { useCallback, useEffect, useMemo, useState } from 'react';
import { probeCapabilities, preferredBackend, type Capabilities } from '../../kernel/capabilities';
import { boot, restartForUpdate, type BootResult } from '../../kernel/boot';
import { probeWorkerCapabilities, type WorkerCapabilities } from '../../kernel/worker-probe';
import { createBenchClient } from '../../services/bench/client';
import type {
  BenchFailure,
  EmbeddingBenchResult,
  OpfsBenchResult,
} from '../../services/bench/client';
import { useCapabilities } from '../../shell/capabilitiesContext';
import { usePersistence } from '../../kernel/persistence';
import styles from './SystemReport.module.css';

/**
 * M0's deliverable, and the app's first screen.
 *
 * It answers the two questions the rest of the project is built on: what can this machine do,
 * and how fast does it actually do it. The numbers it produces are committed to
 * docs/benchmarks/, which is how model choices stop being guesses.
 *
 * From M1 this becomes the About/Stats app inside the desktop rather than the whole page.
 */

type BenchRow = (EmbeddingBenchResult | BenchFailure) & { label: string };

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const BATCH_SIZE = 16;
const BATCHES = 8;

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
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

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowLabel}>{label}</dt>
      <dd className={styles.rowValue}>
        {value}
        {note ? <span className={styles.rowNote}>{note}</span> : null}
      </dd>
    </div>
  );
}

const yes = (value: boolean, on = 'yes', off = 'no') => (
  <Status state={value ? 'ok' : 'warn'}>{value ? on : off}</Status>
);

export function SystemReport() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [workerCaps, setWorkerCaps] = useState<WorkerCapabilities | null>(null);
  const [bootResult, setBootResult] = useState<BootResult | null>(null);
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [opfs, setOpfs] = useState<OpfsBenchResult | BenchFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  // Live rather than from the capability probe: the probe runs before boot asks for persistence,
  // so it would report "best-effort" for the rest of the session however the browser answered.
  const persistence = usePersistence();

  // Inside the desktop the probe has already run at boot, so reuse it rather than paying for a
  // second GPU adapter request and a second reload check. Standalone, it probes for itself.
  const system = useCapabilities();

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

  const embeddingBackend = caps ? preferredBackend(caps, 'text-embedding') : null;
  const heavyBackend = caps ? preferredBackend(caps, 'image-text-embedding') : null;

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
            const p = payload as {
              status?: string;
              file?: string;
              progress?: number;
              batch?: number;
              of?: number;
            };
            if (p.status === 'batch') setProgress(`Running batch ${p.batch}/${p.of} on ${device}…`);
            else if (p.status === 'progress' && p.file)
              setProgress(`Downloading ${p.file} — ${Math.round(p.progress ?? 0)}%`);
            else if (p.status) setProgress(`${p.status} ${p.file ?? ''}`.trim());
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
    setProgress('Writing and reading a 64 MB file in OPFS…');
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

  /**
   * Automation hook. Benchmarks are only useful if they can be collected without a human
   * clicking, so the current report is mirrored here for Playwright (and for scraping a run into
   * docs/benchmarks/). Read-only; nothing in the app consumes it.
   */
  useEffect(() => {
    (globalThis as { __tabulaReport?: unknown }).__tabulaReport = report;
  }, [report]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tabula-benchmark-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [report]);

  if (!caps || !bootResult) {
    return (
      <main className={styles.page}>
        <p className={styles.booting}>Probing this machine…</p>
      </main>
    );
  }

  const isolationState =
    bootResult.isolation === 'isolated' || bootResult.isolation === 'isolated-dev'
      ? 'ok'
      : bootResult.isolation === 'degraded' || bootResult.isolation === 'unsupported'
        ? 'warn'
        : 'ok';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Tabula</h1>
          <p className={styles.tagline}>
            A local-first AI desktop that runs entirely in this tab. Milestone M0 — foundations.
          </p>
        </div>
        <div className={styles.chips}>
          <Status state={caps.tier === 'C' ? 'warn' : 'ok'}>Tier {caps.tier}</Status>
          <Status state={caps.gpu.available ? 'ok' : 'warn'}>
            {caps.gpu.available ? 'WebGPU' : 'WASM only'}
          </Status>
          <Status state={isolationState}>
            {caps.crossOriginIsolated ? 'cross-origin isolated' : 'not isolated'}
          </Status>
        </div>
      </header>

      <p className={styles.tierReason}>{caps.tierReason}</p>

      {bootResult.updateWaiting ? (
        <div className={styles.updateBar}>
          <span>A newer build is ready.</span>
          <button type="button" className={styles.primary} onClick={() => void restartForUpdate()}>
            Restart to update
          </button>
        </div>
      ) : null}

      <section aria-labelledby="capabilities-heading" className={styles.section}>
        <h2 id="capabilities-heading" className={styles.sectionTitle}>
          Capabilities
        </h2>
        <div className={styles.grid}>
          <article className={styles.card}>
            <h3 className={styles.cardTitle}>GPU</h3>
            <dl className={styles.list}>
              <Row label="WebGPU" value={yes(caps.gpu.available)} />
              <Row label="Vendor" value={<code>{caps.gpu.vendor ?? '—'}</code>} />
              <Row label="Architecture" value={<code>{caps.gpu.architecture ?? '—'}</code>} />
              <Row
                label="Description"
                value={<code>{caps.gpu.description || caps.gpu.device || '—'}</code>}
              />
              <Row label="Max buffer" value={formatBytes(caps.gpu.maxBufferBytes)} />
              <Row label="shader-f16" value={yes(caps.gpu.shaderF16)} />
              {caps.gpu.fallbackAdapter ? (
                <Row label="Adapter" value={<Status state="warn">software fallback</Status>} />
              ) : null}
              {caps.gpu.error ? <Row label="Error" value={<code>{caps.gpu.error}</code>} /> : null}
            </dl>
          </article>

          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Compute</h3>
            <dl className={styles.list}>
              <Row label="WASM SIMD" value={yes(caps.wasm.simd)} />
              <Row label="WASM threads" value={yes(caps.wasm.threads)} />
              <Row label="SharedArrayBuffer" value={yes(caps.sharedArrayBuffer)} />
              <Row label="Cross-origin isolated" value={yes(caps.crossOriginIsolated)} />
              <Row label="Logical cores" value={<code>{caps.hardwareConcurrency}</code>} />
              <Row
                label="Device memory"
                value={
                  <code>{caps.deviceMemoryGb ? `${caps.deviceMemoryGb} GB` : 'not reported'}</code>
                }
              />
            </dl>
          </article>

          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Storage</h3>
            <dl className={styles.list}>
              <Row label="OPFS" value={yes(caps.storage.opfs)} />
              <Row
                label="Sync handles"
                value={
                  workerCaps ? (
                    yes(workerCaps.syncAccessHandle)
                  ) : (
                    <Status state="warn">probing…</Status>
                  )
                }
                note="worker-only API, measured in a worker"
              />
              <Row label="IndexedDB" value={yes(caps.storage.indexedDB)} />
              <Row
                label="Persistent"
                value={yes(persistence.persisted, 'granted', 'best-effort')}
                {...(persistence.persisted
                  ? {}
                  : {
                      note: persistence.supported
                        ? 'asked at boot; the browser decides, and usually says no until a site is used often'
                        : 'this browser cannot be asked',
                    })}
              />
              <Row label="Quota" value={formatBytes(caps.storage.quotaBytes)} />
              <Row label="Used" value={formatBytes(caps.storage.usageBytes)} />
            </dl>
          </article>

          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Files</h3>
            <dl className={styles.list}>
              <Row
                label="Directory picker"
                value={yes(caps.fileSystemAccess.directoryPicker)}
                {...(caps.fileSystemAccess.directoryPicker
                  ? {}
                  : { note: 'drag-and-drop import instead' })}
              />
              <Row label="File picker" value={yes(caps.fileSystemAccess.filePicker)} />
              <Row label="Drop handles" value={yes(caps.fileSystemAccess.dragDropHandles)} />
            </dl>
          </article>

          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Built-in AI</h3>
            <dl className={styles.list}>
              <Row label="Prompt API" value={yes(caps.builtinAi.promptApi, 'present', 'absent')} />
              <Row label="Availability" value={<code>{caps.builtinAi.availability ?? '—'}</code>} />
              <Row label="Summarizer" value={yes(caps.builtinAi.summarizer, 'present', 'absent')} />
              <Row label="Translator" value={yes(caps.builtinAi.translator, 'present', 'absent')} />
              <Row label="WebNN" value={yes(caps.webnn, 'present', 'absent')} />
            </dl>
            <p className={styles.cardNote}>
              Reported because this machine has them, not because Tabula uses them: it has no text
              generation and is not getting any. Every model here answers a question about a file
              you already have, so none of them can invent an answer.
            </p>
          </article>

          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Media</h3>
            <dl className={styles.list}>
              <Row label="WebCodecs" value={yes(caps.media.webCodecs)} />
              <Row label="OffscreenCanvas" value={yes(caps.media.offscreenCanvas)} />
              <Row label="createImageBitmap" value={yes(caps.media.imageBitmap)} />
              <Row label="Service worker" value={yes(caps.serviceWorker)} />
            </dl>
          </article>
        </div>
      </section>

      <section aria-labelledby="bench-heading" className={styles.section}>
        <h2 id="bench-heading" className={styles.sectionTitle}>
          Benchmarks
        </h2>
        <p className={styles.sectionNote}>
          {BATCHES} batches of {BATCH_SIZE} sentences through <code>{MODEL}</code> (int8), timed
          after a warm-up pass, in a worker. Run both backends to see which one this machine should
          actually use.
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
            Run OPFS throughput
          </button>
          <button
            type="button"
            className={styles.ghost}
            disabled={rows.length === 0 && !opfs}
            onClick={exportJson}
          >
            Export JSON
          </button>
        </div>

        <p className={styles.progress} role="status" aria-live="polite">
          {progress || (busy ? 'Working…' : ' ')}
        </p>

        {rows.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="visually-hidden">Embedding benchmark results by backend</caption>
              <thead>
                <tr>
                  <th scope="col">Backend</th>
                  <th scope="col">Load</th>
                  <th scope="col">Warm-up</th>
                  <th scope="col">ms / chunk</th>
                  <th scope="col">chunks / s</th>
                  <th scope="col">Threads</th>
                  <th scope="col">Fetched</th>
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
        ) : null}

        {opfs ? (
          <p className={styles.opfsResult}>
            {opfs.ok ? (
              <>
                OPFS {opfs.fileSizeMb} MB — write <strong>{opfs.writeMbPerSecond} MB/s</strong>,
                read <strong>{opfs.readMbPerSecond} MB/s</strong>{' '}
                <span className={styles.rowNote}>
                  {opfs.usedSyncAccessHandle ? 'sync access handle' : 'writable stream fallback'}
                </span>
              </>
            ) : (
              <span className={styles.error}>OPFS benchmark failed: {opfs.error}</span>
            )}
          </p>
        ) : null}
      </section>

      <footer className={styles.footer}>
        <p>
          Backend the kernel would choose here: <code>{embeddingBackend}</code> for text embeddings,{' '}
          <code>{heavyBackend}</code> for vision and speech models. Everything above ran on this
          machine. The only hosts this page contacts are the one serving it and{' '}
          <code>huggingface.co</code>, for model weights during a benchmark run.
        </p>
        <p className={styles.buildNote}>{bootResult.detail}</p>
      </footer>
    </main>
  );
}

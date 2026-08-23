import { useEffect, useState } from 'react';
import { cancelJob, clearFinishedJobs, useJobs } from '../../kernel/jobs';
import { useVfsStats } from '../../kernel/vfs/client';
import { formatBytes } from '../../kernel/vfs/types';
import { useIndexStats, useIndexerState } from '../../services/index/client';
import { useCapabilities } from '../../shell/capabilitiesContext';
import { ContextMenu, separator, useContextMenu } from '../../shell/ContextMenu';
import { Icon } from '../../shell/Icon';
import { copyText } from '../../shell/nodeMenu';
import { getNetworkLog, useNetworkLog } from '../../kernel/network';
import styles from './TaskManagerApp.module.css';

/**
 * Task Manager.
 *
 * Every job, every model, every byte stored — and every network request the page has made since it
 * loaded. That last panel is the one that matters most: the privacy claim in the README is only
 * worth anything if the user can check it, and this is where they check it.
 */
export default function TaskManagerApp() {
  const jobs = useJobs();
  const vfsStats = useVfsStats();
  const indexStats = useIndexStats();
  const indexer = useIndexerState();
  const capabilities = useCapabilities();
  const network = useNetworkLog();
  const [tab, setTab] = useState<'jobs' | 'system' | 'network'>('jobs');

  const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued');
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  return (
    <div className={styles.app}>
      <div className={styles.tabs} role="tablist">
        {(['jobs', 'system', 'network'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'jobs' ? `Jobs${active.length ? ` (${active.length})` : ''}` : null}
            {key === 'system' ? 'System' : null}
            {key === 'network' ? `Network (${network.length})` : null}
          </button>
        ))}
      </div>

      {tab === 'jobs' ? (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>
              {active.length} active · {jobs.length - active.length} finished
            </span>
            <button type="button" className={styles.smallButton} onClick={clearFinishedJobs}>
              Clear finished
            </button>
          </div>

          {jobs.length === 0 ? (
            <p className={styles.empty}>Nothing running. Import files or run a search.</p>
          ) : (
            <ul className={styles.jobs}>
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className={styles.job}
                  onContextMenu={(event) =>
                    openMenu(event, [
                      {
                        id: 'job.cancel',
                        label: 'Cancel this job',
                        disabled: job.status !== 'running' && job.status !== 'queued',
                        danger: true,
                        run: () => cancelJob(job.id),
                      },
                      {
                        id: 'job.copy',
                        label: 'Copy job details',
                        run: () =>
                          copyText(
                            [job.label, job.detail, job.error].filter(Boolean).join(' — '),
                            'Job details copied',
                          ),
                      },
                      separator('job.s1'),
                      {
                        id: 'job.clear',
                        label: 'Clear finished jobs',
                        run: () => clearFinishedJobs(),
                      },
                    ])
                  }
                >
                  <span className={`${styles.status} ${styles[job.status]}`}>{job.status}</span>
                  <div className={styles.jobBody}>
                    <p className={styles.jobLabel}>{job.label}</p>
                    {job.detail ? <p className={styles.jobDetail}>{job.detail}</p> : null}
                    {job.error ? <p className={styles.jobError}>{job.error}</p> : null}
                    {job.status === 'running' ? (
                      <div className={styles.progressTrack}>
                        <div
                          className={`${styles.progressBar} ${job.progress === null ? styles.indeterminate : ''}`}
                          style={
                            job.progress === null ? undefined : { width: `${job.progress * 100}%` }
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                  <span className={styles.jobKind}>{job.kind}</span>
                  {job.status === 'running' || job.status === 'queued' ? (
                    <button
                      type="button"
                      className={styles.cancel}
                      onClick={() => cancelJob(job.id)}
                      aria-label={`Cancel ${job.label}`}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  ) : (
                    <span className={styles.duration}>
                      {job.startedAt && job.endedAt ? `${job.endedAt - job.startedAt} ms` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'system' ? (
        <div className={styles.panel}>
          <section className={styles.section}>
            <h3>Inference</h3>
            <dl className={styles.grid}>
              <Row label="Backend" value={capabilities?.backend ?? '—'} />
              <Row label="GPU" value={capabilities?.gpu.vendor ?? 'not available'} />
              <Row label="Architecture" value={capabilities?.gpu.architecture ?? '—'} />
              <Row
                label="Isolated"
                value={
                  capabilities?.capabilities.crossOriginIsolated
                    ? 'yes (threads on)'
                    : 'no (single thread)'
                }
              />
              <Row label="Model" value={indexStats?.model ?? '—'} />
              <Row
                label="Model loaded"
                value={indexStats?.ready ? 'yes' : indexer.modelLoading ? 'loading…' : 'not yet'}
              />
              {indexer.modelProgress ? (
                <Row label="Downloading" value={indexer.modelProgress} />
              ) : null}
            </dl>
          </section>

          <section className={styles.section}>
            <h3>Search index</h3>
            <dl className={styles.grid}>
              <Row label="Documents" value={String(indexStats?.documents ?? 0)} />
              <Row label="Passages" value={String(indexStats?.chunks ?? 0)} />
              <Row label="Unique terms" value={String(indexStats?.terms ?? 0)} />
              <Row label="Dimensions" value={String(indexStats?.dimensions ?? 0)} />
              <Row label="Vector memory" value={formatBytes(indexStats?.vectorBytes ?? 0)} />
              <Row label="Waiting to index" value={String(indexer.pending)} />
            </dl>
          </section>

          <section className={styles.section}>
            <h3>Storage</h3>
            <dl className={styles.grid}>
              <Row label="Files" value={String(vfsStats?.files ?? 0)} />
              <Row label="Folders" value={String(vfsStats?.directories ?? 0)} />
              <Row label="In Trash" value={String(vfsStats?.trashed ?? 0)} />
              <Row label="Logical size" value={formatBytes(vfsStats?.bytes ?? 0)} />
              <Row
                label="Stored"
                value={`${formatBytes(vfsStats?.storedBytes ?? 0)}${
                  vfsStats && vfsStats.bytes > vfsStats.storedBytes
                    ? ` (${formatBytes(vfsStats.bytes - vfsStats.storedBytes)} deduplicated)`
                    : ''
                }`}
              />
              <Row
                label="Quota"
                value={formatBytes(capabilities?.capabilities.storage.quotaBytes ?? 0)}
              />
            </dl>
          </section>
        </div>
      ) : null}

      {tab === 'network' ? (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>
              {network.length} request{network.length === 1 ? '' : 's'} since this tab loaded
            </span>
          </div>
          <p className={styles.networkNote}>
            Everything this page has fetched, recorded from the browser&rsquo;s own timing data.
            Files you import are never uploaded — there is no server to upload them to.
          </p>
          {/*
            Stated whether or not a video is loaded. A caveat that appears only when it bites reads
            as an excuse; one that is always there is a description of the instrument.
          */}
          <p className={styles.networkNote}>
            One limit worth knowing: this is a list of requests <em>this page</em> made. Watch loads
            a YouTube frame, and the requests the player then makes inside that frame are its own —
            they do not appear here and cannot, so the absence of a row is not evidence that nothing
            happened in there.
          </p>
          {network.length === 0 ? (
            <p className={styles.empty}>No requests recorded.</p>
          ) : (
            <ul className={styles.requests}>
              {network.map((entry, index) => (
                <li
                  key={index}
                  className={styles.request}
                  onContextMenu={(event) =>
                    openMenu(event, [
                      {
                        id: 'req.copy',
                        label: 'Copy request URL',
                        run: () => copyText(entry.origin + entry.path, 'Request URL copied'),
                      },
                      {
                        id: 'req.copyAll',
                        label: 'Copy the whole log',
                        run: () =>
                          copyText(
                            getNetworkLog()
                              .map((row) => row.origin + row.path)
                              .join('\n'),
                            'Network log copied',
                          ),
                      },
                    ])
                  }
                >
                  <span className={`${styles.origin} ${entry.thirdParty ? styles.thirdParty : ''}`}>
                    {entry.origin}
                  </span>
                  <span className={styles.requestPath}>{entry.path}</span>
                  <span className={styles.requestSize}>
                    {entry.bytes > 0 ? formatBytes(entry.bytes) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Re-exported for the About app, which shows a condensed version of the same data. */
export { getNetworkLog };

/** Refreshes the network log on an interval while the panel is open. */
export function useNetworkPolling(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((value) => value + 1), 2000);
    return () => clearInterval(timer);
  }, [active]);
}

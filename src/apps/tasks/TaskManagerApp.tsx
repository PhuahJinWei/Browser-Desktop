import { useEffect, useMemo, useState } from 'react';
import { getApp, type AppProps } from '../../kernel/apps';
import { cancelJob, clearFinishedJobs, MAX_CONCURRENT, useJobs, type Job } from '../../kernel/jobs';
import { getNetworkLog, useNetworkLog, type NetworkEntry } from '../../kernel/network';
import { useVfsStats } from '../../kernel/vfs/client';
import { formatBytes } from '../../kernel/vfs/types';
import { closeWindow, focusWindow, useFocusedWindowId, useWindows } from '../../kernel/windows';
import { useIndexStats, useIndexerState } from '../../services/index/client';
import { useCapabilities } from '../../shell/capabilitiesContext';
import { ContextMenu, separator, useContextMenu, type MenuSpec } from '../../shell/ContextMenu';
import { Icon, type IconName } from '../../shell/Icon';
import { copyText } from '../../shell/nodeMenu';
import { AppIcon } from '../../shell/PixelIcon';
import styles from './TaskManagerApp.module.css';

type PageId = 'processes' | 'performance' | 'network' | 'details';

const PAGES = [
  {
    id: 'processes',
    label: 'Processes',
    icon: 'list',
    description: 'Open applications, background work and system services',
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: 'gauge',
    description: 'Measured activity, inference, search memory and storage',
  },
  {
    id: 'network',
    label: 'Network',
    icon: 'offline',
    description: 'Every request recorded by this page',
  },
  {
    id: 'details',
    label: 'Details',
    icon: 'cpu',
    description: 'Scheduler history and kernel configuration',
  },
] as const satisfies readonly {
  id: PageId;
  label: string;
  icon: IconName;
  description: string;
}[];

interface ProcessItem {
  key: string;
  name: string;
  detail: string;
  icon: IconName;
  type: 'Application' | 'Background task' | 'System service';
  status: string;
  activity: string;
  end?: () => void;
  activate?: () => void;
}

const priorityName = ['Interactive', 'User', 'Background'] as const;

function durationOf(job: Job): string {
  if (!job.startedAt) return '—';
  const end = job.endedAt ?? Date.now();
  const milliseconds = Math.max(0, end - job.startedAt);
  if (milliseconds < 1000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.floor((milliseconds % 60_000) / 1000)}s`;
}

function requestTime(entry: NetworkEntry): string {
  return new Date(performance.timeOrigin + entry.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Task Manager is an instrument, not theatre.
 *
 * Browsers do not expose per-process CPU or physical-memory readings, so this surface never
 * invents them. Its Windows shape is made from things the desktop genuinely knows: its windows,
 * scheduler, workers, storage, vector memory and the browser's own resource-timing log.
 */
export default function TaskManagerApp({ windowId }: AppProps) {
  const windows = useWindows();
  const focusedId = useFocusedWindowId();
  const jobs = useJobs();
  const network = useNetworkLog();
  const vfsStats = useVfsStats();
  const indexStats = useIndexStats();
  const indexer = useIndexerState();
  const capabilities = useCapabilities();
  const [page, setPage] = useState<PageId>('processes');
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [activity, setActivity] = useState<number[]>(() => Array.from({ length: 36 }, () => 0));
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const activeJobs = jobs.filter((job) => job.status === 'running' || job.status === 'queued');
  const runningJobs = jobs.filter((job) => job.status === 'running');
  const finishedJobs = jobs.length - activeJobs.length;

  useEffect(() => {
    const sample = () =>
      setActivity((previous) => [...previous.slice(1), runningJobs.length].slice(-36));
    sample();
    const timer = setInterval(sample, 1000);
    return () => clearInterval(timer);
  }, [runningJobs.length]);

  const applications = useMemo<ProcessItem[]>(
    () =>
      windows.map((window) => {
        const app = getApp(window.appId);
        return {
          key: `window:${window.id}`,
          name: window.title,
          detail: app?.name && app.name !== window.title ? app.name : app?.description || 'Window',
          icon: app?.icon ?? 'apps',
          type: 'Application',
          status: window.minimized ? 'Minimized' : focusedId === window.id ? 'Active' : 'Running',
          activity: window.id === windowId ? 'This window' : 'User interface',
          end: () => closeWindow(window.id),
          activate: () => focusWindow(window.id),
        };
      }),
    [windows, focusedId, windowId],
  );

  const background = useMemo<ProcessItem[]>(
    () =>
      activeJobs.map((job) => ({
        key: `job:${job.id}`,
        name: job.label,
        detail: job.detail ?? `${priorityName[job.priority]} priority`,
        icon: job.kind === 'index' || job.kind === 'search' ? 'search' : 'cpu',
        type: 'Background task',
        status: job.status === 'running' ? 'Running' : 'Queued',
        activity:
          job.progress === null
            ? job.status === 'running'
              ? 'Working'
              : 'Waiting'
            : `${Math.round(job.progress * 100)}%`,
        end: () => cancelJob(job.id),
      })),
    [activeJobs],
  );

  const services = useMemo<ProcessItem[]>(
    () => [
      {
        key: 'service:vfs',
        name: 'File system service',
        detail: 'Origin private file system',
        icon: 'drive',
        type: 'System service',
        status: 'Running',
        activity: vfsStats ? `${vfsStats.files} files` : 'Starting',
      },
      {
        key: 'service:index',
        name: 'Search index service',
        detail: indexStats?.model ?? 'Text and image index',
        icon: 'search',
        type: 'System service',
        status: indexer.modelLoading ? 'Loading' : indexStats?.ready ? 'Ready' : 'Idle',
        activity: indexer.pending ? `${indexer.pending} waiting` : 'Up to date',
      },
    ],
    [vfsStats, indexStats, indexer.modelLoading, indexer.pending],
  );

  const allProcesses = useMemo(
    () => [...applications, ...background, ...services],
    [applications, background, services],
  );
  const selected = allProcesses.find((item) => item.key === selectedProcess) ?? null;

  useEffect(() => {
    if (selectedProcess && !allProcesses.some((item) => item.key === selectedProcess)) {
      setSelectedProcess(null);
    }
  }, [allProcesses, selectedProcess]);

  const processMenu = (item: ProcessItem): MenuSpec => {
    const spec: MenuSpec = [];
    if (item.activate) {
      spec.push({ id: 'process.switch', label: 'Switch to', run: item.activate });
    }
    if (item.end) {
      spec.push({ id: 'process.end', label: 'End task', danger: true, run: item.end });
    }
    if (spec.length) spec.push(separator('process.s1'));
    spec.push({
      id: 'process.copy',
      label: 'Copy details',
      run: () =>
        copyText(
          [item.name, item.type, item.status, item.activity, item.detail].join(' — '),
          'Process details copied',
        ),
    });
    return spec;
  };

  const current = PAGES.find((entry) => entry.id === page) ?? PAGES[0];
  const storageQuota = capabilities?.capabilities.storage.quotaBytes ?? 0;
  const storedBytes = vfsStats?.storedBytes ?? 0;
  const storagePercent = storageQuota > 0 ? Math.min(100, (storedBytes / storageQuota) * 100) : 0;
  const gpuName = [capabilities?.gpu.vendor, capabilities?.gpu.architecture]
    .filter(Boolean)
    .join(' ');

  return (
    <main className={styles.app}>
      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Task Manager sections">
          <div className={styles.navBrand}>
            <AppIcon name="gauge" size={22} />
            <span>Task Manager</span>
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
              {entry.id === 'processes' && activeJobs.length ? (
                <span className={styles.badge}>{activeJobs.length}</span>
              ) : null}
              {entry.id === 'network' ? (
                <span className={styles.badge}>{network.length}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <section className={styles.content} aria-labelledby={`task-page-${page}`}>
          <header className={styles.pageHead}>
            <div>
              <h1 id={`task-page-${page}`}>{current.label}</h1>
              <p>{current.description}</p>
            </div>
            <PageCommands
              page={page}
              selected={selected}
              finishedJobs={finishedJobs}
              network={network}
            />
          </header>

          <div className={styles.panel}>
            {page === 'processes' ? (
              <div className={styles.processesPage}>
                <div className={styles.processHeader} role="row">
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Type</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Activity</span>
                </div>
                <ProcessGroup
                  title="Applications"
                  items={applications}
                  selected={selectedProcess}
                  onSelect={setSelectedProcess}
                  onMenu={(event, item) => openMenu(event, processMenu(item))}
                />
                <ProcessGroup
                  title="Background processes"
                  items={background}
                  selected={selectedProcess}
                  onSelect={setSelectedProcess}
                  onMenu={(event, item) => openMenu(event, processMenu(item))}
                  empty="No queued or running background work."
                />
                <ProcessGroup
                  title="System services"
                  items={services}
                  selected={selectedProcess}
                  onSelect={setSelectedProcess}
                  onMenu={(event, item) => openMenu(event, processMenu(item))}
                />
              </div>
            ) : null}

            {page === 'performance' ? (
              <div className={styles.performancePage}>
                <section className={styles.performanceHero}>
                  <div>
                    <p className={styles.metricLabel}>Inference engine</p>
                    <strong>{capabilities?.backend.toUpperCase() ?? '—'}</strong>
                    <p>{gpuName || 'WebAssembly runtime'}</p>
                  </div>
                  <dl className={styles.heroFacts}>
                    <Metric
                      label="Logical processors"
                      value={String(capabilities?.capabilities.hardwareConcurrency ?? '—')}
                    />
                    <Metric
                      label="WASM threads"
                      value={capabilities?.capabilities.wasm.threads ? 'Enabled' : 'Unavailable'}
                    />
                    <Metric
                      label="Hardware tier"
                      value={capabilities ? `Tier ${capabilities.capabilities.tier}` : '—'}
                    />
                  </dl>
                </section>

                <div className={styles.performanceGrid}>
                  <section className={styles.performanceCard}>
                    <header>
                      <div>
                        <h2>Background activity</h2>
                        <p>Running scheduler slots, last 36 seconds</p>
                      </div>
                      <strong>
                        {runningJobs.length} / {MAX_CONCURRENT}
                      </strong>
                    </header>
                    <div
                      className={styles.activityChart}
                      role="img"
                      aria-label={`${runningJobs.length} of ${MAX_CONCURRENT} scheduler slots active`}
                    >
                      {activity.map((value, index) => (
                        <span
                          key={index}
                          style={{
                            height: `${value === 0 ? 3 : Math.max(12, (value / MAX_CONCURRENT) * 100)}%`,
                          }}
                        />
                      ))}
                    </div>
                    <div className={styles.cardFooter}>
                      <span>
                        {activeJobs.filter((job) => job.status === 'queued').length} queued
                      </span>
                      <span>{finishedJobs} completed</span>
                    </div>
                  </section>

                  <section className={styles.performanceCard}>
                    <header>
                      <div>
                        <h2>Search index</h2>
                        <p>{indexStats?.model ?? 'Embedding model not loaded'}</p>
                      </div>
                      <strong>{formatBytes(indexStats?.vectorBytes ?? 0)}</strong>
                    </header>
                    <dl className={styles.metrics}>
                      <Metric label="Documents" value={String(indexStats?.documents ?? 0)} />
                      <Metric label="Passages" value={String(indexStats?.chunks ?? 0)} />
                      <Metric label="Dimensions" value={String(indexStats?.dimensions ?? 0)} />
                      <Metric label="Waiting" value={String(indexer.pending)} />
                    </dl>
                  </section>

                  <section className={`${styles.performanceCard} ${styles.storageCard}`}>
                    <header>
                      <div>
                        <h2>Local storage</h2>
                        <p>Files stored by this desktop</p>
                      </div>
                      <strong>{formatBytes(storedBytes)}</strong>
                    </header>
                    <div className={styles.storageTrack} aria-hidden="true">
                      <span
                        style={{ width: `${Math.max(storagePercent, storedBytes ? 1 : 0)}%` }}
                      />
                    </div>
                    <dl className={styles.metrics}>
                      <Metric label="Quota" value={formatBytes(storageQuota)} />
                      <Metric label="Logical size" value={formatBytes(vfsStats?.bytes ?? 0)} />
                      <Metric label="Files" value={String(vfsStats?.files ?? 0)} />
                      <Metric label="Folders" value={String(vfsStats?.directories ?? 0)} />
                    </dl>
                  </section>
                </div>

                <p className={styles.measurementNote}>
                  Task Manager shows only values the browser or Tabula can measure. Browsers do not
                  expose trustworthy per-process CPU or physical-memory percentages.
                </p>
              </div>
            ) : null}

            {page === 'network' ? (
              <NetworkTable
                entries={network}
                onMenu={(event, entry) =>
                  openMenu(event, [
                    {
                      id: 'request.copy',
                      label: 'Copy request URL',
                      run: () => copyText(entry.origin + entry.path, 'Request URL copied'),
                    },
                    {
                      id: 'request.copyAll',
                      label: 'Copy all requests',
                      run: copyNetworkLog,
                    },
                  ])
                }
              />
            ) : null}

            {page === 'details' ? (
              <DetailsView
                jobs={jobs}
                backend={capabilities?.backend ?? '—'}
                model={indexStats?.model ?? '—'}
              />
            ) : null}
          </div>
        </section>
      </div>

      <footer className={styles.statusBar}>
        <span>Applications: {applications.length}</span>
        <span>Processes: {allProcesses.length}</span>
        <span>Requests: {network.length}</span>
        <span>Backend: {capabilities?.backend.toUpperCase() ?? '—'}</span>
      </footer>

      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
    </main>
  );
}

function PageCommands({
  page,
  selected,
  finishedJobs,
  network,
}: {
  page: PageId;
  selected: ProcessItem | null;
  finishedJobs: number;
  network: NetworkEntry[];
}) {
  if (page === 'processes') {
    return (
      <div className={styles.commands}>
        {selected?.activate ? (
          <button type="button" className={styles.command} onClick={selected.activate}>
            <Icon name="maximize" size={14} />
            Switch to
          </button>
        ) : null}
        <button
          type="button"
          className={`${styles.command} ${styles.dangerCommand}`}
          disabled={!selected?.end}
          onClick={selected?.end}
        >
          <Icon name="close" size={14} />
          End task
        </button>
      </div>
    );
  }
  if (page === 'network') {
    return (
      <button
        type="button"
        className={styles.command}
        disabled={network.length === 0}
        onClick={copyNetworkLog}
      >
        <Icon name="copy" size={14} />
        Copy all
      </button>
    );
  }
  if (page === 'details') {
    return (
      <button
        type="button"
        className={styles.command}
        disabled={finishedJobs === 0}
        onClick={clearFinishedJobs}
      >
        <Icon name="trash" size={14} />
        Clear history
      </button>
    );
  }
  return <span className={styles.measuredBadge}>Measured locally</span>;
}

function ProcessGroup({
  title,
  items,
  selected,
  onSelect,
  onMenu,
  empty,
}: {
  title: string;
  items: ProcessItem[];
  selected: string | null;
  onSelect: (key: string) => void;
  onMenu: (event: React.MouseEvent, item: ProcessItem) => void;
  empty?: string;
}) {
  return (
    <section className={styles.processGroup} role="rowgroup" aria-label={title}>
      <h2>
        {title} <span>({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className={styles.groupEmpty}>{empty ?? 'Nothing to show.'}</p>
      ) : null}
      {items.map((item) => (
        <div
          key={item.key}
          className={`${styles.processRow} ${selected === item.key ? styles.processSelected : ''}`}
          role="row"
          aria-selected={selected === item.key}
          tabIndex={0}
          onClick={() => onSelect(item.key)}
          onDoubleClick={item.activate}
          onContextMenu={(event) => onMenu(event, item)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              (item.activate ?? (() => onSelect(item.key)))();
              event.preventDefault();
            } else if (event.key === ' ') {
              onSelect(item.key);
              event.preventDefault();
            }
          }}
        >
          <span className={styles.processName} role="cell">
            <AppIcon name={item.icon} size={18} />
            <span>
              <strong>{item.name}</strong>
              <small>{item.detail}</small>
            </span>
          </span>
          <span className={styles.processType} role="cell">
            {item.type}
          </span>
          <span className={styles.processStatus} role="cell">
            {item.status}
          </span>
          <span className={styles.processActivity} role="cell">
            {item.activity}
          </span>
        </div>
      ))}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function copyNetworkLog() {
  copyText(
    getNetworkLog()
      .map((entry) => `${entry.origin}${entry.path}`)
      .join('\n'),
    'Network log copied',
  );
}

function NetworkTable({
  entries,
  onMenu,
}: {
  entries: NetworkEntry[];
  onMenu: (event: React.MouseEvent, entry: NetworkEntry) => void;
}) {
  return (
    <div className={styles.networkPage}>
      <div className={styles.notice}>
        <Icon name="check" size={17} />
        <p>
          This is the browser&rsquo;s resource-timing record. Imported files are never uploaded.
        </p>
      </div>
      {entries.length === 0 ? (
        <p className={styles.empty}>No requests have been recorded.</p>
      ) : (
        <div className={styles.dataTable} role="table" aria-label="Network requests">
          <div className={styles.networkHeader} role="row">
            <span role="columnheader">Host</span>
            <span role="columnheader">Resource</span>
            <span role="columnheader">Scope</span>
            <span role="columnheader">Transferred</span>
            <span role="columnheader">Started</span>
          </div>
          {entries.map((entry, index) => (
            <div
              key={`${entry.startedAt}:${index}`}
              className={styles.networkRow}
              role="row"
              tabIndex={0}
              onContextMenu={(event) => onMenu(event, entry)}
            >
              <span className={styles.host} role="cell" title={entry.origin}>
                {entry.origin}
              </span>
              <span className={styles.path} role="cell" title={entry.path}>
                {entry.path}
              </span>
              <span role="cell" className={entry.thirdParty ? styles.external : styles.local}>
                {entry.thirdParty ? 'External' : 'Local'}
              </span>
              <span role="cell" className={styles.numeric}>
                {entry.bytes ? formatBytes(entry.bytes) : '—'}
              </span>
              <span role="cell" className={styles.numeric}>
                {requestTime(entry)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailsView({ jobs, backend, model }: { jobs: Job[]; backend: string; model: string }) {
  return (
    <div className={styles.detailsPage}>
      <dl className={styles.kernelFacts}>
        <Metric label="Scheduler capacity" value={`${MAX_CONCURRENT} concurrent jobs`} />
        <Metric label="Inference backend" value={backend.toUpperCase()} />
        <Metric label="Embedding model" value={model} />
        <Metric label="Retained history" value={`${jobs.length} jobs`} />
      </dl>

      <section className={styles.detailsSection}>
        <h2>Scheduler history</h2>
        {jobs.length === 0 ? (
          <p className={styles.empty}>No jobs have run in this session.</p>
        ) : (
          <div className={styles.jobTable} role="table" aria-label="Scheduler job history">
            <div className={styles.jobHeader} role="row">
              <span role="columnheader">ID</span>
              <span role="columnheader">Name</span>
              <span role="columnheader">Kind</span>
              <span role="columnheader">Priority</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Duration</span>
            </div>
            {jobs.map((job) => (
              <div key={job.id} className={styles.jobRow} role="row">
                <span role="cell" className={styles.mono}>
                  {job.id}
                </span>
                <span role="cell" title={job.detail ?? job.label}>
                  {job.label}
                </span>
                <span role="cell">{job.kind}</span>
                <span role="cell">{priorityName[job.priority]}</span>
                <span role="cell" className={styles[job.status]}>
                  {job.status}
                </span>
                <span role="cell" className={styles.numeric}>
                  {durationOf(job)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

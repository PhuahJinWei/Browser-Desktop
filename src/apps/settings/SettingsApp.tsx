import { useEffect, useState } from 'react';
import { notify, notifyError } from '../../kernel/notifications';
import {
  DEFAULT_SETTINGS,
  clearSession,
  resetSettings,
  updateSettings,
  useSettings,
  type Settings,
} from '../../kernel/settings';
import { useVfsStats, vfs } from '../../kernel/vfs/client';
import { formatBytes } from '../../kernel/vfs/types';
import { clearIndex, reindexEverything, useIndexStats } from '../../services/index/client';
import {
  MODELS,
  deleteModel,
  downloadModel,
  refreshModelStates,
  useModelStates,
} from '../../kernel/models';
import { useCapabilities } from '../../shell/capabilitiesContext';
import { loadSampleData } from '../../shell/sampleData';
import { AppsPanel } from './AppsPanel';
import styles from './SettingsApp.module.css';

/**
 * Settings.
 *
 * Includes the destructive operations, deliberately: a local-first app that offers no way to
 * inspect or delete what it has stored is asking for trust it has not earned. Everything here is
 * reversible except the two clearly marked as not.
 */
export default function SettingsApp() {
  const settings = useSettings();
  const stats = useVfsStats();
  const indexStats = useIndexStats();
  const capabilities = useCapabilities();
  const [busy, setBusy] = useState<string | null>(null);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    updateSettings({ [key]: value } as Partial<Settings>);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try {
      await work();
    } catch (error) {
      notifyError(`${label} failed`, error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.app}>
      <section className={styles.section}>
        <h3 className={styles.heading}>Appearance</h3>

        <Field label="Theme" hint="System follows your operating system setting.">
          <Segmented
            value={settings.theme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(value) => set('theme', value as Settings['theme'])}
          />
        </Field>

        <Field label="Accent">
          <div className={styles.swatches}>
            {(['teal', 'indigo', 'amber', 'rose'] as const).map((accent) => (
              <button
                key={accent}
                type="button"
                className={`${styles.swatch} ${styles[accent]} ${
                  settings.accent === accent ? styles.swatchActive : ''
                }`}
                onClick={() => set('accent', accent)}
                aria-label={`Accent: ${accent}`}
                aria-pressed={settings.accent === accent}
              />
            ))}
          </div>
        </Field>

        <Field label="Wallpaper">
          <Segmented
            value={settings.wallpaper}
            options={[
              { value: 'aurora', label: 'Aurora' },
              { value: 'dusk', label: 'Dusk' },
              { value: 'grid', label: 'Grid' },
              { value: 'plain', label: 'Plain' },
            ]}
            onChange={(value) => set('wallpaper', value as Settings['wallpaper'])}
          />
        </Field>

        <Field label="Text size">
          <Segmented
            value={String(settings.fontScale)}
            options={[
              { value: '0.9', label: 'Small' },
              { value: '1', label: 'Normal' },
              { value: '1.1', label: 'Large' },
              { value: '1.25', label: 'Larger' },
            ]}
            onChange={(value) => set('fontScale', Number(value) as Settings['fontScale'])}
          />
        </Field>

        <Field label="Motion" hint="Reduced removes spinners and transitions.">
          <Segmented
            value={settings.motion}
            options={[
              { value: 'system', label: 'System' },
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
            ]}
            onChange={(value) => set('motion', value as Settings['motion'])}
          />
        </Field>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Search and inference</h3>

        <Field
          label="Backend"
          hint={
            capabilities
              ? `Automatic currently picks ${capabilities.backend}. On this project's reference machine, threaded WASM beat WebGPU by about 2.2x for this model — see docs/benchmarks.`
              : 'Probing hardware…'
          }
        >
          <Segmented
            value={settings.backend}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'webgpu', label: 'WebGPU' },
              { value: 'wasm', label: 'WASM' },
            ]}
            onChange={(value) => {
              set('backend', value as Settings['backend']);
              notify({
                title: 'Backend preference saved',
                body: 'Reload the desktop for it to take effect.',
                level: 'info',
              });
            }}
          />
        </Field>

        <Field
          label="Index new files automatically"
          hint="Off means search only covers what is already indexed."
        >
          <Toggle checked={settings.autoIndex} onChange={(value) => set('autoIndex', value)} />
        </Field>

        <Field label="Restore windows on the next visit">
          <Toggle
            checked={settings.restoreSession}
            onChange={(value) => set('restoreSession', value)}
          />
        </Field>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() => void run('Rebuild index', reindexEverything)}
          >
            Rebuild search index
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() =>
              void run('Clear index', async () => {
                await clearIndex();
                notify({ title: 'Search index cleared', level: 'info' });
              })
            }
          >
            Clear search index
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Apps</h3>
        <AppsPanel />
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Models</h3>
        <p className={styles.warning}>
          Nothing here downloads without being asked first. Everything runs on this device; the only
          thing that travels is the model, in this direction.
        </p>
        <ModelList />
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Storage</h3>
        <dl className={styles.stats}>
          <Stat label="Files" value={String(stats?.files ?? 0)} />
          <Stat label="Folders" value={String(stats?.directories ?? 0)} />
          <Stat label="Stored" value={formatBytes(stats?.storedBytes ?? 0)} />
          <Stat
            label="Deduplicated"
            value={formatBytes(Math.max(0, (stats?.bytes ?? 0) - (stats?.storedBytes ?? 0)))}
          />
          <Stat label="Indexed passages" value={String(indexStats?.chunks ?? 0)} />
          <Stat
            label="Browser quota"
            value={formatBytes(capabilities?.capabilities.storage.quotaBytes ?? 0)}
          />
        </dl>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null || settings.sampleDataLoaded}
            onClick={() =>
              void run('Load sample data', async () => {
                await loadSampleData();
              })
            }
          >
            Load sample data
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null || !settings.sampleDataLoaded}
            onClick={() =>
              void run('Clear sample data', async () => {
                const removed = await vfs.clearSample();
                updateSettings({ sampleDataLoaded: false });
                notify({ title: `Removed ${removed.length} sample items`, level: 'success' });
              })
            }
          >
            Clear sample data
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() =>
              void run('Check files', async () => {
                const broken = await vfs.findBrokenFiles();
                if (broken.length === 0) {
                  notify({ title: 'Every file can be opened', level: 'success' });
                  return;
                }
                notify({
                  title: `${broken.length} file${broken.length === 1 ? '' : 's'} cannot be opened`,
                  body: `${broken
                    .slice(0, 3)
                    .map((node) => node.name)
                    .join(
                      ', ',
                    )}${broken.length > 3 ? '…' : ''} — the entries are here but their contents are not. Deleting and re-adding them is the repair.`,
                  level: 'warning',
                  timeout: 12000,
                });
              })
            }
            title="Checks that every file's stored contents are still present"
          >
            Check files
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>Reset</h3>
        <p className={styles.warning}>
          These cannot be undone. Everything is stored on this device only, so nothing here is
          recoverable from anywhere else.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              resetSettings();
              clearSession();
              notify({ title: 'Settings reset', level: 'info' });
            }}
          >
            Reset settings
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            disabled={busy !== null}
            onClick={() =>
              void run('Erase everything', async () => {
                if (
                  !confirm(
                    'Erase every file, note and index stored by this desktop?\n\nThis cannot be undone.',
                  )
                ) {
                  return;
                }
                await vfs.resetEverything();
                await clearIndex();
                updateSettings({ ...DEFAULT_SETTINGS, sampleDataLoaded: false });
                notify({ title: 'Everything erased', level: 'success' });
              })
            }
          >
            Erase all data
          </button>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

/** The model shelf: what is on disk, what it cost, and how to get rid of it. */
function ModelList() {
  const states = useModelStates();

  useEffect(() => {
    void refreshModelStates();
  }, []);

  return (
    <ul className={styles.models}>
      {MODELS.map((model) => {
        const state = states[model.id] ?? { status: 'unknown', progress: 0, bytesDone: 0 };
        return (
          <li key={model.id} className={styles.model}>
            <div className={styles.modelInfo}>
              <p className={styles.modelName}>{model.label}</p>
              <p className={styles.modelMeta}>
                {formatBytes(model.totalBytes)} · {model.license.name} ·{' '}
                {model.task.replace(/-/g, ' ')}
              </p>
              {state.status === 'downloading' ? (
                <div className={styles.modelProgress}>
                  <div
                    className={styles.modelProgressBar}
                    style={{ width: `${Math.round(state.progress * 100)}%` }}
                  />
                </div>
              ) : null}
              {state.error ? <p className={styles.modelError}>{state.error}</p> : null}
            </div>

            <div className={styles.modelActions}>
              {state.status === 'ready' ? (
                <>
                  <span className={styles.modelReady}>on this device</span>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => void deleteModel(model.id)}
                  >
                    Remove
                  </button>
                </>
              ) : state.status === 'downloading' ? (
                <span className={styles.modelReady}>
                  {Math.round(state.progress * 100)}% · {formatBytes(state.bytesDone)}
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void downloadModel(model.id).promise}
                >
                  Download
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>
        <span>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </div>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.segmented} role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`${styles.segment} ${value === option.value ? styles.segmentActive : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { notify, notifyError } from '../../kernel/notifications';
import { pickFile } from '../../kernel/pickFile';
import { applySetup, exportSetup, parseSetup } from '../../kernel/setup';
import { pickWallpaperImage } from '../../kernel/wallpaper';
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
import { resetIconLayout } from '../../kernel/desktop';
import { clearIndex, reindexEverything, useIndexStats } from '../../services/index/client';
import { MODELS } from '../../kernel/models';
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
  const [exportWindows, setExportWindows] = useState(true);
  const [exportWallpaper, setExportWallpaper] = useState(true);

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

        <Field
          label="Skin"
          hint="Classic is a 1990s desktop — square, bevelled, one grey. It brings its own colours, so the theme and accent below have no effect while it is on."
        >
          <Segmented
            value={settings.skin}
            options={[
              { value: 'modern', label: 'Modern' },
              { value: 'classic', label: 'Classic' },
            ]}
            onChange={(value) => set('skin', value as Settings['skin'])}
          />
        </Field>

        <Field
          label="Classic pointers"
          hint="The era's own arrow, I-beam and hourglass, drawn rather than downloaded. There was no pointing hand in 1995 — a button showed the arrow. Turn this off to keep your system's pointers, which is the right choice if you have set them larger for visibility."
        >
          <Toggle
            checked={settings.classicCursors}
            disabled={settings.skin !== 'classic'}
            onChange={(value) => set('classicCursors', value)}
          />
        </Field>

        <Field label="Theme" hint="System follows your operating system setting.">
          <Segmented
            value={settings.theme}
            disabled={settings.skin === 'classic'}
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
                disabled={settings.skin === 'classic'}
                aria-label={`Accent: ${accent}`}
                aria-pressed={settings.accent === accent}
              />
            ))}
          </div>
        </Field>

        <Field
          label="Wallpaper"
          hint="A picture becomes the wallpaper by being a file you already have. Right-clicking any image in Files does the same thing."
        >
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

        <Field label="Your own picture" hint={<WallpaperName />}>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() =>
                void pickWallpaperImage().catch((error: unknown) =>
                  notifyError('That picture could not be used', error),
                )
              }
            >
              {settings.wallpaper === 'custom' ? 'Choose another…' : 'Choose a picture…'}
            </button>
            {settings.wallpaper === 'custom' ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => updateSettings({ wallpaper: 'aurora', wallpaperFileId: null })}
              >
                Use a built-in one
              </button>
            ) : null}
          </div>
        </Field>

        {settings.wallpaper === 'custom' ? (
          <Field label="Picture fit">
            <Segmented
              value={settings.wallpaperFit}
              options={[
                { value: 'cover', label: 'Fill' },
                { value: 'contain', label: 'Fit' },
                { value: 'center', label: 'Centre' },
                { value: 'tile', label: 'Tile' },
              ]}
              onChange={(value) => set('wallpaperFit', value as Settings['wallpaperFit'])}
            />
          </Field>
        ) : null}

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
        {/*
          Watch's consent lives here rather than inside Watch, because a permission you can only
          withdraw from the thing holding it is not really withdrawable. Turning it off does not
          stop a video that is already loaded — Stop does that — it means the next one asks again.
        */}
        <Field
          label="Watch may load videos from YouTube"
          hint="The one exception to “nothing here talks to anyone”. Off means Watch asks again before the next video."
        >
          <Toggle checked={settings.watchConsent} onChange={(next) => set('watchConsent', next)} />
        </Field>
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
        <h3 className={styles.heading}>Desktop setup</h3>
        <p className={styles.warning}>
          There is no account to sync with, so a setup travels as a file you carry: theme, accent,
          wallpaper, text size, icon positions and your indexing preferences. Open it in any text
          editor — everything this desktop remembers about you is in there, and it is short. Your
          files are not included, and neither are installed apps: those are code, and code gets
          installed through the permission prompts rather than by importing a settings file.
        </p>

        <Field label="Include the open windows" hint="Where they were, and what they had open.">
          <Toggle checked={exportWindows} onChange={setExportWindows} />
        </Field>
        <Field
          label="Include the wallpaper picture"
          hint="Carries the image itself, up to 8 MB, so it works on the other machine."
        >
          <Toggle checked={exportWallpaper} onChange={setExportWallpaper} />
        </Field>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() =>
              void run('Export setup', async () => {
                await exportSetup({
                  includeWindows: exportWindows,
                  includeWallpaper: exportWallpaper,
                });
                notify({ title: 'Setup exported', level: 'success' });
              })
            }
          >
            Export setup…
          </button>

          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() =>
              void run('Import setup', async () => {
                const file = await pickFile('application/json,.json');
                if (!file) return;
                const result = await applySetup(parseSetup(await file.text()));
                notify({
                  title: 'Setup imported',
                  body: [
                    `${result.settingsApplied} settings applied`,
                    result.wallpaperImported ? 'wallpaper restored' : null,
                    result.windowsRestored > 0
                      ? `${result.windowsRestored} windows reopened`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  level: 'success',
                });
              })
            }
          >
            Import setup…
          </button>

          <button
            type="button"
            className={styles.button}
            disabled={busy !== null}
            onClick={() => {
              resetIconLayout();
              notify({ title: 'Desktop icons back where they started', level: 'info' });
            }}
          >
            Reset icon layout
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

/**
 * What ships, rather than what is downloadable.
 *
 * There is no download button because there is nothing to download: the weights are in the build,
 * served from this origin, and verified against these digests before they got there. This is a
 * statement of what the desktop is made of, and it is checkable — the digests are the ones
 * `tools/sync-model.mjs` enforces.
 */
function ModelList() {
  return (
    <ul className={styles.models}>
      {MODELS.map((model) => (
        <li key={model.id} className={styles.model}>
          <div className={styles.modelInfo}>
            <p className={styles.modelName}>{model.label}</p>
            <p className={styles.modelMeta}>
              {formatBytes(model.totalBytes)} · {model.license.name} ·{' '}
              {model.task.replace(/-/g, ' ')}
            </p>
            <p className={styles.modelMeta}>
              from {model.source.repo}, fetched at build time and served from this site
            </p>
          </div>
          <div className={styles.modelActions}>
            <span className={styles.modelReady}>included</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
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
  disabled = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /** Used when another setting has taken the choice away — Classic supplies its own palette. */
  disabled?: boolean;
}) {
  return (
    <div className={styles.segmented} role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          className={`${styles.segment} ${value === option.value ? styles.segmentActive : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Used when another setting has taken the choice away — the pointers need the classic skin. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
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

/**
 * The name of the picture currently in use.
 *
 * Reads it from the file system rather than storing a copy in the settings, so a rename in Files
 * shows up here — the wallpaper is the file, not a snapshot of what it was called.
 */
function WallpaperName() {
  const { wallpaper, wallpaperFileId } = useSettings();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (wallpaper !== 'custom' || !wallpaperFileId) {
      setName(null);
      return;
    }
    let cancelled = false;
    void vfs
      .stat(wallpaperFileId)
      .then((node) => !cancelled && setName(node?.name ?? null))
      .catch(() => !cancelled && setName(null));
    return () => {
      cancelled = true;
    };
  }, [wallpaper, wallpaperFileId]);

  if (wallpaper !== 'custom') return <>Any picture in your files can be the wallpaper.</>;
  return <>Currently {name ?? 'a picture that is no longer there'}.</>;
}

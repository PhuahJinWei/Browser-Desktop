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
import { Icon, type IconName } from '../../shell/Icon';
import { AppsPanel } from './AppsPanel';
import styles from './SettingsApp.module.css';

/**
 * Restart the desktop after a reset.
 *
 * A reset tears state down without rebuilding it, and the running desktop goes on holding what it
 * had: windows open on erased files, the icon layout still arranged, the sample corpus not put
 * back — `sampleDataLoaded: false` only means anything to a boot that has not happened yet. So the
 * reset is not really finished until the desktop is rebuilt from what the reset left behind, which
 * is what boot already does perfectly well.
 *
 * It has to happen in this turn of the event loop rather than after a toast. The session is saved
 * on a 400ms debounce (`Desktop.tsx`), so anything that waits long enough to be read is also long
 * enough for that timer to write the session straight back over the one just cleared. Reloading
 * immediately outruns it — and the desktop visibly coming back up is the confirmation a toast
 * would have given, which is why neither caller posts one.
 */
const restart = () => location.reload();

/**
 * The pages, in the order they are offered.
 *
 * Settings used to be one column of seven headings and about thirty controls, scrolled end to end:
 * reaching "Erase all data" meant travelling past the model list, and the two destructive buttons
 * shared a scroll position with the text size. Splitting it means every page is shorter than the
 * window, which is the only reliable way to make a settings screen readable — no layout trick
 * rescues a list long enough to get lost in.
 *
 * `Reset` is last, and alone on its page, for the reason it is last in everything that has one.
 */
const PAGES = [
  {
    id: 'appearance',
    title: 'Appearance',
    icon: 'wallpaper',
    blurb: 'How the desktop looks, and how large it reads.',
  },
  {
    id: 'desktop',
    title: 'Desktop',
    icon: 'grid',
    blurb: 'Windows, icons, and carrying this setup to another machine.',
  },
  {
    id: 'search',
    title: 'Search',
    icon: 'search',
    blurb: 'What gets indexed, and what hardware does the work.',
  },
  {
    id: 'apps',
    title: 'Apps',
    icon: 'apps',
    blurb: 'What is installed, and what each one is allowed to do.',
  },
  {
    id: 'storage',
    title: 'Storage',
    icon: 'drive',
    blurb: 'What this desktop is holding, and whether it is intact.',
  },
  {
    id: 'models',
    title: 'Models',
    icon: 'cpu',
    blurb: 'What ships inside the build, and where it came from.',
  },
  {
    id: 'reset',
    title: 'Reset',
    icon: 'alert',
    blurb: 'Undoing it. None of this is stored anywhere else.',
  },
] as const satisfies readonly { id: string; title: string; icon: IconName; blurb: string }[];

type PageId = (typeof PAGES)[number]['id'];

/**
 * Settings.
 *
 * Includes the destructive operations, deliberately: a local-first app that offers no way to
 * inspect or delete what it has stored is asking for trust it has not earned. Everything here is
 * reversible except the two clearly marked as not.
 *
 * One rule runs through the whole screen and accounts for most of the conditionals below: **a
 * choice is either offered or absent — never a control that is present and does nothing.** Accent
 * means nothing under the classic skin, which brings a complete palette of its own, and the classic
 * pointers mean nothing without it. Those were rendered as `disabled` controls, which failed twice:
 * nothing in the stylesheet dimmed a swatch or a switch, so the five accent circles stayed fully
 * saturated and the pointer toggle stayed accent-blue and latched on — dead controls pixel-identical
 * to live ones. Styling them correctly would only have made them legibly dead; a control that can
 * never be enabled from where it stands is furniture either way. What replaces them is one line in
 * the hint on `Skin`, which is the setting that actually took them away.
 *
 * A *button* may still be `disabled`, because a button can be busy, and busy is temporary and
 * worth showing. A choice cannot be busy.
 */
export default function SettingsApp() {
  const settings = useSettings();
  const stats = useVfsStats();
  const indexStats = useIndexStats();
  const capabilities = useCapabilities();
  const [busy, setBusy] = useState<string | null>(null);
  const [exportWindows, setExportWindows] = useState(true);
  const [exportWallpaper, setExportWallpaper] = useState(true);
  const [page, setPage] = useState<PageId>('appearance');

  const classic = settings.skin === 'classic';
  const current = PAGES.find((entry) => entry.id === page) ?? PAGES[0];

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
      <div className={styles.layout}>
        {/*
        A nav, not a tablist. Tab semantics would buy arrow-key movement at the price of a roving
        tabindex and `aria-controls` wiring, and what sits beside this is a page of unrelated
        settings rather than one widget's detail. `aria-current="page"` describes that honestly and
        every entry stays reachable with the Tab key alone.
      */}
        <nav className={styles.nav} aria-label="Settings sections">
          {PAGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`${styles.tab} ${entry.id === page ? styles.tabActive : ''}`}
              aria-current={entry.id === page ? 'page' : undefined}
              onClick={() => setPage(entry.id)}
            >
              <Icon name={entry.icon} size={15} className={styles.tabIcon} />
              <span className={styles.tabName}>{entry.title}</span>
            </button>
          ))}
        </nav>

        <div className={styles.pane}>
          <div className={styles.page}>
            <header className={styles.pageHead}>
              <h3 className={styles.pageTitle}>{current.title}</h3>
              <p className={styles.pageBlurb}>{current.blurb}</p>
            </header>

            {page === 'appearance' ? (
              <>
                {/* Named for what it holds rather than "Skin", which the first field is already called. */}
                <Group title={classic ? 'Skin and pointers' : 'Skin and accent'}>
                  <Field
                    label="Skin"
                    hint={
                      classic
                        ? 'A 1990s desktop — square, bevelled, one grey. It brings a complete palette with it, which is why there is no accent to choose while it is on. It comes back with Modern.'
                        : "This project's own design language. Classic is a 1990s desktop instead, and it draws the era's own pointers — that switch appears when it is on."
                    }
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

                  {classic ? (
                    <Field
                      label="Classic pointers"
                      hint="The era's own arrow, I-beam and hourglass, drawn rather than downloaded. There was no pointing hand in 1995 — a button showed the arrow. Turn this off to keep your system's pointers, which is the right choice if you have set them larger for visibility."
                    >
                      <Toggle
                        checked={settings.classicCursors}
                        onChange={(value) => set('classicCursors', value)}
                      />
                    </Field>
                  ) : (
                    <Field
                      label="Accent"
                      hint="The colour of a selection, a link, and whichever control is active."
                    >
                      <div className={styles.swatches}>
                        {ACCENTS.map((accent) => (
                          <button
                            key={accent.value}
                            type="button"
                            className={`${styles.swatch} ${styles[accent.value]} ${
                              settings.accent === accent.value ? styles.swatchActive : ''
                            }`}
                            onClick={() => set('accent', accent.value)}
                            aria-label={`Accent: ${accent.label}`}
                            aria-pressed={settings.accent === accent.value}
                            title={accent.label}
                          />
                        ))}
                      </div>
                    </Field>
                  )}
                </Group>

                <Group title="Wallpaper">
                  <Field
                    label="Built in"
                    hint={
                      classic
                        ? 'The era had no gradients, so these become the flat colours its Display Properties offered. A picture of your own is still honoured.'
                        : 'A picture becomes the wallpaper by being a file you already have. Right-clicking any image in Files does the same thing.'
                    }
                  >
                    <Segmented
                      value={settings.wallpaper}
                      options={[
                        { value: 'bloom', label: 'Bloom' },
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
                          onClick={() =>
                            updateSettings({
                              wallpaper: DEFAULT_SETTINGS.wallpaper,
                              wallpaperFileId: null,
                            })
                          }
                        >
                          Use a built-in one
                        </button>
                      ) : null}
                    </div>
                  </Field>

                  {settings.wallpaper === 'custom' ? (
                    <Field
                      label="Picture fit"
                      hint="How that image fills a screen shaped unlike it."
                    >
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
                </Group>

                <Group title="Text and motion">
                  <Field label="Text size" hint="Scales every app, not only this one.">
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
                </Group>
              </>
            ) : null}

            {page === 'desktop' ? (
              <>
                <Group title="Windows and icons">
                  <Field
                    label="Restore windows on the next visit"
                    hint="Which windows were open, where they were, and what they had open."
                  >
                    <Toggle
                      checked={settings.restoreSession}
                      onChange={(value) => set('restoreSession', value)}
                    />
                  </Field>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() => {
                        resetIconLayout();
                        notify({ title: 'Desktop icons back where they started', level: 'info' });
                      }}
                    >
                      Reset icon layout
                    </button>
                  </div>
                </Group>

                <Group title="Carry this setup elsewhere">
                  <p className={styles.note}>
                    There is no account to sync with, so a setup travels as a file you carry: skin,
                    accent, wallpaper, text size, icon positions and your indexing preferences. Open
                    it in any text editor — everything this desktop remembers about you is in there,
                    and it is short. Your files are not included, and neither are installed apps:
                    those are code, and code gets installed through the permission prompts rather
                    than by importing a settings file.
                  </p>

                  <Field
                    label="Include the open windows"
                    hint="Where they were, and what they had open."
                  >
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
                  </div>
                </Group>
              </>
            ) : null}

            {page === 'search' ? (
              <>
                <Group title="Inference">
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
                </Group>

                <Group title="Index">
                  <Field
                    label="Index new files automatically"
                    hint="Off means search only covers what is already indexed."
                  >
                    <Toggle
                      checked={settings.autoIndex}
                      onChange={(value) => set('autoIndex', value)}
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
                </Group>
              </>
            ) : null}

            {page === 'apps' ? (
              <>
                {/*
                Watch's consent lives here rather than inside Watch, because a permission you can
                only withdraw from the thing holding it is not really withdrawable. Turning it off
                does not stop a video that is already loaded — Stop does that — it means the next
                one asks again.
              */}
                <Group title="Permissions">
                  <Field
                    label="Watch may load videos from YouTube"
                    hint="The one exception to “nothing here talks to anyone”. Off means Watch asks again before the next video."
                  >
                    <Toggle
                      checked={settings.watchConsent}
                      onChange={(next) => set('watchConsent', next)}
                    />
                  </Field>
                </Group>

                <Group title="Installed">
                  <AppsPanel />
                </Group>
              </>
            ) : null}

            {page === 'storage' ? (
              <>
                <Group title="What is stored">
                  <dl className={styles.stats}>
                    <Stat label="Files" value={String(stats?.files ?? 0)} />
                    <Stat label="Folders" value={String(stats?.directories ?? 0)} />
                    <Stat label="Stored" value={formatBytes(stats?.storedBytes ?? 0)} />
                    <Stat
                      label="Deduplicated"
                      value={formatBytes(
                        Math.max(0, (stats?.bytes ?? 0) - (stats?.storedBytes ?? 0)),
                      )}
                    />
                    <Stat label="Indexed passages" value={String(indexStats?.chunks ?? 0)} />
                    <Stat
                      label="Browser quota"
                      value={formatBytes(capabilities?.capabilities.storage.quotaBytes ?? 0)}
                    />
                  </dl>
                </Group>

                <Group title="Sample data">
                  <p className={styles.note}>
                    Documents, pictures and notes to fill an empty desktop with something worth
                    searching. Removing them leaves anything you added yourself untouched.
                  </p>
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
                          notify({
                            title: `Removed ${removed.length} sample items`,
                            level: 'success',
                          });
                        })
                      }
                    >
                      Clear sample data
                    </button>
                  </div>
                </Group>

                <Group title="Repair">
                  <p className={styles.note}>
                    A browser may reclaim storage it considers disposable, which takes the contents
                    of files and leaves their entries behind. This is how you find out that it has.
                  </p>
                  <div className={styles.actions}>
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
                </Group>
              </>
            ) : null}

            {page === 'models' ? (
              <Group>
                <p className={styles.note}>
                  Nothing here downloads without being asked first. Everything runs on this device;
                  the only thing that ever travels is the model, in this direction.
                </p>
                <ModelList />
              </Group>
            ) : null}

            {page === 'reset' ? (
              <Group>
                <p className={`${styles.note} ${styles.noteDanger}`}>
                  These cannot be undone. Everything is stored on this device only, so nothing here
                  is recoverable from anywhere else.
                </p>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => {
                      resetSettings();
                      clearSession();
                      restart();
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
                        // The stored session outlives the files it points at. Without this the
                        // restart faithfully reopens windows onto documents that were just erased.
                        clearSession();
                        restart();
                      })
                    }
                  >
                    Erase all data
                  </button>
                </div>
              </Group>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

/** Named here rather than inline so the swatch has something to say on hover and to a reader. */
const ACCENTS = [
  { value: 'blue', label: 'Blue' },
  { value: 'teal', label: 'Teal' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
] as const satisfies readonly { value: Settings['accent']; label: string }[];

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

/**
 * A titled run of related settings.
 *
 * The title is optional because a page holding one group has already been titled by the page, and
 * repeating it would be two headings saying the same word. Under the classic skin this becomes the
 * era's group box — an etched rectangle with its legend straddling the top edge — which is why the
 * title is markup rather than a comment: 1995 drew that line, and the legend needs somewhere to
 * sit on it.
 */
function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className={styles.group}>
      {title ? <h4 className={styles.groupTitle}>{title}</h4> : null}
      <div className={styles.groupBody}>{children}</div>
    </section>
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
        <span className={styles.fieldName}>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </div>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}

/*
 * Neither of the two below takes a `disabled`, and that is the point rather than an omission.
 * Both used to, for the single case this redesign removed — a choice the current skin had taken
 * away. Keeping the prop would leave the door open to putting a permanently dead control back on
 * screen, so it is gone, and a caller with nothing to offer has to decide not to render the field.
 */

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

import { useState } from 'react';
import { launchInstalledApp } from '../../kernel/apps';
import { notify, notifyError } from '../../kernel/notifications';
import {
  installApp,
  packAppLink,
  uninstallApp,
  useInstalledApps,
} from '../../kernel/installedApps';
import { grantsFor, revokeGrant, setGrant, useGrants } from '../../kernel/permissions';
import { CAPABILITY_LABELS, type Capability } from '../../sdk/protocol';
import { Icon } from '../../shell/Icon';
import styles from './AppsPanel.module.css';

/**
 * Settings → Apps.
 *
 * The place where a permission decision can be looked at again. Granting something at the moment
 * an app asked for it is the right time to *ask*, but the wrong place to *review* — this panel
 * exists so that "yes" is never a decision the user cannot find their way back to.
 */
export function AppsPanel() {
  const apps = useInstalledApps();
  const grants = useGrants();
  const [busy, setBusy] = useState(false);

  const installFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.txt,text/javascript,text/plain';
    input.style.display = 'none';

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      setBusy(true);
      try {
        await installApp(await file.text(), 'file');
      } catch (error) {
        notifyError('That file is not a valid app', error);
      } finally {
        setBusy(false);
      }
    });
    input.addEventListener('cancel', () => input.remove());
    document.body.append(input);
    input.click();
  };

  return (
    <div>
      <p className={styles.intro}>
        Installed apps run in a sandbox with no network access and no reach into your files beyond
        their own folder. Every permission below was asked for at the moment it was first used, and
        can be taken back here.
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={installFromFile} disabled={busy}>
          <Icon name="upload" size={14} /> Install from file
        </button>
      </div>

      {apps.length === 0 ? (
        <p className={styles.empty}>No apps installed.</p>
      ) : (
        <ul className={styles.list}>
          {apps.map((app) => {
            const appGrants = grants[app.id] ?? grantsFor(app.id);
            return (
              <li key={app.id} className={styles.app}>
                <div className={styles.appHeader}>
                  <div className={styles.appIdentity}>
                    <p className={styles.appName}>
                      {app.manifest.name}
                      <span className={styles.version}>v{app.manifest.version}</span>
                      {app.origin === 'bundled' ? (
                        <span className={styles.origin}>bundled</span>
                      ) : app.origin === 'link' ? (
                        <span className={styles.originWarn}>from a link</span>
                      ) : (
                        <span className={styles.origin}>from a file</span>
                      )}
                    </p>
                    <p className={styles.appDescription}>{app.manifest.description}</p>
                    {app.manifest.author ? (
                      <p className={styles.appAuthor}>
                        {/* An unverified claim, and labelled as one. */}
                        claims to be by {app.manifest.author}
                      </p>
                    ) : null}
                  </div>

                  <div className={styles.appActions}>
                    <button
                      type="button"
                      className={styles.smallButton}
                      onClick={() =>
                        launchInstalledApp(app.id, app.manifest.name, {
                          ...(app.manifest.defaultSize ? { size: app.manifest.defaultSize } : {}),
                        })
                      }
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className={styles.smallButton}
                      onClick={async () => {
                        const link = packAppLink(app.source);
                        await navigator.clipboard.writeText(link).catch(() => undefined);
                        notify({
                          title: 'Share link copied',
                          body: `${(link.length / 1024).toFixed(1)} KB — the app travels in the link's fragment, which never reaches a server.`,
                          level: 'success',
                        });
                      }}
                    >
                      Share
                    </button>
                    <button
                      type="button"
                      className={`${styles.smallButton} ${styles.danger}`}
                      onClick={() => {
                        if (confirm(`Remove ${app.manifest.name}? Its permissions and settings go too.`)) {
                          void uninstallApp(app.id);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {app.manifest.permissions.length === 0 ? (
                  <p className={styles.noPermissions}>Asks for no permissions.</p>
                ) : (
                  <ul className={styles.permissions}>
                    {app.manifest.permissions.map((capability: Capability) => {
                      const decision = appGrants[capability];
                      return (
                        <li key={capability} className={styles.permission}>
                          <span className={styles.permissionLabel}>
                            {CAPABILITY_LABELS[capability]}
                          </span>
                          <span className={styles.permissionControls}>
                            <span
                              className={
                                decision === 'granted'
                                  ? styles.granted
                                  : decision === 'denied'
                                    ? styles.denied
                                    : styles.unasked
                              }
                            >
                              {decision ?? 'not asked yet'}
                            </span>
                            {decision === 'granted' ? (
                              <button
                                type="button"
                                className={styles.linkButton}
                                onClick={() => setGrant(app.id, capability, 'denied')}
                              >
                                revoke
                              </button>
                            ) : decision === 'denied' ? (
                              <button
                                type="button"
                                className={styles.linkButton}
                                onClick={() => setGrant(app.id, capability, 'granted')}
                              >
                                allow
                              </button>
                            ) : null}
                            {decision ? (
                              <button
                                type="button"
                                className={styles.linkButton}
                                onClick={() => revokeGrant(app.id, capability)}
                              >
                                ask again
                              </button>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

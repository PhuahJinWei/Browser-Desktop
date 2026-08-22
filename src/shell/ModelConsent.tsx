import { useEffect, useRef } from 'react';
import { usePendingConsent } from '../kernel/models';
import { formatBytes } from '../kernel/vfs/types';
import { Icon } from './Icon';
import styles from './ModelConsent.module.css';

/**
 * The download consent dialog.
 *
 * The one place this app asks permission to talk to another host, so it says exactly what is
 * about to happen: which model, how large, from where, and under what licence. No pre-ticked box,
 * no "recommended" styling on the accept button, and declining is a first-class outcome that
 * leaves the feature working in whatever reduced form it can.
 */
export function ModelConsent() {
  const request = usePendingConsent();
  const declineRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!request) return;
    // Focus the decline button: the safe option should be the one a stray Enter chooses.
    declineRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        request.resolve(false);
        return;
      }
      // Trap focus inside the dialog while it is open.
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    globalThis.addEventListener('keydown', onKeyDown, true);
    return () => globalThis.removeEventListener('keydown', onKeyDown, true);
  }, [request]);

  if (!request) return null;
  const { model, reason, resolve } = request;

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        aria-describedby="consent-body"
        ref={dialogRef}
      >
        <div className={styles.header}>
          <span className={styles.icon}>
            <Icon name="download" size={20} />
          </span>
          <div>
            <h2 className={styles.title} id="consent-title">
              Download a model?
            </h2>
            <p className={styles.reason}>{reason}</p>
          </div>
        </div>

        <dl className={styles.details} id="consent-body">
          <div>
            <dt>Model</dt>
            <dd>{model.label}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd className={styles.emphasis}>{formatBytes(model.totalBytes)}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>
              <code>{model.source.host}</code> · {model.source.repo}
            </dd>
          </div>
          <div>
            <dt>Licence</dt>
            <dd>
              <a href={model.license.url} target="_blank" rel="noreferrer noopener">
                {model.license.name}
              </a>
            </dd>
          </div>
        </dl>

        <p className={styles.note}>
          Downloaded once, verified against a checksum, then cached on this device. Your files are
          not sent anywhere — this is the model coming to them.
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.decline}
            onClick={() => resolve(false)}
            ref={declineRef}
          >
            Not now
          </button>
          <button type="button" className={styles.accept} onClick={() => resolve(true)}>
            Download {formatBytes(model.totalBytes)}
          </button>
        </div>
      </div>
    </div>
  );
}

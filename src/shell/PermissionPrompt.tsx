import { useEffect, useRef, useState } from 'react';
import { usePendingPermission } from '../kernel/permissions';
import { CAPABILITY_LABELS } from '../sdk/protocol';
import { Icon } from './Icon';
import styles from './PermissionPrompt.module.css';

/**
 * The permission prompt.
 *
 * Shown the first time an app actually uses a capability, not when it is installed — a list of
 * switches at install time gets clicked through, whereas "Gallery Wall wants to search your
 * indexed files" at the moment it tries to is a question with a context.
 *
 * Deny is focused by default and Escape denies, so the safe answer is the one that happens by
 * accident. "Remember this" is on by default because being asked the same question repeatedly
 * trains people to stop reading it.
 */
export function PermissionPrompt() {
  const request = usePendingPermission();
  const denyRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!request) return;
    setRemember(true);
    denyRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        request.resolve(false, false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, input');
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
  const { manifest, capability, method, resolve } = request;

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-title"
        ref={dialogRef}
      >
        <div className={styles.header}>
          <span className={styles.icon}>
            <Icon name="apps" size={18} />
          </span>
          <div>
            <h2 className={styles.title} id="permission-title">
              Allow {manifest.name}?
            </h2>
            <p className={styles.subtitle}>
              An installed app, running sandboxed. It has no network access.
            </p>
          </div>
        </div>

        <p className={styles.ask}>{CAPABILITY_LABELS[capability]}</p>
        <p className={styles.detail}>
          Requested by <code>{method}</code>
        </p>

        {capability === 'fs:read' || capability === 'fs:write' ? (
          <p className={styles.scope}>
            Apps can only reach their own folder under <code>Apps/{manifest.name}</code>, plus the
            single file you opened them with. Not the rest of your files.
          </p>
        ) : null}

        <label className={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Remember this choice — you can change it in Settings
        </label>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.deny}
            onClick={() => resolve(false, remember)}
            ref={denyRef}
          >
            Deny
          </button>
          <button type="button" className={styles.allow} onClick={() => resolve(true, remember)}>
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

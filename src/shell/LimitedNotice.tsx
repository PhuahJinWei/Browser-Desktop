import { updateSettings, useSettings } from '../kernel/settings';
import { useCapabilities } from './capabilitiesContext';
import { Icon } from './Icon';
import { useCompactLayout } from './useMediaQuery';
import styles from './LimitedNotice.module.css';

/**
 * The limited-mode notice.
 *
 * A desktop environment on a phone is a compromise, and the compromise should be stated by the
 * thing making it rather than discovered by the visitor. It says what changed and what still
 * works — the local-only claim is not one of the things that degrades — and then goes away for
 * good.
 *
 * Shown for a narrow viewport or a machine with no usable GPU. Both are real constraints; neither
 * is a failure, which is why this is a notice and not a warning.
 */
export function LimitedNotice() {
  const settings = useSettings();
  const compact = useCompactLayout();
  const capabilities = useCapabilities();
  const slow = capabilities?.capabilities.tier === 'C';

  if (settings.limitedNoticeDismissed || (!compact && !slow)) return null;

  return (
    <div className={styles.notice} role="status">
      <Icon name="info" size={16} className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.title}>
          {compact
            ? 'Small screen: windows open full width'
            : 'No GPU here: search runs on the CPU'}
        </p>
        <p className={styles.detail}>
          {compact
            ? 'Tabula is a desktop environment, and this one is built for a large screen — drag, snap and tiling need room. Everything else works, and nothing you open leaves the device.'
            : `${capabilities?.capabilities.tierReason ?? 'This machine has no WebGPU adapter.'} Indexing will be slower; search itself is unaffected.`}
        </p>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => updateSettings({ limitedNoticeDismissed: true })}
        aria-label="Dismiss this notice"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

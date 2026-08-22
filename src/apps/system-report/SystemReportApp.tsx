import { SystemReport } from './SystemReport';

/**
 * About — the System Report as a window.
 *
 * The same component that was the whole page in M0. Inside the desktop it reads the capabilities
 * gathered at boot instead of probing again, and keeps the benchmark harness, which is what makes
 * the performance claims in the documentation checkable rather than quotable.
 */
export default function SystemReportApp() {
  return <SystemReport />;
}

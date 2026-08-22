import { useEffect, useState } from 'react';

/**
 * The network monitor.
 *
 * The project claims that files dropped into this desktop never leave the tab, and that the page
 * talks to exactly two hosts. A claim like that is only worth something if the user can check it,
 * so this reads the browser's own Resource Timing buffer and shows every request the page has
 * made, third-party ones marked.
 *
 * Deliberately not our own bookkeeping: instrumenting our own fetches would only report the
 * requests we chose to report. The browser's record includes the ones we did not.
 */

export interface NetworkEntry {
  origin: string;
  path: string;
  bytes: number;
  /** Anything not served from this origin. */
  thirdParty: boolean;
  startedAt: number;
}

/**
 * Resource Timing keeps a bounded buffer; raising it means a long session still shows everything
 * rather than silently dropping the early requests.
 */
if (typeof performance !== 'undefined' && 'setResourceTimingBufferSize' in performance) {
  performance.setResourceTimingBufferSize(500);
}

export function getNetworkLog(): NetworkEntry[] {
  if (typeof performance === 'undefined') return [];

  try {
    const own = globalThis.location?.origin ?? '';
    return performance
      .getEntriesByType('resource')
      .map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        let origin = own;
        let path = resource.name;
        try {
          const url = new URL(resource.name);
          origin = url.origin;
          path = url.pathname;
        } catch {
          /* Blob and data URLs have no origin; they never left the tab anyway. */
        }
        return {
          origin: origin.replace(/^https?:\/\//, ''),
          path: path.length > 64 ? `…${path.slice(-63)}` : path,
          // Cross-origin responses report 0 unless they send Timing-Allow-Origin.
          bytes: resource.transferSize || 0,
          thirdParty: origin !== own && !resource.name.startsWith('blob:'),
          startedAt: resource.startTime,
        };
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

/** Summary for the taskbar and the About panel. */
export function networkSummary(): { total: number; thirdParty: number; hosts: string[] } {
  const entries = getNetworkLog();
  const hosts = [
    ...new Set(entries.filter((entry) => entry.thirdParty).map((entry) => entry.origin)),
  ];
  return {
    total: entries.length,
    thirdParty: entries.filter((entry) => entry.thirdParty).length,
    hosts,
  };
}

/** Polls while a panel showing it is mounted; there is no event for "a request happened". */
export function useNetworkLog(intervalMs = 2000): NetworkEntry[] {
  const [entries, setEntries] = useState<NetworkEntry[]>(() => getNetworkLog());

  useEffect(() => {
    const update = () => setEntries(getNetworkLog());
    update();
    const timer = setInterval(update, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return entries;
}

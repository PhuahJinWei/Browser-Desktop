import { useEffect, useRef, useState } from 'react';
import type { AppProps } from '../kernel/apps';
import { handleAppCall, type AppContext } from '../kernel/appHost';
import { getInstalledApp, useInstalledApps } from '../kernel/installedApps';
import { settingsStore } from '../kernel/settings';
import { embedForApps, searchForApps } from '../services/index/appBridge';
import type { BootMessage, FromSandbox, ToSandbox } from '../sdk/protocol';
import { runnerDocument } from './runnerDocument';
import { Icon } from './Icon';
import styles from './SandboxedApp.module.css';

/**
 * Runs a third-party app inside a sandboxed iframe.
 *
 * The isolation comes from `sandbox="allow-scripts"` *without* `allow-same-origin`, which gives
 * the frame an opaque origin: no localStorage, no IndexedDB, no OPFS, no cookies, and no way to
 * reach into this document. The frame's own Content-Security-Policy adds `connect-src 'none'`, so
 * it cannot make a network request either. What remains is postMessage, and every message is
 * checked against the app's granted capabilities before anything happens.
 *
 * The token is not a secret so much as an address: it identifies which instance a message belongs
 * to, so a second app in another window cannot answer for this one.
 */

interface SandboxArgs {
  appId?: string;
  fileId?: string;
  [key: string]: unknown;
}

/**
 * How the desktop currently looks, in the two values a sandboxed frame understands.
 *
 * One function, so boot and every later update cannot describe the same desktop differently.
 */
function appearance(): Pick<BootMessage, 'skin' | 'cursors'> {
  const { skin, classicCursors } = settingsStore.get();
  return { skin, cursors: skin === 'classic' && classicCursors ? 'classic' : 'system' };
}

export default function SandboxedApp({ windowId, args }: AppProps) {
  const parsed = (args as SandboxArgs | undefined) ?? {};
  const appId = parsed.appId ?? '';
  const installed = useInstalledApps();
  const app = installed.find((candidate) => candidate.id === appId) ?? getInstalledApp(appId);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'starting' | 'running' | 'crashed'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [runnerHtml, setRunnerHtml] = useState<string | null>(null);
  const tokenRef = useRef<string>('');
  const argsKey = JSON.stringify(parsed);

  // The sandbox document is fetched once and handed to the frame as srcdoc. See runnerDocument.ts
  // for why it is not simply loaded by URL.
  useEffect(() => {
    let cancelled = false;
    void runnerDocument().then((html) => {
      if (!cancelled) setRunnerHtml(html);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!app || !runnerHtml) return;

    const token = crypto.randomUUID();
    tokenRef.current = token;
    setStatus('starting');
    setError(null);

    const context: AppContext = {
      manifest: app.manifest,
      windowId,
      openedFileId: typeof parsed.fileId === 'string' ? parsed.fileId : null,
    };

    const post = (message: ToSandbox) => {
      // The frame has an opaque origin, so '*' is the only usable target. The token is what
      // establishes which instance a reply belongs to.
      frameRef.current?.contentWindow?.postMessage(message, '*');
    };

    const onMessage = async (event: MessageEvent) => {
      // Only messages from this frame's own window are ours to answer.
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as FromSandbox | undefined;
      if (!message || typeof message !== 'object') return;
      // "hello" arrives before the sandbox has been told its token, so it is the one message
      // that cannot carry one. Everything after must.
      if (message.kind !== 'hello' && message.token !== token) return;

      if (message.kind === 'hello') {
        sendBoot();
        return;
      }

      if (message.kind === 'ready') {
        started = true;
        clearInterval(retry);
        setStatus('running');
        return;
      }

      if (message.kind === 'crash') {
        setStatus('crashed');
        setError(message.message);
        return;
      }

      if (message.kind === 'call') {
        try {
          const value = await handleAppCall(context, message.method, message.args, {
            embed: embedForApps,
            search: searchForApps,
          });
          post({ kind: 'result', id: message.id, value });
        } catch (cause) {
          post({
            kind: 'error',
            id: message.id,
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    };

    globalThis.addEventListener('message', onMessage);

    let started = false;

    const sendBoot = () => {
      if (started) return;
      const boot: BootMessage = {
        kind: 'boot',
        manifest: app.manifest,
        source: app.source,
        token,
        args: parsed,
        ...appearance(),
      };
      post(boot);
    };

    /*
     * Appearance is pushed for as long as the app runs, not read once at boot.
     *
     * It used to be a boot-time snapshot, on the reasoning that an app restyling itself mid-session
     * would be a surprise and the window is cheap to reopen. That was wrong in the one case that
     * matters: the skin is a property of the whole desktop, so an open window still wearing the old
     * one after a switch does not read as stable, it reads as broken — a modern app sitting on a
     * 1995 desktop.
     *
     * Here rather than in each app, because a frame is a separate document with no access to the
     * desktop's settings: there is no version of this an app could implement for itself, and every
     * sandboxed app gets it without knowing the message exists.
     */
    const pushAppearance = () => {
      if (!started) return;
      post({ kind: 'appearance', ...appearance() });
    };

    // Settings are the only input now. There used to be a `prefers-color-scheme` listener here as
    // well, because `theme: 'system'` could resolve differently without any setting changing;
    // with one palette there is nothing outside the store that can alter how an app should look.
    const stopWatchingSettings = settingsStore.subscribe(pushAppearance);

    const frame = frameRef.current;
    frame?.addEventListener('load', sendBoot);

    // Belt and braces: the frame may have loaded before this effect ran, and its hello may have
    // arrived before the listener above existed. Retrying costs nothing — boot is guarded on both
    // sides — and turns a race into a certainty.
    const retry = setInterval(sendBoot, 120);
    const giveUp = setTimeout(() => {
      clearInterval(retry);
      if (!started) {
        setStatus('crashed');
        setError('The app did not start. Its sandbox may have been blocked.');
      }
    }, 4000);

    return () => {
      globalThis.removeEventListener('message', onMessage);
      stopWatchingSettings();
      frame?.removeEventListener('load', sendBoot);
      clearInterval(retry);
      clearTimeout(giveUp);
    };
    // Depends on the args' *value*, not their identity: a fresh object every render would
    // restart the app on every render.
  }, [app, windowId, argsKey, runnerHtml]);

  if (!app) {
    return (
      <div className={styles.state}>
        <Icon name="alert" size={24} />
        <p>That app is not installed.</p>
        <p className={styles.hint}>Install one in Settings → Apps.</p>
      </div>
    );
  }

  return (
    <div className={styles.host}>
      {status === 'crashed' ? (
        <div className={styles.crash}>
          <Icon name="alert" size={16} />
          <div>
            <p className={styles.crashTitle}>{app.manifest.name} stopped</p>
            <p className={styles.crashText}>{error}</p>
          </div>
        </div>
      ) : null}

      {runnerHtml ? (
        <iframe
          ref={frameRef}
          className={styles.frame}
          // No allow-same-origin: that single omission is what makes the frame an opaque origin,
          // and therefore what makes everything else about this sandbox true.
          sandbox="allow-scripts"
          srcDoc={runnerHtml}
          title={`${app.manifest.name} (sandboxed)`}
        />
      ) : null}

      {status === 'starting' ? (
        <div className={styles.starting}>Starting {app.manifest.name}…</div>
      ) : null}
    </div>
  );
}

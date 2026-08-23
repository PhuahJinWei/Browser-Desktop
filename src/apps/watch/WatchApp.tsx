import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { notify, notifyError } from '../../kernel/notifications';
import { useSetting, updateSettings } from '../../kernel/settings';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, type VfsNode } from '../../kernel/vfs/types';
import { setWindowChip } from '../../kernel/windowChips';
import { ContextMenu, keepsNativeMenu, useContextMenu } from '../../shell/ContextMenu';
import { Icon } from '../../shell/Icon';
import {
  emptyWatched,
  forget,
  parseLink,
  parseWatched,
  remember,
  save,
  serialiseWatched,
  unsave,
  watchUrl,
  type Watched,
  type WatchedEntry,
} from './watched';
import styles from './WatchApp.module.css';

/**
 * Watch — a YouTube player in a window, and deliberately not a browser.
 *
 * The distinction is the whole design. A browser-in-a-browser fails the first time someone types
 * an address: sites refuse to be framed, and this desktop's cross-origin isolation blocks any frame
 * that has not opted in (ADR 19). YouTube's **embed** endpoint exists to be framed and plays any
 * video by id, so pasting a link works every time — which is the only kind of demo worth building.
 *
 * **This is the one place in the desktop that contacts another company's server**, and everything
 * here is arranged so that fact is visible rather than buried:
 *
 * - nothing loads until a link is pasted, and the consent card is shown once before the first one;
 * - while a frame is up, a chip sits in the window's title bar naming the host, and it disappears
 *   on Stop or on close, because a badge that outlives the connection is worse than none;
 * - there are no thumbnails. Each would be a request to Google's image host fired the moment the
 *   app opened, before anyone chose anything. Text rows instead — the rule is that every network
 *   contact is one you just asked for;
 * - no `iframe_api` script, so nothing of Google's runs in this origin. Title and channel arrive
 *   over the embed's own `postMessage` protocol, and `script-src` is unchanged.
 *
 * The frame is `<iframe credentialless>`, which is what lets it load under COEP without YouTube
 * opting in: it gets a throwaway, cookie-less context. That is also why it is always logged out —
 * no account, no history, no recommendations of yours — which is a privacy property as much as a
 * limitation. It is Chromium-only today; elsewhere the app says so and offers the outward link.
 */

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
const FOLDER = 'Videos';
const FILE = 'Watched.md';

type Loaded = { videoId: string; listId?: string | undefined };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Chromium is the only engine that has shipped credentialless frames; see the M7 spike. */
function supportsCredentialless(): boolean {
  return (
    typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype
  );
}

export default function WatchApp({ windowId, args }: AppProps) {
  const consented = useSetting('watchConsent');
  const [watched, setWatched] = useState<Watched>(() => emptyWatched());
  const [fileNode, setFileNode] = useState<VfsNode | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pending, setPending] = useState<Loaded | null>(null);
  const [now, setNow] = useState<{ title: string; channel: string }>({ title: '', channel: '' });

  const frame = useRef<HTMLIFrameElement | null>(null);
  // The write-on-title effect below needs the current file but must not re-run when it changes —
  // it writes that file, so watching it would be a loop. A ref hands it the latest value without
  // the dependency, which is the honest shape of "read this, do not subscribe to it".
  const latest = useRef<Watched>(watched);
  latest.current = watched;
  const supported = useMemo(supportsCredentialless, []);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  /* The file ---------------------------------------------------------------------------------- */

  const load = useCallback(async () => {
    const root = await vfs.list(ROOT_ID);
    const folder = root.find((node) => node.kind === 'directory' && node.name === FOLDER);
    if (!folder) return;
    const found = (await vfs.list(folder.id)).find((node) => node.name === FILE);
    if (!found) return;
    setFileNode(found);
    try {
      setWatched(parseWatched(await vfs.readText(found.id)));
    } catch {
      // A file we cannot read is left alone rather than overwritten with an empty one.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Writes the file, creating `Videos/` on the way if this is the first video ever played. */
  const persist = useCallback(async (next: Watched) => {
    setWatched(next);
    try {
      const root = await vfs.list(ROOT_ID);
      const folder =
        root.find((node) => node.kind === 'directory' && node.name === FOLDER) ??
        (await vfs.createDirectory(ROOT_ID, FOLDER));
      const node = await vfs.writeText(folder.id, FILE, serialiseWatched(next), {
        mime: 'text/markdown',
        overwrite: true,
      });
      setFileNode(node);
    } catch (cause) {
      notifyError('Could not update Videos/Watched.md', cause);
    }
  }, []);

  /* The frame --------------------------------------------------------------------------------- */

  // The chip is the visible half of the privacy claim, so it is tied to the frame's existence
  // rather than set alongside it: every path that clears `loaded` clears the chip too.
  useEffect(() => {
    setWindowChip(
      windowId,
      loaded
        ? {
            label: 'talking to youtube-nocookie.com',
            detail:
              'A video is loaded, so this window is connected to youtube-nocookie.com. Stop, or close the window, and it is not.',
          }
        : null,
    );
  }, [windowId, loaded]);

  useEffect(() => () => setWindowChip(windowId, null), [windowId]);

  const src = useMemo(() => {
    if (!loaded) return null;
    const params = new URLSearchParams({
      enablejsapi: '1',
      autoplay: '1',
      playsinline: '1',
      rel: '0',
      origin: globalThis.location.origin,
    });
    if (loaded.listId) params.set('list', loaded.listId);
    return `${EMBED_ORIGIN}/embed/${loaded.videoId}?${params.toString()}`;
  }, [loaded]);

  /* Title and channel arrive from the embed itself; nothing of Google's runs in this origin. */
  useEffect(() => {
    if (!loaded) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== EMBED_ORIGIN || event.source !== frame.current?.contentWindow) return;
      let data: unknown = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const info = (data as { info?: { videoData?: { title?: string; author?: string } } })?.info;
      const videoData = info?.videoData;
      if (!videoData?.title) return;
      setNow({ title: videoData.title, channel: videoData.author ?? '' });
    };
    globalThis.addEventListener('message', onMessage);

    // The widget ignores anything sent before it is ready and offers no event to say when that is,
    // so the handshake is repeated briefly rather than sent once and hoped for.
    let sent = 0;
    const handshake = setInterval(() => {
      if (++sent > 20) return clearInterval(handshake);
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: windowId, channel: 'widget' }),
        EMBED_ORIGIN,
      );
    }, 400);

    return () => {
      globalThis.removeEventListener('message', onMessage);
      clearInterval(handshake);
    };
  }, [loaded, windowId]);

  /* Once a title is known, the row in the file gets a name rather than an id. */
  useEffect(() => {
    if (!loaded || !now.title) return;
    void persist(
      remember(latest.current, {
        id: loaded.videoId,
        title: now.title,
        channel: now.channel,
        at: today(),
      }),
    );
  }, [loaded, now.title, now.channel]);

  /* Actions ----------------------------------------------------------------------------------- */

  const play = useCallback(
    (link: Loaded) => {
      setError(null);
      setNow({ title: '', channel: '' });
      if (!consented) {
        setPending(link);
        return;
      }
      setLoaded(link);
    },
    [consented],
  );

  const submit = useCallback(() => {
    const link = parseLink(input);
    if (!link) {
      setError('That does not look like a YouTube link or video id.');
      return;
    }
    setInput('');
    play(link.listId ? { videoId: link.videoId, listId: link.listId } : { videoId: link.videoId });
  }, [input, play]);

  const stop = useCallback(() => {
    setLoaded(null);
    setNow({ title: '', channel: '' });
  }, []);

  const current: WatchedEntry | null = loaded
    ? {
        id: loaded.videoId,
        title: now.title || loaded.videoId,
        channel: now.channel,
        at: today(),
      }
    : null;
  const isSaved = current ? watched.saved.some((entry) => entry.id === current.id) : false;

  const openOutward = useCallback((id: string) => {
    // A real tab, not a frame: the same answer Portfolio gives, for the same reason (ADR 19).
    globalThis.open(watchUrl(id), '_blank', 'noopener,noreferrer');
  }, []);

  const rowMenu = useCallback(
    (entry: WatchedEntry, inSaved: boolean) => [
      { id: 'play', label: 'Play', run: () => play({ videoId: entry.id }) },
      inSaved
        ? {
            id: 'unsave',
            label: 'Remove from Saved',
            run: () => void persist(unsave(watched, entry.id)),
          }
        : { id: 'save', label: 'Save', run: () => void persist(save(watched, entry)) },
      {
        id: 'copy',
        label: 'Copy link',
        run: () => {
          void navigator.clipboard
            ?.writeText(watchUrl(entry.id))
            .then(() => notify({ title: 'Link copied', level: 'success' }))
            .catch(() => notifyError('Could not copy', new Error('The clipboard refused')));
        },
      },
      { id: 'open', label: 'Open on YouTube', run: () => openOutward(entry.id) },
      ...(inSaved
        ? []
        : [
            {
              id: 'forget',
              label: 'Remove from Recent',
              danger: true,
              run: () => void persist(forget(watched, entry.id)),
            },
          ]),
    ],
    [openOutward, persist, play, watched],
  );

  /* ------------------------------------------------------------------------------------------- */

  const initial = (args as { videoId?: string } | undefined)?.videoId;
  useEffect(() => {
    if (initial && parseLink(initial)) play({ videoId: initial });
  }, []);

  return (
    <div className={styles.app}>
      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}

      <div className={styles.pasteBar}>
        <label className={styles.field}>
          <Icon name="link" size={14} />
          <input
            className={styles.input}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            placeholder="YouTube link or video id"
            aria-label="YouTube link or video id"
            spellCheck={false}
          />
        </label>
        <button type="button" className={styles.play} onClick={submit} disabled={!input.trim()}>
          Play
        </button>
        {loaded ? (
          <button type="button" className={styles.small} onClick={stop}>
            Stop
          </button>
        ) : null}
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <List
            heading="Saved"
            entries={watched.saved}
            emptyText="Nothing saved yet."
            currentId={loaded?.videoId ?? null}
            onPlay={(entry) => play({ videoId: entry.id })}
            onMenu={(event, entry) => {
              if (keepsNativeMenu(event)) return;
              openMenu(event, rowMenu(entry, true));
            }}
          />
          <List
            heading="Recent"
            entries={watched.recent}
            emptyText="Nothing watched yet."
            currentId={loaded?.videoId ?? null}
            onPlay={(entry) => play({ videoId: entry.id })}
            onMenu={(event, entry) => {
              if (keepsNativeMenu(event)) return;
              openMenu(event, rowMenu(entry, false));
            }}
          />
          {fileNode ? (
            <p className={styles.fileNote}>
              Kept in <code>Videos/Watched.md</code> — an ordinary file you can read, search or
              delete.
            </p>
          ) : null}
        </aside>

        <main className={styles.main}>
          <div className={styles.stage}>
            {pending ? (
              <Consent
                onAccept={() => {
                  updateSettings({ watchConsent: true });
                  setLoaded(pending);
                  setPending(null);
                }}
                onCancel={() => setPending(null)}
              />
            ) : !supported ? (
              <div className={styles.notice}>
                <h2 className={styles.noticeTitle}>This browser cannot show the player here</h2>
                <p>
                  Playing YouTube inside the desktop needs a <code>credentialless</code> frame,
                  which only Chromium-based browsers have shipped. Dropping the isolation that
                  requires it would cost threaded WebAssembly for every other app, so this window
                  keeps the isolation and loses the player.
                </p>
                <p>Saved and Recent still work, and open outward.</p>
              </div>
            ) : src ? (
              <iframe
                ref={frame}
                key={src}
                className={styles.frame}
                src={src}
                title="YouTube player"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                // React does not know this attribute; it is what admits the frame under COEP.
                {...{ credentialless: 'true' }}
              />
            ) : (
              <div className={styles.notice}>
                <h2 className={styles.noticeTitle}>Paste a link to start</h2>
                <p>
                  This is the only window in Tabula that talks to another site — youtube.com — and
                  only while something is loaded. Nothing is fetched before you paste.
                </p>
              </div>
            )}
          </div>

          {current && src ? (
            <div className={styles.nowBar}>
              <div className={styles.nowText}>
                <span className={styles.nowTitle}>{current.title}</span>
                {current.channel ? (
                  <span className={styles.nowChannel}>{current.channel}</span>
                ) : null}
              </div>
              <button
                type="button"
                className={styles.small}
                aria-pressed={isSaved}
                onClick={() =>
                  void persist(isSaved ? unsave(watched, current.id) : save(watched, current))
                }
              >
                {isSaved ? '★ Saved' : '☆ Save'}
              </button>
              <button
                type="button"
                className={styles.small}
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(watchUrl(current.id))
                    .then(() => notify({ title: 'Link copied', level: 'success' }))
                    .catch(() => notifyError('Could not copy', new Error('The clipboard refused')));
                }}
              >
                Copy link
              </button>
              <button
                type="button"
                className={styles.small}
                onClick={() => openOutward(current.id)}
              >
                Open on YouTube ↗
              </button>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function List({
  heading,
  entries,
  emptyText,
  currentId,
  onPlay,
  onMenu,
}: {
  heading: string;
  entries: WatchedEntry[];
  emptyText: string;
  currentId: string | null;
  onPlay: (entry: WatchedEntry) => void;
  onMenu: (event: React.MouseEvent, entry: WatchedEntry) => void;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{heading}</h2>
      {entries.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`${styles.row} ${entry.id === currentId ? styles.rowActive : ''}`}
                onClick={() => onPlay(entry)}
                onContextMenu={(event) => onMenu(event, entry)}
                title={entry.title}
              >
                <span className={styles.rowTitle}>{entry.title}</span>
                <span className={styles.rowMeta}>
                  {[entry.channel, entry.at].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Shown once, before the first frame is ever loaded, in the same shape as a permission prompt —
 * because it is one. Cancel is the default: the safe answer is the one that happens by accident.
 */
function Consent({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);

  return (
    <div className={styles.consent} role="dialog" aria-modal="true" aria-labelledby="watch-consent">
      <h2 className={styles.consentTitle} id="watch-consent">
        Watch plays videos from YouTube
      </h2>
      <p>
        While a video is loaded, this window talks to <code>youtube-nocookie.com</code> and Google
        sees the request — no cookies, no account, no history. Nothing else in Tabula changes, and
        nothing loads until you ask for it.
      </p>
      <p className={styles.consentAside}>
        You can withdraw this in Settings, and the title bar says so while a video is loaded.
      </p>
      <div className={styles.consentActions}>
        <button type="button" className={styles.small} ref={cancelRef} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.play} onClick={onAccept}>
          Play the video
        </button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { launchApp, type AppProps } from '../../kernel/apps';
import { notify, notifyError } from '../../kernel/notifications';
import { useSetting } from '../../kernel/settings';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { closeWindow, setWindowTitle } from '../../kernel/windows';
import { canExportClips, listVideos, saveClip, saveFrame } from '../../services/video/client';
import {
  SAMPLE_VIDEO_SECONDS,
  isSampleVideoSupported,
  recordSampleVideo,
} from '../../shell/sampleVideo';
import {
  ContextMenu,
  keepsNativeMenu,
  separator,
  useContextMenu,
  type MenuSpec,
} from '../../shell/ContextMenu';
import { OpenDialog } from '../../shell/Dialog';
import { Icon } from '../../shell/Icon';
import { MediaGlyph } from '../../shell/MediaGlyph';
import { MenuBar, type MenuBarMenu } from '../../shell/MenuBar';
import { nodeMenuItems } from '../../shell/nodeMenu';
import { AppIcon } from '../../shell/PixelIcon';
import styles from './VideoApp.module.css';

/**
 * Media Player.
 *
 * A player, and two things worth having that need no model at all: pull the frame you are looking
 * at out as a picture, and cut the section you are watching into its own file. Both are canvas and
 * MediaRecorder — things the browser has been able to do for years and almost nothing does. It can
 * also draw its own sample film, live, so there is something to play on a machine with no videos.
 *
 * Its shape follows the skin. Classic is the late-1990s Media Player: the picture, a seek bar, a
 * row of small transport buttons and a status line, with File ▸ Open for choosing a video and the
 * frame and section exports in the File menu. Modern is the current one: a library down the side,
 * the picture filling the rest, and a transport bar along the bottom with play in the middle.
 */

/** Lengths offered for an exported section. Kept short, because export runs in real time. */
const CLIP_LENGTHS = [5, 10, 30];
const SKIP = 10;

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export default function VideoApp({ windowId, args }: AppProps) {
  const initial = (args as { fileId?: string } | undefined) ?? {};
  const classic = useSetting('skin') === 'classic';
  const [videos, setVideos] = useState<VfsNode[]>([]);
  const [selected, setSelected] = useState<string | null>(initial.fileId ?? null);
  const [recording, setRecording] = useState<{ fraction: number; subject: string } | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);

  const recordCanvas = useRef<HTMLCanvasElement | null>(null);
  const player = useRef<HTMLVideoElement | null>(null);
  /** Set while the player is seeking to the end to learn a length the file did not state. */
  const measuring = useRef(false);
  const { menu, open: openMenu, openUnder, close: closeMenu } = useContextMenu();

  const load = useCallback(async () => {
    const found = await listVideos();
    setVideos(found);
    // The modern library opens on the newest; classic opens empty, as the era's player did.
    if (!classic) setSelected((current) => current ?? found[0]?.id ?? null);
  }, [classic]);

  useEffect(() => {
    void load();
    return vfs.onChange(() => void load());
  }, [load]);

  const selectedNode = videos.find((node) => node.id === selected) ?? null;

  useEffect(() => {
    const app = classic ? 'Media Player' : 'Video';
    setWindowTitle(windowId, selectedNode ? `${selectedNode.name} — ${app}` : app);
  }, [windowId, selectedNode, classic]);

  /* Making the sample film -------------------------------------------------------------------- */

  const makeSample = useCallback(async () => {
    if (!isSampleVideoSupported()) {
      notifyError('Cannot record here', new Error('This browser has no canvas recorder'));
      return;
    }
    setRecording({ fraction: 0, subject: 'starting' });
    try {
      const result = await recordSampleVideo({
        ...(recordCanvas.current ? { canvas: recordCanvas.current } : {}),
        onProgress: (fraction, subject) => setRecording({ fraction, subject }),
      });
      const node = await vfs.writeFile({
        parentId: ROOT_ID,
        name: result.name,
        data: result.data,
        mime: result.mime,
        overwrite: true,
      });
      setSelected(node.id);
      notify({
        title: 'Sample video created',
        body: `${formatBytes(node.size)}, drawn and encoded on this device — nothing downloaded.`,
        level: 'success',
        timeout: 8000,
      });
      await load();
    } catch (error) {
      notifyError('Could not record the sample video', error);
    } finally {
      setRecording(null);
    }
  }, [load]);

  /* Playback ---------------------------------------------------------------------------------- */

  useEffect(() => {
    if (!selectedNode) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setUnreadable(null);
    setPosition(0);
    setDuration(0);
    setPlaying(false);
    void (async () => {
      try {
        const { data } = await vfs.read(selectedNode.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([data], { type: selectedNode.mime }));
        setUrl(objectUrl);
      } catch (error) {
        // A file the desktop lists but cannot open is a state worth showing on the stage, not an
        // unhandled rejection and a black rectangle.
        if (!cancelled) {
          setUrl(null);
          setUnreadable(error instanceof Error ? error.message : 'This video could not be opened');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedNode]);

  const play = useCallback(() => {
    void player.current?.play();
  }, []);
  const pause = useCallback(() => player.current?.pause(), []);
  const stop = useCallback(() => {
    const element = player.current;
    if (!element) return;
    element.pause();
    element.currentTime = 0;
  }, []);
  const seek = useCallback((seconds: number) => {
    const element = player.current;
    if (element) element.currentTime = Math.max(0, Math.min(seconds, element.duration || seconds));
  }, []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  /* Exports ------------------------------------------------------------------------------------ */

  const doSaveFrame = useCallback(async () => {
    if (!selectedNode) return;
    const saved = await saveFrame(selectedNode, position).catch((error: unknown) => {
      notifyError('Could not save that frame', error);
      return null;
    });
    if (saved) notify({ title: `Saved ${saved.name}`, level: 'success' });
  }, [selectedNode, position]);

  const doSaveClip = useCallback(
    async (length: number) => {
      if (!selectedNode) return;
      // The export plays the section in its own element; leaving this one running would mean two
      // copies of the same audio.
      player.current?.pause();
      setExporting(0);
      try {
        const saved = await saveClip(selectedNode, position, position + length, setExporting);
        if (saved) notify({ title: `Saved ${saved.name}`, level: 'success' });
      } catch (error) {
        notifyError('Could not export that section', error);
      } finally {
        setExporting(null);
      }
    },
    [selectedNode, position],
  );

  const exportItems = (): MenuSpec =>
    CLIP_LENGTHS.map((seconds) => ({
      id: `export.${seconds}`,
      label: `${seconds} seconds from here`,
      disabled: exporting !== null,
      run: () => void doSaveClip(seconds),
    }));

  const ready = selectedNode !== null && url !== null && !recording;

  /* Shared pieces ------------------------------------------------------------------------------ */

  const stage = (
    <div className={styles.stage} onDoubleClick={toggle}>
      {/*
        Always mounted, hidden until it is recording. Rendering it only while `recording` is set
        looked equivalent and was not: the ref is populated on commit, which happens after the
        recorder has already been handed a canvas.
      */}
      <canvas
        ref={recordCanvas}
        className={recording ? styles.canvas : styles.canvasHidden}
        width={512}
        height={512}
      />
      {recording ? null : url ? (
        <video
          ref={player}
          className={styles.player}
          src={url}
          playsInline
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onSeeked={(event) => setPosition(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            if (Number.isFinite(element.duration)) {
              setDuration(element.duration);
              return;
            }
            // A file made by MediaRecorder — the sample, an exported section — has no length in its
            // header, so the browser reports Infinity until it has read to the end. Asking for a
            // time past the end makes it find out; the length arrives as a durationchange.
            measuring.current = true;
            element.currentTime = Number.MAX_SAFE_INTEGER;
          }}
          onDurationChange={(event) => {
            const element = event.currentTarget;
            if (!Number.isFinite(element.duration)) return;
            setDuration(element.duration);
            if (measuring.current) {
              measuring.current = false;
              element.currentTime = 0;
            }
          }}
        />
      ) : unreadable ? (
        <p className={styles.stageEmpty}>{unreadable}</p>
      ) : (
        <p className={styles.stageEmpty}>
          {classic
            ? 'File ▸ Open a video, or make the sample one.'
            : 'Choose a video, or make the sample one.'}
        </p>
      )}
    </div>
  );

  const banner = recording ? (
    <div className={styles.banner} role="status">
      <span className={styles.spinner} />
      <div>
        <p className={styles.bannerTitle}>Drawing “{recording.subject}”</p>
        <p className={styles.bannerText}>
          Recorded in real time — {SAMPLE_VIDEO_SECONDS} seconds, because a canvas recorder is
          stamped by the wall clock. {Math.round(recording.fraction * 100)}% done.
        </p>
      </div>
    </div>
  ) : null;

  const seekBar = (
    <input
      type="range"
      className={styles.seek}
      min={0}
      max={duration || 1}
      step={0.1}
      value={position}
      disabled={!ready}
      onChange={(event) => seek(Number(event.target.value))}
      aria-label="Position"
      aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
    />
  );

  const openDialogElement = openDialog ? (
    <OpenDialog
      accepts={(node) => node.mime.startsWith('video/')}
      icon="video"
      label="Videos"
      empty="No videos yet. Drop one into Files, or make the sample video."
      onOpen={(id) => {
        setOpenDialog(false);
        setSelected(id);
        void load();
      }}
      onCancel={() => setOpenDialog(false)}
    />
  ) : null;

  /* Classic: the late-1990s Media Player ----------------------------------------------------- */

  if (classic) {
    const menus: MenuBarMenu[] = [
      {
        id: 'file',
        label: 'File',
        items: () => [
          { id: 'file.open', label: 'Open…', run: () => setOpenDialog(true) },
          isSampleVideoSupported() && {
            id: 'file.sample',
            label: 'Make Sample Video',
            disabled: recording !== null,
            run: () => void makeSample(),
          },
          separator('file.s1'),
          {
            id: 'file.frame',
            label: 'Save This Frame',
            disabled: !ready,
            run: () => void doSaveFrame(),
          },
          canExportClips() && {
            id: 'file.export',
            label:
              exporting !== null ? `Exporting ${Math.round(exporting * 100)}%` : 'Export Section',
            disabled: !ready || exporting !== null,
            items: exportItems(),
          },
          separator('file.s2'),
          {
            id: 'file.reveal',
            label: 'Show in Files',
            disabled: !selectedNode?.parentId,
            run: () => {
              if (!selectedNode?.parentId) return;
              launchApp('files', {
                args: { directoryId: selectedNode.parentId, selectId: selectedNode.id },
                title: 'Files',
              });
            },
          },
          { id: 'file.exit', label: 'Exit', run: () => closeWindow(windowId) },
        ],
      },
      {
        id: 'play',
        label: 'Play',
        items: () => [
          { id: 'play.toggle', label: playing ? 'Pause' : 'Play', disabled: !ready, run: toggle },
          { id: 'play.stop', label: 'Stop', disabled: !ready, run: stop },
          separator('play.s1'),
          {
            id: 'play.back',
            label: `Rewind ${SKIP} seconds`,
            disabled: !ready,
            run: () => seek(position - SKIP),
          },
          {
            id: 'play.forward',
            label: `Fast Forward ${SKIP} seconds`,
            disabled: !ready,
            run: () => seek(position + SKIP),
          },
        ],
      },
      {
        id: 'help',
        label: 'Help',
        items: () => [
          {
            id: 'help.about',
            label: 'About Tabula',
            run: () => void launchApp('about', { args: { section: 'about' } }),
          },
        ],
      },
    ];

    return (
      <div className={styles.classic}>
        <MenuBar menus={menus} label="Media Player" />
        {banner}
        {stage}
        <div className={styles.classicControls}>
          {seekBar}
          <div className={styles.transport} role="toolbar" aria-label="Media Player">
            <button
              type="button"
              aria-label="Play"
              title="Play"
              disabled={!ready || playing}
              onClick={play}
            >
              <MediaGlyph name="play" size={12} />
            </button>
            <button
              type="button"
              aria-label="Pause"
              title="Pause"
              disabled={!ready || !playing}
              onClick={pause}
            >
              <MediaGlyph name="pause" size={12} />
            </button>
            <button type="button" aria-label="Stop" title="Stop" disabled={!ready} onClick={stop}>
              <MediaGlyph name="stop" size={10} />
            </button>
            <span className={styles.transportGap} />
            <button
              type="button"
              aria-label={`Rewind ${SKIP} seconds`}
              title="Rewind"
              disabled={!ready}
              onClick={() => seek(position - SKIP)}
            >
              <MediaGlyph name="back" size={12} />
            </button>
            <button
              type="button"
              aria-label={`Fast forward ${SKIP} seconds`}
              title="Fast Forward"
              disabled={!ready}
              onClick={() => seek(position + SKIP)}
            >
              <MediaGlyph name="forward" size={12} />
            </button>
          </div>
        </div>
        <div className={styles.status}>
          <span className={styles.statusCell}>
            {recording
              ? 'Recording sample'
              : exporting !== null
                ? `Exporting ${Math.round(exporting * 100)}%`
                : !ready
                  ? 'Ready'
                  : playing
                    ? 'Playing'
                    : position > 0
                      ? 'Paused'
                      : 'Stopped'}
          </span>
          <span className={styles.statusCell}>
            {formatTime(position)} / {formatTime(duration)}
          </span>
        </div>
        {openDialogElement}
      </div>
    );
  }

  /* Modern: the current Media Player --------------------------------------------------------- */

  return (
    <div
      className={styles.app}
      onContextMenu={(event) => {
        if (!selectedNode || keepsNativeMenu(event)) return;
        openMenu(event, nodeMenuItems(selectedNode, { omitOpen: true }));
      }}
    >
      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}

      <aside className={styles.sidebar}>
        <div className={styles.sidebarHead}>Video library</div>
        {isSampleVideoSupported() ? (
          <button
            type="button"
            className={styles.sampleButton}
            disabled={recording !== null}
            onClick={() => void makeSample()}
            title={`Draws and records a ${SAMPLE_VIDEO_SECONDS}-second video on this device`}
          >
            <Icon name="plus" size={14} /> Make a sample video
          </button>
        ) : null}
        {videos.length === 0 ? (
          <p className={styles.sidebarEmpty}>No videos yet. Drop one into Files.</p>
        ) : (
          <ul className={styles.videoList}>
            {videos.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  className={`${styles.videoItem} ${node.id === selected ? styles.videoItemSelected : ''}`}
                  onClick={() => setSelected(node.id)}
                >
                  <AppIcon name="video" size={24} />
                  <span className={styles.videoText}>
                    <span className={styles.videoName}>{node.name.replace(/\.[^.]+$/, '')}</span>
                    <span className={styles.videoMeta}>{formatBytes(node.size)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <main className={styles.main}>
        {banner}
        {stage}
        <div className={styles.transportBar}>
          <div className={styles.seekRow}>
            <span>{formatTime(position)}</span>
            {seekBar}
            <span>{formatTime(duration)}</span>
          </div>
          <div className={styles.buttonRow}>
            <span className={styles.nowPlaying}>
              {selectedNode?.name.replace(/\.[^.]+$/, '') ?? ''}
            </span>
            <div className={styles.centerControls}>
              <button
                type="button"
                className={styles.roundButton}
                aria-label={`Back ${SKIP} seconds`}
                title={`Back ${SKIP} seconds`}
                disabled={!ready}
                onClick={() => seek(position - SKIP)}
              >
                <MediaGlyph name="back" size={14} />
              </button>
              <button
                type="button"
                className={styles.playButton}
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause' : 'Play'}
                disabled={!ready}
                onClick={toggle}
              >
                <MediaGlyph name={playing ? 'pause' : 'play'} size={18} />
              </button>
              <button
                type="button"
                className={styles.roundButton}
                aria-label={`Forward ${SKIP} seconds`}
                title={`Forward ${SKIP} seconds`}
                disabled={!ready}
                onClick={() => seek(position + SKIP)}
              >
                <MediaGlyph name="forward" size={14} />
              </button>
            </div>
            <div className={styles.endControls}>
              <button
                type="button"
                className={styles.roundButton}
                aria-label="Save this frame as a picture"
                title="Save this frame as a picture"
                disabled={!ready}
                onClick={() => void doSaveFrame()}
              >
                <Icon name="image" size={16} />
              </button>
              {canExportClips() ? (
                <button
                  type="button"
                  className={styles.roundButton}
                  aria-label={
                    exporting !== null
                      ? `Exporting ${Math.round(exporting * 100)}%`
                      : 'Export a section from here'
                  }
                  title="Export a section from here — re-encoded in real time"
                  aria-haspopup="menu"
                  disabled={!ready || exporting !== null}
                  onClick={(event) => openUnder(event.currentTarget, exportItems())}
                >
                  <Icon name="download" size={16} />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

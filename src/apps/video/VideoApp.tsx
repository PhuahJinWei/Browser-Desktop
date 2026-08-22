import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { notify, notifyError } from '../../kernel/notifications';
import { canExportClips, listVideos, saveClip, saveFrame } from '../../services/video/client';
import {
  SAMPLE_VIDEO_SECONDS,
  isSampleVideoSupported,
  recordSampleVideo,
} from '../../shell/sampleVideo';
import { Icon } from '../../shell/Icon';
import styles from './VideoApp.module.css';

/**
 * Video.
 *
 * A player, and two things worth having that need no model at all: pull the frame you are looking
 * at out as a picture, and cut the section you are watching into its own file. Both are canvas and
 * MediaRecorder — things the browser has been able to do for years and almost nothing does.
 *
 * It can also draw its own sample film, live, so there is something to play on a machine with no
 * videos on it.
 */

/** Lengths offered for an exported section. Kept short, because export runs in real time. */
const CLIP_LENGTHS = [5, 10, 30];

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export default function VideoApp({ args }: AppProps) {
  const initial = (args as { fileId?: string } | undefined) ?? {};
  const [videos, setVideos] = useState<VfsNode[]>([]);
  const [selected, setSelected] = useState<string | null>(initial.fileId ?? null);
  const [recording, setRecording] = useState<{ fraction: number; subject: string } | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [clipLength, setClipLength] = useState(10);
  const [position, setPosition] = useState(0);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const recordCanvas = useRef<HTMLCanvasElement | null>(null);
  const player = useRef<HTMLVideoElement | null>(null);

  const load = useCallback(async () => {
    const found = await listVideos();
    setVideos(found);
    setSelected((current) => current ?? found[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
    return vfs.onChange(() => void load());
  }, [load]);

  const selectedNode = videos.find((node) => node.id === selected) ?? null;

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

  /* Exports ------------------------------------------------------------------------------------ */

  const doSaveFrame = useCallback(async () => {
    if (!selectedNode) return;
    const saved = await saveFrame(selectedNode, position).catch((error: unknown) => {
      notifyError('Could not save that frame', error);
      return null;
    });
    if (saved) notify({ title: `Saved ${saved.name}`, level: 'success' });
  }, [selectedNode, position]);

  const doSaveClip = useCallback(async () => {
    if (!selectedNode) return;
    // The export plays the section in its own element; leaving this one running would mean two
    // copies of the same audio.
    player.current?.pause();
    setExporting(0);
    try {
      const saved = await saveClip(selectedNode, position, position + clipLength, setExporting);
      if (saved) notify({ title: `Saved ${saved.name}`, level: 'success' });
    } catch (error) {
      notifyError('Could not export that section', error);
    } finally {
      setExporting(null);
    }
  }, [selectedNode, position, clipLength]);

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <span className={styles.count}>
          {videos.length} video{videos.length === 1 ? '' : 's'}
        </span>
        <span className={styles.activeName}>
          Save the frame you are looking at, or cut out the section you are watching — both on this
          device, with nothing downloaded.
        </span>
      </div>

      {recording ? (
        <div className={styles.banner}>
          <span className={styles.spinner} />
          <div className={styles.bannerBody}>
            <p className={styles.bannerTitle}>Drawing “{recording.subject}”</p>
            <p className={styles.bannerText}>
              Recorded in real time — {SAMPLE_VIDEO_SECONDS} seconds, because a canvas recorder is
              stamped by the wall clock. {Math.round(recording.fraction * 100)}% done.
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}>
            <span>Videos</span>
            {isSampleVideoSupported() ? (
              <button
                type="button"
                className={styles.small}
                disabled={recording !== null}
                onClick={() => void makeSample()}
                title={`Draws and records a ${SAMPLE_VIDEO_SECONDS}-second video on this device`}
              >
                <Icon name="plus" size={12} /> Sample
              </button>
            ) : null}
          </div>

          {videos.length === 0 ? (
            <p className={styles.sidebarEmpty}>
              No videos yet. Drop one into Files, or make the sample video above.
            </p>
          ) : (
            <ul className={styles.videoList}>
              {videos.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className={`${styles.videoItem} ${
                      node.id === selected ? styles.videoItemSelected : ''
                    }`}
                    onClick={() => setSelected(node.id)}
                  >
                    <Icon name="video" size={14} />
                    <span className={styles.videoName}>{node.name}</span>
                    <span className={styles.videoMeta}>{formatBytes(node.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className={styles.main}>
          <div className={styles.stage}>
            {/*
              Always mounted, hidden until it is recording. Rendering it only while `recording` is
              set looked equivalent and was not: the ref is populated on commit, which happens
              after the recorder has already been handed a canvas.
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
                controls
                playsInline
                onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
                onSeeked={(event) => setPosition(event.currentTarget.currentTime)}
              />
            ) : unreadable ? (
              <p className={styles.stageEmpty}>{unreadable}</p>
            ) : (
              <p className={styles.stageEmpty}>Select a video, or make the sample one.</p>
            )}
          </div>

          {selectedNode && url ? (
            <div className={styles.activeBar}>
              <span className={styles.activeRange}>{formatTime(position)}</span>
              <button type="button" className={styles.small} onClick={() => void doSaveFrame()}>
                <Icon name="image" size={12} /> Save this frame
              </button>

              {canExportClips() ? (
                <>
                  <label className={styles.scope}>
                    Section
                    <select
                      className={styles.select}
                      value={clipLength}
                      onChange={(event) => setClipLength(Number(event.target.value))}
                      aria-label="Length of the exported section"
                    >
                      {CLIP_LENGTHS.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds}s
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={styles.small}
                    disabled={exporting !== null}
                    onClick={() => void doSaveClip()}
                    title="Re-encodes in real time, so a ten-second section takes ten seconds"
                  >
                    <Icon name="download" size={12} />
                    {exporting !== null
                      ? `Exporting ${Math.round(exporting * 100)}%`
                      : `Export ${clipLength}s from here`}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

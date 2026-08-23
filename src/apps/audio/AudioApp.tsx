import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { setWindowTitle } from '../../kernel/windows';
import { notify, notifyError } from '../../kernel/notifications';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, categoryOf, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { decodeToMono16k, formatTimestamp, waveformPeaks } from '../../services/audio/waveform';
import { ContextMenu, keepsNativeMenu, useContextMenu } from '../../shell/ContextMenu';
import { Icon } from '../../shell/Icon';
import { nodeMenuItems } from '../../shell/nodeMenu';
import styles from './AudioApp.module.css';

/**
 * Audio.
 *
 * Play a recording, see its waveform, record a new one from the microphone.
 *
 * It used to transcribe too, on a 69 MB speech model fetched on first use. The project stopped
 * requiring downloads of anyone, so that went; the waveform stayed, because drawing one needs
 * nothing but the Web Audio API the browser already has.
 *
 * There is no bundled sample: speech cannot be synthesised without a voice model, and a silent
 * test tone would demonstrate nothing. Recording from the microphone is offered instead, which is
 * a better demonstration anyway — say something and watch it come back as text.
 */

interface AudioArgs {
  fileId?: string;
}

export default function AudioApp({ windowId, args }: AppProps) {
  const initial = (args as AudioArgs | undefined) ?? {};
  const [clips, setClips] = useState<VfsNode[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initial.fileId ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const load = useCallback(async () => {
    const nodes = await vfs.allNodes();
    setClips(
      nodes
        .filter((node) => node.kind === 'file' && !node.trashed && categoryOf(node) === 'audio')
        .sort((a, b) => b.modifiedAt - a.modifiedAt),
    );
  }, []);

  useEffect(() => {
    void load();
    return vfs.onChange(() => void load());
  }, [load]);

  const activeNode = clips.find((clip) => clip.id === activeId) ?? null;
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  useEffect(() => {
    setWindowTitle(windowId, activeNode ? `${activeNode.name} — Audio` : 'Audio');
  }, [windowId, activeNode]);

  /* Load the selected clip: object URL for playback, decoded samples for the waveform. */
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    setPeaks(null);

    void (async () => {
      try {
        const { data, node } = await vfs.read(activeId);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([data], { type: node.mime }));
        setUrl(objectUrl);

        // Decoding for the waveform is the same work transcription would do, so it doubles as a
        // check that the file is playable at all before the model is ever loaded.
        const decoded = await decodeToMono16k(data);
        if (cancelled) return;
        setPeaks(waveformPeaks(decoded.samples));
        setDuration(decoded.duration);
      } catch (error) {
        if (!cancelled) notifyError('Could not open that audio', error);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeId]);

  const seek = useCallback((seconds: number) => {
    const element = audioRef.current;
    if (!element) return;
    element.currentTime = seconds;
    setPosition(seconds);
    void element.play();
    setPlaying(true);
  }, []);

  const togglePlay = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play();
      setPlaying(true);
    } else {
      element.pause();
      setPlaying(false);
    }
  }, []);

  /* Recording: the substitute for a bundled speech sample. */
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
      recorder.addEventListener('stop', async () => {
        // Release the microphone as soon as recording ends, not when the window closes.
        for (const track of stream.getTracks()) track.stop();
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });

        const folder =
          (await vfs.list(ROOT_ID)).find(
            (node) => node.kind === 'directory' && node.name === 'Recordings',
          ) ?? (await vfs.createDirectory(ROOT_ID, 'Recordings'));

        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
        const node = await vfs.writeFile({
          parentId: folder.id,
          name: `Recording ${stamp}.webm`,
          data: await blob.arrayBuffer(),
          mime: blob.type,
        });
        setActiveId(node.id);
        notify({ title: 'Recording saved', body: node.name, level: 'success' });
      });

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (error) {
      notifyError('Could not start recording', error);
    }
  }, []);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, []);

  const canRecord =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  return (
    <div
      className={styles.app}
      onContextMenu={(event) => {
        if (!activeNode || keepsNativeMenu(event)) return;
        openMenu(event, nodeMenuItems(activeNode, { omitOpen: true }));
      }}
    >
      {menu ? <ContextMenu request={menu} onClose={closeMenu} /> : null}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span>Audio</span>
          {canRecord ? (
            <button
              type="button"
              className={`${styles.recordButton} ${recording ? styles.recordingActive : ''}`}
              onClick={() => (recording ? stopRecording() : void startRecording())}
              title={recording ? 'Stop recording' : 'Record from the microphone'}
            >
              <span className={styles.recordDot} />
              {recording ? 'Stop' : 'Record'}
            </button>
          ) : null}
        </div>

        <ul className={styles.list}>
          {clips.map((clip) => (
            <li key={clip.id}>
              <button
                type="button"
                className={`${styles.listItem} ${clip.id === activeId ? styles.listItemActive : ''}`}
                onClick={() => setActiveId(clip.id)}
              >
                <Icon name="music" size={14} />
                <span className={styles.listName}>{clip.name}</span>
              </button>
            </li>
          ))}
          {clips.length === 0 ? (
            <li className={styles.listEmpty}>
              No audio yet. Record something, or drop a file into Files.
            </li>
          ) : null}
        </ul>
      </aside>

      <main className={styles.main}>
        {!activeNode ? (
          <div className={styles.placeholder}>
            <Icon name="music" size={28} />
            <p>Select a recording, or make one.</p>
            <p className={styles.placeholderHint}>
              Nothing is bundled here: a speech sample cannot be generated without a voice model, so
              this app offers recording and import instead of shipping one.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.player}>
              <button
                type="button"
                className={styles.play}
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                <Icon name={playing ? 'minimize' : 'chevron-right'} size={18} />
              </button>

              <Waveform
                peaks={peaks}
                progress={duration > 0 ? position / duration : 0}
                onSeek={(fraction) => seek(fraction * duration)}
              />

              <span className={styles.time}>
                {formatTimestamp(position)} / {formatTimestamp(duration)}
              </span>
            </div>

            <audio
              ref={audioRef}
              src={url ?? undefined}
              onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
              onEnded={() => setPlaying(false)}
              onLoadedMetadata={(event) => {
                if (Number.isFinite(event.currentTarget.duration)) {
                  setDuration(event.currentTarget.duration);
                }
              }}
              hidden
            />

            <div className={styles.actions}>
              <span className={styles.meta}>
                {activeNode.mime} · {formatBytes(activeNode.size)}
              </span>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** A canvas waveform: cheaper than hundreds of DOM elements and it scales with the window. */
function Waveform({
  peaks,
  progress,
  onSeek,
}: {
  peaks: Float32Array | null;
  progress: number;
  onSeek: (fraction: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const width = canvas.clientWidth * ratio;
    const height = canvas.clientHeight * ratio;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return;

    const styles_ = getComputedStyle(canvas);
    const played = styles_.getPropertyValue('--wave-played').trim() || '#5eead4';
    const remaining = styles_.getPropertyValue('--wave-remaining').trim() || '#475569';

    context.clearRect(0, 0, width, height);
    const barWidth = width / peaks.length;
    const middle = height / 2;

    for (let i = 0; i < peaks.length; i++) {
      const amplitude = Math.max(0.02, peaks[i] ?? 0) * middle * 0.95;
      context.fillStyle = i / peaks.length <= progress ? played : remaining;
      context.fillRect(i * barWidth, middle - amplitude, Math.max(1, barWidth - 1), amplitude * 2);
    }
  }, [peaks, progress]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.waveform}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
      }}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.02));
        if (event.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.02));
      }}
    />
  );
}

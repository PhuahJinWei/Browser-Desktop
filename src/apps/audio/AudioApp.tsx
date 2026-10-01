import { useCallback, useEffect, useRef, useState } from 'react';
import { launchApp, type AppProps } from '../../kernel/apps';
import { notify, notifyError } from '../../kernel/notifications';
import { useSetting } from '../../kernel/settings';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, categoryOf, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { closeWindow, setWindowTitle } from '../../kernel/windows';
import { decodeToMono16k, formatTimestamp, waveformPeaks } from '../../services/audio/waveform';
import { ContextMenu, keepsNativeMenu, separator, useContextMenu } from '../../shell/ContextMenu';
import { OpenDialog } from '../../shell/Dialog';
import { MediaGlyph } from '../../shell/MediaGlyph';
import { MenuBar, type MenuBarMenu } from '../../shell/MenuBar';
import { nodeMenuItems } from '../../shell/nodeMenu';
import { AppIcon } from '../../shell/PixelIcon';
import styles from './AudioApp.module.css';

/**
 * Sound Recorder: play a recording, record a new one from the microphone.
 *
 * Its shape follows the skin, because the two desktops' recorders are different programs. Classic
 * is the 1990s one: a small fixed window with Position and Length either side of a green trace on
 * black, a slider, and five buttons — to start, to end, play, stop, record — with File ▸ Open for
 * choosing a recording. Modern is the current one: recordings listed down the side, the selected
 * one's waveform large, and a round red button to record.
 *
 * It used to transcribe too, on a 69 MB speech model fetched on first use. The project stopped
 * requiring downloads of anyone, so that went; the waveform stayed, because drawing one needs
 * nothing but the Web Audio API the browser already has.
 *
 * There is no bundled sample: speech cannot be synthesised without a voice model, and a silent test
 * tone would demonstrate nothing. Recording from the microphone is the demonstration instead.
 */

interface AudioArgs {
  fileId?: string;
}

const isAudio = (node: VfsNode) => categoryOf(node) === 'audio';

export default function AudioApp({ windowId, args }: AppProps) {
  const initial = (args as AudioArgs | undefined) ?? {};
  const classic = useSetting('skin') === 'classic';
  const [clips, setClips] = useState<VfsNode[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initial.fileId ?? null);
  const [activeNode, setActiveNode] = useState<VfsNode | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [samples, setSamples] = useState<Float32Array | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState<{ started: number; analyser: AnalyserNode } | null>(
    null,
  );
  const [elapsed, setElapsed] = useState(0);
  const [openDialog, setOpenDialog] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  /* The recordings, for the modern list. Classic opens one at a time through File ▸ Open. */
  const loadList = useCallback(async () => {
    const nodes = await vfs.allNodes();
    setClips(
      nodes
        .filter((node) => node.kind === 'file' && !node.trashed && isAudio(node))
        .sort((a, b) => b.modifiedAt - a.modifiedAt),
    );
  }, []);

  useEffect(() => {
    void loadList();
    return vfs.onChange(() => void loadList());
  }, [loadList]);

  useEffect(() => {
    const name = activeNode?.name ?? (classic ? 'Untitled' : null);
    const app = classic ? 'Sound Recorder' : 'Audio';
    setWindowTitle(windowId, name ? `${name} — ${app}` : app);
  }, [windowId, activeNode, classic]);

  /* Load the selected clip: an object URL to play, and decoded samples to draw. */
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setPeaks(null);
    setSamples(null);
    setPosition(0);
    setPlaying(false);

    void (async () => {
      try {
        const { data, node } = await vfs.read(activeId);
        if (cancelled) return;
        setActiveNode(node);
        objectUrl = URL.createObjectURL(new Blob([data], { type: node.mime }));
        setUrl(objectUrl);
        const decoded = await decodeToMono16k(data);
        if (cancelled) return;
        setSamples(decoded.samples);
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

  /* Transport -------------------------------------------------------------------------------- */

  const seek = useCallback((seconds: number) => {
    const element = audioRef.current;
    if (!element) return;
    element.currentTime = seconds;
    setPosition(seconds);
  }, []);

  const play = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;
    // Played to the end, play starts again from the top, as both recorders do.
    if (element.ended || element.currentTime >= element.duration - 0.05) element.currentTime = 0;
    void element.play();
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    pause();
  }, [pause]);

  /* Recording -------------------------------------------------------------------------------- */

  const startRecording = useCallback(async () => {
    pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      // A live trace while recording: the classic scope draws the microphone, as the original did.
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);

      recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
      recorder.addEventListener('stop', async () => {
        // Release the microphone as soon as recording ends, not when the window closes.
        for (const track of stream.getTracks()) track.stop();
        void context.close();
        recorderRef.current = null;
        setRecording(null);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        try {
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
        } catch (error) {
          notifyError('Could not save the recording', error);
        }
      });

      recorder.start();
      recorderRef.current = recorder;
      setElapsed(0);
      setRecording({ started: performance.now(), analyser });
    } catch (error) {
      notifyError('Could not start recording', error);
    }
  }, [pause]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () => setElapsed((performance.now() - recording.started) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, [recording]);

  // Closing the window mid-recording still keeps what was recorded.
  useEffect(() => () => recorderRef.current?.stop(), []);

  const canRecord =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  const audio = (
    <audio
      ref={audioRef}
      src={url ?? undefined}
      onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
      onEnded={() => setPlaying(false)}
      onLoadedMetadata={(event) => {
        if (Number.isFinite(event.currentTarget.duration))
          setDuration(event.currentTarget.duration);
      }}
      hidden
    />
  );

  const openDialogElement = openDialog ? (
    <OpenDialog
      accepts={isAudio}
      icon="music"
      label="Recordings and audio files"
      empty="No audio yet. Record something, or drop a file into Files."
      onOpen={(id) => {
        setOpenDialog(false);
        setActiveId(id);
      }}
      onCancel={() => setOpenDialog(false)}
    />
  ) : null;

  /* Classic: the 1990s Sound Recorder ------------------------------------------------------- */

  if (classic) {
    const menus: MenuBarMenu[] = [
      {
        id: 'file',
        label: 'File',
        items: () => [
          { id: 'file.open', label: 'Open…', run: () => setOpenDialog(true) },
          {
            id: 'file.reveal',
            label: 'Show in Files',
            disabled: !activeNode?.parentId,
            run: () => {
              if (!activeNode?.parentId) return;
              launchApp('files', {
                args: { directoryId: activeNode.parentId, selectId: activeNode.id },
                title: 'Files',
              });
            },
          },
          separator('file.s1'),
          { id: 'file.exit', label: 'Exit', run: () => closeWindow(windowId) },
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
    const shown = recording ? elapsed : position;

    return (
      <div className={styles.classic}>
        <MenuBar menus={menus} label="Sound Recorder" />
        <div className={styles.recorder}>
          <div className={styles.scopeRow}>
            <div className={styles.readout}>
              <span>Position:</span>
              <span>{shown.toFixed(2)} sec.</span>
            </div>
            <Scope
              samples={samples}
              duration={duration}
              audioRef={audioRef}
              analyser={recording?.analyser ?? null}
              running={playing || recording !== null}
            />
            <div className={`${styles.readout} ${styles.readoutRight}`}>
              <span>Length:</span>
              <span>{(recording ? elapsed : duration).toFixed(2)} sec.</span>
            </div>
          </div>

          <input
            type="range"
            className={styles.slider}
            min={0}
            max={duration || 1}
            step={0.01}
            value={recording ? 0 : position}
            disabled={!url || recording !== null}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Position"
          />

          <div className={styles.transport} role="toolbar" aria-label="Sound Recorder">
            <button
              type="button"
              aria-label="Seek to start"
              title="Seek to Start"
              disabled={!url || recording !== null}
              onClick={() => seek(0)}
            >
              <MediaGlyph name="start" size={14} />
            </button>
            <button
              type="button"
              aria-label="Seek to end"
              title="Seek to End"
              disabled={!url || recording !== null}
              onClick={() => seek(duration)}
            >
              <MediaGlyph name="end" size={14} />
            </button>
            <button
              type="button"
              aria-label="Play"
              title="Play"
              disabled={!url || playing || recording !== null}
              onClick={play}
            >
              <MediaGlyph name="play" size={14} />
            </button>
            <button
              type="button"
              aria-label="Stop"
              title="Stop"
              disabled={!playing && recording === null}
              onClick={stop}
            >
              <MediaGlyph name="stop" size={12} />
            </button>
            <button
              type="button"
              aria-label="Record"
              title={canRecord ? 'Record' : 'This browser cannot record'}
              disabled={!canRecord || recording !== null}
              onClick={() => void startRecording()}
            >
              <MediaGlyph name="record" size={14} />
            </button>
          </div>
        </div>
        {audio}
        {openDialogElement}
      </div>
    );
  }

  /* Modern: the current Sound Recorder ------------------------------------------------------- */

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
        <div className={styles.sidebarHeader}>Recordings</div>
        <ul className={styles.list}>
          {clips.map((clip) => (
            <li key={clip.id}>
              <button
                type="button"
                className={`${styles.listItem} ${clip.id === activeId ? styles.listItemActive : ''}`}
                onClick={() => setActiveId(clip.id)}
              >
                <span className={styles.listName}>{clip.name.replace(/\.[^.]+$/, '')}</span>
                <span className={styles.listMeta}>
                  {new Date(clip.modifiedAt).toLocaleDateString()} · {formatBytes(clip.size)}
                </span>
              </button>
            </li>
          ))}
          {clips.length === 0 ? (
            <li className={styles.listEmpty}>
              No recordings yet. Press the red button to make one, or drop a file into Files.
            </li>
          ) : null}
        </ul>
        {/* The current recorder's one big control: a round red button at the foot of the list. */}
        <div className={styles.recordDock}>
          {recording ? (
            <span className={styles.recordTimer}>{formatTimestamp(elapsed)}</span>
          ) : null}
          <button
            type="button"
            className={`${styles.recordButton} ${recording ? styles.recordButtonActive : ''}`}
            disabled={!canRecord}
            onClick={() => (recording ? stop() : void startRecording())}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            title={
              !canRecord
                ? 'This browser cannot record'
                : recording
                  ? 'Stop recording'
                  : 'Start recording'
            }
          >
            <span className={styles.recordGlyph} />
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        {recording ? (
          <div className={styles.placeholder}>
            <p className={styles.bigTimer}>{formatTimestamp(elapsed)}</p>
            <p>Recording from the microphone…</p>
          </div>
        ) : !activeNode ? (
          <div className={styles.placeholder}>
            <AppIcon name="music" size={48} />
            <p>Select a recording, or make one.</p>
          </div>
        ) : (
          <div className={styles.player}>
            <h2 className={styles.title}>{activeNode.name.replace(/\.[^.]+$/, '')}</h2>
            <p className={styles.meta}>
              {new Date(activeNode.modifiedAt).toLocaleString()} · {formatBytes(activeNode.size)}
            </p>

            <Waveform
              peaks={peaks}
              progress={duration > 0 ? position / duration : 0}
              onSeek={(fraction) => seek(fraction * duration)}
            />

            <div className={styles.times}>
              <span>{formatTimestamp(position)}</span>
              <span>{formatTimestamp(duration)}</span>
            </div>

            <div className={styles.controls}>
              <button
                type="button"
                className={styles.skip}
                aria-label="Back 10 seconds"
                title="Back 10 seconds"
                onClick={() => seek(Math.max(0, position - 10))}
              >
                <MediaGlyph name="back" size={14} />
              </button>
              <button
                type="button"
                className={styles.play}
                onClick={playing ? pause : play}
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause' : 'Play'}
              >
                <MediaGlyph name={playing ? 'pause' : 'play'} size={18} />
              </button>
              <button
                type="button"
                className={styles.skip}
                aria-label="Forward 10 seconds"
                title="Forward 10 seconds"
                onClick={() => seek(Math.min(duration, position + 10))}
              >
                <MediaGlyph name="forward" size={14} />
              </button>
            </div>
          </div>
        )}
      </main>
      {audio}
    </div>
  );
}

/**
 * The classic recorder's trace: a green line on black, of the sound around the playhead — or of the
 * microphone while recording — redrawn every frame while anything is moving.
 */
function Scope({
  samples,
  duration,
  audioRef,
  analyser,
  running,
}: {
  samples: Float32Array | null;
  duration: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  analyser: AnalyserNode | null;
  running: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const width = canvas.width;
    const height = canvas.height;
    const live = analyser ? new Float32Array(analyser.fftSize) : null;
    let frame = 0;

    const draw = () => {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = '#00ff00';
      context.lineWidth = 1;
      context.beginPath();

      let values: ArrayLike<number> | null = null;
      if (analyser && live) {
        analyser.getFloatTimeDomainData(live);
        values = live;
      } else if (samples && duration > 0) {
        // The 50 ms of sound under the playhead, the window the original scope showed.
        const at = Math.floor(((audioRef.current?.currentTime ?? 0) / duration) * samples.length);
        values = samples.subarray(Math.max(0, at - 400), Math.min(samples.length, at + 400));
      }

      for (let x = 0; x < width; x++) {
        const value =
          values && values.length > 0 ? (values[Math.floor((x / width) * values.length)] ?? 0) : 0;
        const y = Math.round(height / 2 - value * (height / 2 - 2)) + 0.5;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      if (running) frame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(frame);
  }, [samples, duration, audioRef, analyser, running]);

  return <canvas ref={canvasRef} className={styles.scope} width={128} height={44} aria-hidden />;
}

/** The modern waveform: a canvas of bars, cheaper than hundreds of elements and it scales. */
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

    const computed = getComputedStyle(canvas);
    const played = computed.getPropertyValue('--wave-played').trim() || '#005fb8';
    const remaining = computed.getPropertyValue('--wave-remaining').trim() || '#b9c3cf';

    context.clearRect(0, 0, width, height);
    const step = width / peaks.length;
    const bar = Math.max(1, step * 0.6);
    const middle = height / 2;

    for (let i = 0; i < peaks.length; i++) {
      const amplitude = Math.max(0.03, peaks[i] ?? 0) * middle * 0.95;
      context.fillStyle = i / peaks.length <= progress ? played : remaining;
      context.fillRect(i * step, middle - amplitude, bar, amplitude * 2);
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

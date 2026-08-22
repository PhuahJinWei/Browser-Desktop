import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { vfs } from '../../kernel/vfs/client';
import { ROOT_ID, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { notify, notifyError } from '../../kernel/notifications';
import { enableVision, useIndexerState } from '../../services/index/client';
import { formatTime } from '../../services/index/moments';
import { thumbnailUrl } from '../../services/index/thumbnails';
import { momentId } from '../../services/index/moments';
import {
  SAMPLE_INTERVAL,
  canExportClips,
  forgetVideo,
  indexVideo,
  listVideos,
  refreshIndexedVideos,
  saveClip,
  saveFrame,
  searchMoments,
  useVideoIndexState,
  type Moment,
} from '../../services/video/client';
import {
  SAMPLE_QUERIES,
  SAMPLE_VIDEO_SECONDS,
  isSampleVideoSupported,
  recordSampleVideo,
} from '../../shell/sampleVideo';
import { Icon } from '../../shell/Icon';
import styles from './VideoApp.module.css';

/**
 * Video.
 *
 * The question this answers is the one that has no good answer anywhere else: *where in this video
 * is the thing I remember?* Filenames do not know, timestamps do not know, and scrubbing is how
 * people currently find out.
 *
 * Every couple of seconds of the video is a frame in the same vector space as the words you type,
 * so the answer is a jump to a timestamp. Runs of matching frames are collapsed into moments with
 * a beginning and an end — which is also what makes the section exportable rather than just
 * findable.
 */

export default function VideoApp({ args }: AppProps) {
  const initial = (args as { fileId?: string } | undefined) ?? {};
  const [videos, setVideos] = useState<VfsNode[]>([]);
  const [selected, setSelected] = useState<string | null>(initial.fileId ?? null);
  const [query, setQuery] = useState('');
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [scopeToSelected, setScopeToSelected] = useState(false);
  const [recording, setRecording] = useState<{ fraction: number; subject: string } | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [active, setActive] = useState<Moment | null>(null);

  const indexer = useIndexerState();
  const videoState = useVideoIndexState();
  const recordCanvas = useRef<HTMLCanvasElement | null>(null);

  const load = useCallback(async () => {
    const found = await listVideos();
    setVideos(found);
    setSelected((current) => current ?? found[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
    return vfs.onChange(() => void load());
  }, [load]);

  // Asked again whenever the index reports a different size: at first paint the worker may still
  // be restoring its snapshot, and answering "nothing is searchable" then would be wrong.
  const indexedImageCount = indexer.stats?.images ?? 0;
  useEffect(() => {
    void refreshIndexedVideos();
  }, [indexedImageCount]);

  const selectedNode = videos.find((node) => node.id === selected) ?? null;
  const indexedIds = useMemo(() => new Set(videoState.indexed), [videoState.indexed]);

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setMoments(null);
        return;
      }
      setSearching(true);
      const started = performance.now();
      try {
        const results = await searchMoments(
          trimmed,
          12,
          scopeToSelected && selected ? selected : undefined,
        );
        setMoments(results);
        setElapsed(Math.round(performance.now() - started));
      } catch (error) {
        notifyError('Video search failed', error);
      } finally {
        setSearching(false);
      }
    },
    [scopeToSelected, selected],
  );

  useEffect(() => {
    if (!indexer.visionEnabled) return;
    const timer = setTimeout(() => void runSearch(query), 280);
    return () => clearTimeout(timer);
  }, [query, runSearch, indexer.visionEnabled]);

  /* Making the sample video ------------------------------------------------------------------ */

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
        body: `${formatBytes(node.size)}, drawn and encoded on this device. Index it to search inside it.`,
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

  /* Playback --------------------------------------------------------------------------------- */

  const player = useRef<HTMLVideoElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedNode) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setUnreadable(null);
    void (async () => {
      try {
        const { data } = await vfs.read(selectedNode.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([data], { type: selectedNode.mime }));
        setUrl(objectUrl);
      } catch (error) {
        // A file the desktop lists but cannot open is a state worth showing on the stage. Left
        // unhandled it was an unhandled rejection and an empty black rectangle.
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

  /** Jumps to a moment, in whichever video it belongs to, and plays just that section. */
  const playMoment = useCallback(
    async (moment: Moment) => {
      setActive(moment);
      if (moment.sourceId !== selected) {
        setSelected(moment.sourceId);
        // The player reloads; the pending start time is applied once it can seek.
        pending.current = moment;
        return;
      }
      const element = player.current;
      if (!element) return;
      element.currentTime = moment.start;
      stopAt.current = moment.end;
      await element.play().catch(() => undefined);
    },
    [selected],
  );

  const pending = useRef<Moment | null>(null);

  const onLoaded = useCallback(() => {
    const moment = pending.current;
    const element = player.current;
    if (!moment || !element) return;
    pending.current = null;
    element.currentTime = moment.start;
    stopAt.current = moment.end;
    void element.play().catch(() => undefined);
  }, []);

  const onTimeUpdate = useCallback(() => {
    const element = player.current;
    if (!element || stopAt.current === null) return;
    if (element.currentTime >= stopAt.current) {
      element.pause();
      stopAt.current = null;
    }
  }, []);

  /* Exports ---------------------------------------------------------------------------------- */

  const doSaveFrame = useCallback(
    async (moment: Moment) => {
      const node = videos.find((candidate) => candidate.id === moment.sourceId);
      if (!node) return;
      const saved = await saveFrame(node, moment.bestTime).catch((error: unknown) => {
        notifyError('Could not save that frame', error);
        return null;
      });
      if (saved) {
        notify({ title: `Saved ${saved.name}`, level: 'success' });
      }
    },
    [videos],
  );

  const doSaveClip = useCallback(
    async (moment: Moment) => {
      const node = videos.find((candidate) => candidate.id === moment.sourceId);
      if (!node) return;
      setExporting(0);
      try {
        const saved = await saveClip(node, moment.start, moment.end, setExporting);
        if (saved) notify({ title: `Saved ${saved.name}`, level: 'success' });
      } catch (error) {
        notifyError('Could not export that clip', error);
      } finally {
        setExporting(null);
      }
    },
    [videos],
  );

  const busy = videoState.working.length > 0;

  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Icon name="search" size={15} />
          <input
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              indexer.visionEnabled
                ? 'Describe a moment — “a red keyboard”…'
                : 'Video search needs the image model'
            }
            disabled={!indexer.visionEnabled}
            aria-label="Search video moments by description"
            type="search"
          />
          {searching ? <span className={styles.spinner} aria-label="Searching" /> : null}
        </div>

        {selectedNode ? (
          <label className={styles.scope}>
            <input
              type="checkbox"
              checked={scopeToSelected}
              onChange={(event) => setScopeToSelected(event.target.checked)}
            />
            This video only
          </label>
        ) : null}

        <span className={styles.count}>
          {moments === null
            ? `${videos.length} video${videos.length === 1 ? '' : 's'}`
            : `${moments.length} moment${moments.length === 1 ? '' : 's'}${
                elapsed !== null ? ` · ${elapsed} ms` : ''
              }`}
        </span>
      </div>

      {!indexer.visionEnabled ? (
        <div className={styles.banner}>
          <Icon name="sparkle" size={16} />
          <div className={styles.bannerBody}>
            <p className={styles.bannerTitle}>Search inside videos by describing what you saw</p>
            <p className={styles.bannerText}>
              Uses the same image model as Photos — one download, on this device. Frames are sampled
              every {SAMPLE_INTERVAL} seconds and matched against your words.
            </p>
          </div>
          <button
            type="button"
            className={styles.enable}
            disabled={indexer.visionLoading}
            onClick={() => void enableVision()}
          >
            {indexer.visionLoading ? (indexer.modelProgress ?? 'Loading…') : 'Enable video search'}
          </button>
        </div>
      ) : null}

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
              {videos.map((node) => {
                const isIndexed = indexedIds.has(node.id);
                const progress = videoState.progress[node.id];
                return (
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
                      <span className={styles.videoMeta}>
                        {formatBytes(node.size)}
                        {isIndexed ? ' · searchable' : ''}
                      </span>
                      {progress !== undefined ? (
                        <span className={styles.progressTrack}>
                          <span
                            className={styles.progressFill}
                            style={{ width: `${Math.round(progress * 100)}%` }}
                          />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selectedNode ? (
            <div className={styles.sidebarActions}>
              <button
                type="button"
                className={styles.action}
                disabled={!indexer.visionEnabled || busy}
                onClick={() => void indexVideo(selectedNode)}
              >
                <Icon name="sparkle" size={13} />
                {indexedIds.has(selectedNode.id) ? 'Re-index' : 'Index this video'}
              </button>
              {indexedIds.has(selectedNode.id) ? (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => void forgetVideo(selectedNode.id)}
                >
                  <Icon name="trash" size={13} /> Forget
                </button>
              ) : null}
            </div>
          ) : null}
        </aside>

        <main className={styles.main}>
          <div className={styles.stage}>
            {/*
              Always mounted, hidden until it is recording. Rendering it only while `recording` is
              set looked equivalent and was not: the ref is populated on commit, which happens
              after the recorder has already been handed a canvas, so the visible one stayed black
              while an invisible one was filmed.
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
                onLoadedMetadata={onLoaded}
                onTimeUpdate={onTimeUpdate}
              />
            ) : unreadable ? (
              <p className={styles.stageEmpty}>{unreadable}</p>
            ) : (
              <p className={styles.stageEmpty}>Select a video, or make the sample one.</p>
            )}
          </div>

          {active ? (
            <div className={styles.activeBar}>
              <span className={styles.activeRange}>
                {formatTime(active.start)} – {formatTime(active.end)}
              </span>
              <span className={styles.activeName}>{active.name}</span>
              <button
                type="button"
                className={styles.small}
                onClick={() => void doSaveFrame(active)}
              >
                <Icon name="image" size={12} /> Save frame
              </button>
              {canExportClips() ? (
                <button
                  type="button"
                  className={styles.small}
                  disabled={exporting !== null}
                  onClick={() => void doSaveClip(active)}
                  title="Re-encodes in real time, so a ten-second section takes ten seconds"
                >
                  <Icon name="download" size={12} />
                  {exporting !== null
                    ? `Exporting ${Math.round(exporting * 100)}%`
                    : `Export ${Math.round(active.end - active.start)}s clip`}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={styles.results}>
            {moments === null ? (
              indexer.visionEnabled ? (
                <div className={styles.hint}>
                  <p>
                    Index a video, then describe something you remember seeing in it.
                    {indexedIds.size === 0 ? '' : ' Try:'}
                  </p>
                  {indexedIds.size > 0 ? (
                    <div className={styles.examples}>
                      {SAMPLE_QUERIES.map((example) => (
                        <button
                          key={example}
                          type="button"
                          className={styles.example}
                          onClick={() => setQuery(example)}
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null
            ) : moments.length === 0 ? (
              <p className={styles.hint}>
                {indexedIds.size === 0
                  ? 'No video has been indexed yet — index one first.'
                  : 'Nothing in the indexed videos matches that.'}
              </p>
            ) : (
              <ul className={styles.momentList}>
                {moments.map((moment) => (
                  <MomentCard
                    key={`${moment.sourceId}@${moment.start}`}
                    moment={moment}
                    active={active?.sourceId === moment.sourceId && active.start === moment.start}
                    onPlay={() => void playMoment(moment)}
                  />
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** One result: the best frame in the run, the range it covers, and how sure the model was. */
function MomentCard({
  moment,
  active,
  onPlay,
}: {
  moment: Moment;
  active: boolean;
  onPlay: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const thumb = await thumbnailUrl(momentId(moment.sourceId, moment.bestTime));
      if (!cancelled) setUrl(thumb);
    })();
    return () => {
      cancelled = true;
    };
  }, [moment.sourceId, moment.bestTime]);

  return (
    <li>
      <button
        type="button"
        className={`${styles.moment} ${active ? styles.momentActive : ''}`}
        onClick={onPlay}
      >
        {url ? (
          <img className={styles.momentImage} src={url} alt="" loading="lazy" />
        ) : (
          <span className={styles.momentPlaceholder} />
        )}
        <span className={styles.momentTime}>
          {formatTime(moment.start)} – {formatTime(moment.end)}
        </span>
        <span className={styles.momentName}>{moment.name}</span>
        <span className={styles.momentScore}>
          {Math.round(moment.score * 100)}
          <span className={styles.momentFrames}>
            {moment.frames} frame{moment.frames === 1 ? '' : 's'}
          </span>
        </span>
      </button>
    </li>
  );
}

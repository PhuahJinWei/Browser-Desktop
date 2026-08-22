import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../../kernel/apps';
import { setWindowTitle } from '../../kernel/windows';
import { vfs } from '../../kernel/vfs/client';
import { categoryOf, formatBytes, type VfsNode } from '../../kernel/vfs/types';
import { Icon } from '../../shell/Icon';
import { readImage, useOcrState, type OcrResult } from '../../services/ocr/client';
import { renderMarkdown } from './markdown';
import styles from './ViewerApp.module.css';

/**
 * Viewer.
 *
 * Opens text, Markdown, images and PDFs. Its other job is to be the destination of a search hit:
 * given a character offset it scrolls there and marks the passage, which is what turns a result
 * list into something you can actually follow.
 */

interface ViewerArgs {
  fileId?: string;
  /** Character range to reveal and mark, from a search result. */
  highlight?: { start: number; end: number };
}

export default function ViewerApp({ windowId, args }: AppProps) {
  const { fileId, highlight } = (args as ViewerArgs | undefined) ?? {};
  const [node, setNode] = useState<VfsNode | null>(null);
  const [content, setContent] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fileId) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const file = await vfs.read(fileId);
        if (cancelled) return;
        setNode(file.node);
        setContent(file.data);
        setWindowTitle(windowId, file.node.name);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileId, windowId]);

  if (loading) return <div className={styles.state}>Opening…</div>;
  if (error) {
    return (
      <div className={styles.state}>
        <Icon name="alert" size={24} />
        <p>{error}</p>
      </div>
    );
  }
  if (!node || !content) {
    return (
      <div className={styles.state}>
        <Icon name="file" size={24} />
        <p>Nothing to show. Open a file from Files or Search.</p>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <div className={styles.bar}>
        <span className={styles.name}>{node.name}</span>
        <span className={styles.meta}>
          {node.mime || 'unknown type'} · {formatBytes(node.size)}
        </span>
      </div>
      <div className={styles.content}>
        <Body node={node} data={content} highlight={highlight ?? null} />
      </div>
    </div>
  );
}

function Body({
  node,
  data,
  highlight,
}: {
  node: VfsNode;
  data: ArrayBuffer;
  highlight: { start: number; end: number } | null;
}) {
  const category = categoryOf(node);

  if (category === 'image') return <ImageView node={node} data={data} />;
  if (node.mime === 'application/pdf') return <PdfView data={data} />;
  if (category === 'audio' || category === 'video') return <MediaView node={node} data={data} />;
  if (category === 'text') return <TextView node={node} data={data} highlight={highlight} />;

  return (
    <div className={styles.state}>
      <Icon name="file" size={24} />
      <p>No viewer for {node.mime || 'this file type'} yet.</p>
      <p className={styles.hint}>Images, text, Markdown and PDFs open here today.</p>
    </div>
  );
}

/** Object URLs must be revoked, or every file opened leaks its bytes for the session. */
function useObjectUrl(data: ArrayBuffer, mime: string): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([data], { type: mime }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data, mime]);
  return url;
}

/**
 * A picture, with the option of reading the words in it.
 *
 * The recognised text is shown beside the page rather than replacing it, because the useful thing
 * is checking one against the other — and because the model is fallible enough that hiding the
 * original would be dishonest. It also goes into the search index, which is the part that matters:
 * a scanned page nobody reads is still findable afterwards.
 */
function ImageView({ node, data }: { node: VfsNode; data: ArrayBuffer }) {
  const url = useObjectUrl(data, node.mime);
  const ocr = useOcrState();
  const [result, setResult] = useState<OcrResult | null>(null);
  const busy = ocr.working.includes(node.id);

  // A different file means a different answer.
  useEffect(() => setResult(null), [node.id]);

  const read = (force: boolean) => {
    void readImage(node, force ? { force: true } : {}).then((value) => {
      if (value) setResult(value);
    });
  };

  return (
    <div className={styles.imageLayout}>
      <div className={styles.imageWrap}>
        {url ? <img src={url} alt={node.name} className={styles.image} /> : null}
      </div>

      <aside className={styles.textPane}>
        <div className={styles.textPaneHead}>
          <span>Text in this picture</span>
          <button
            type="button"
            className={styles.readButton}
            disabled={busy || ocr.loading}
            onClick={() => read(false)}
          >
            <Icon name="sparkle" size={13} />
            {busy ? 'Reading…' : ocr.loading ? (ocr.progress ?? 'Loading…') : 'Read text'}
          </button>
        </div>

        {result === null ? (
          <p className={styles.textPaneHint}>
            {busy
              ? 'Finding the lines, then reading each one.'
              : 'Runs a recognition model on this device. Best on printed, upright, single-column pages — a photograph of a sign is beyond it.'}
          </p>
        ) : result.attempted ? (
          <>
            <pre className={styles.textPaneBody}>{result.text}</pre>
            <p className={styles.textPaneNote}>
              {result.lines.length} line{result.lines.length === 1 ? '' : 's'} ·{' '}
              {(result.processingMs / 1000).toFixed(1)} s · {result.backend} · now searchable
            </p>
          </>
        ) : (
          <>
            <p className={styles.textPaneHint}>{result.skipped}</p>
            <button type="button" className={styles.readButton} onClick={() => read(true)}>
              Read it anyway
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

function MediaView({ node, data }: { node: VfsNode; data: ArrayBuffer }) {
  const url = useObjectUrl(data, node.mime);
  if (!url) return null;
  return (
    <div className={styles.mediaWrap}>
      {node.mime.startsWith('video/') ? (
        <video className={styles.media} src={url} controls />
      ) : (
        <audio className={styles.audio} src={url} controls />
      )}
      <p className={styles.hint}>
        Transcription and search inside audio arrive in M2; this is playback only.
      </p>
    </div>
  );
}

function TextView({
  node,
  data,
  highlight,
}: {
  node: VfsNode;
  data: ArrayBuffer;
  highlight: { start: number; end: number } | null;
}) {
  const text = useMemo(() => new TextDecoder().decode(data), [data]);
  const markRef = useRef<HTMLElement>(null);
  const isMarkdown = node.mime === 'text/markdown' || node.name.endsWith('.md');
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    // Wait a frame so layout has settled before scrolling to the marked passage.
    if (!highlight) return;
    const timer = setTimeout(
      () => markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      60,
    );
    return () => clearTimeout(timer);
  }, [highlight, raw]);

  // A search hit is an offset into the plain text, so highlighting means showing the plain text.
  const showSource = raw || !isMarkdown || highlight !== null;

  return (
    <div className={styles.textWrap}>
      {isMarkdown ? (
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setRaw((current) => !current)}
        >
          {showSource && raw ? 'Rendered' : 'Source'}
        </button>
      ) : null}

      {showSource ? (
        <pre className={styles.text}>
          {highlight ? (
            <>
              {text.slice(0, highlight.start)}
              <mark ref={markRef} className={styles.mark}>
                {text.slice(highlight.start, highlight.end)}
              </mark>
              {text.slice(highlight.end)}
            </>
          ) : (
            text
          )}
        </pre>
      ) : (
        <article className={styles.markdown}>{renderMarkdown(text)}</article>
      )}
    </div>
  );
}

function PdfView({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [pages, setPages] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = await import('pdfjs-dist/build/pdf.worker.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

        // The buffer is copied because pdf.js takes ownership of what it is given.
        // destroy() lives on the loading task in pdf.js 6, not on the document proxy.
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
        const document = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        setPages(document.numPages);
        const container = containerRef.current;
        if (!container) return;
        container.replaceChildren();

        // Render at device pixel ratio so text is sharp on high-density displays.
        const scale = Math.min(2, globalThis.devicePixelRatio || 1) * 1.35;
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          if (cancelled) break;
          const page = await document.getPage(pageNumber);
          const viewport = page.getViewport({ scale });
          const canvas = document_createCanvas(viewport.width, viewport.height);
          canvas.className = styles.pdfPage ?? '';
          container.append(canvas);

          const context = canvas.getContext('2d');
          if (context) await page.render({ canvas, canvasContext: context, viewport }).promise;
          page.cleanup();
        }

        if (!cancelled) setStatus('ready');
        cleanup = () => void loadingTask.destroy();
      } catch (error) {
        if (!cancelled) {
          setStatus('failed');
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [data]);

  return (
    <div className={styles.pdfWrap}>
      {status === 'loading' ? <p className={styles.hint}>Rendering PDF…</p> : null}
      {status === 'failed' ? (
        <p className={styles.hint}>Could not render this PDF: {message}</p>
      ) : null}
      {status === 'ready' && pages > 0 ? (
        <p className={styles.hint}>
          {pages} page{pages === 1 ? '' : 's'}
        </p>
      ) : null}
      <div ref={containerRef} className={styles.pdfPages} />
    </div>
  );
}

/** Small helper so the canvas creation reads clearly next to the pdf.js API. */
function document_createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(width);
  canvas.height = Math.floor(height);
  canvas.style.width = `${Math.floor((width / (Math.min(2, globalThis.devicePixelRatio || 1) * 1.35)) * 1.35)}px`;
  return canvas;
}

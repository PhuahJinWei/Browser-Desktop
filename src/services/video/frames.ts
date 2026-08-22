/**
 * Sampling frames out of a video.
 *
 * The plan called for WebCodecs. WebCodecs decodes *encoded chunks* — it does not demux, so
 * feeding it an MP4 or WebM means writing a container parser first, or shipping one. A `<video>`
 * element already contains a demuxer and a decoder, and seeking it to a timestamp and drawing to a
 * canvas gets the same pixels with none of that.
 *
 * The trade is speed: seeking is slower than decoding a stream linearly. For sampling one frame
 * every couple of seconds — which is what searching a video by content needs — the difference does
 * not matter, and it works in every browser rather than the subset with WebCodecs.
 *
 * Runs on the main thread because `<video>` is a DOM element. Each frame is handed to a worker as
 * a blob, so the expensive part (the model) stays off it.
 */

export interface SampledFrame {
  /** Seconds into the video. */
  time: number;
  blob: Blob;
  width: number;
  height: number;
}

export interface SampleOptions {
  /** Seconds between samples. */
  interval?: number;
  /** Edge of the emitted square frame; CLIP works at 224px, so more is waste. */
  maxEdge?: number;
  maxFrames?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Could not seek to ${time.toFixed(1)}s`));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}

/** Loads a video element far enough to know its duration and dimensions. */
async function openVideo(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  // Required for some browsers to allow programmatic seeking without user interaction.
  video.playsInline = true;

  // Attached, but off-screen. A detached element decodes well enough to be drawn to a canvas, but
  // `captureStream` on one is not reliably fed frames — the browser has no reason to render
  // something that is not in a document.
  video.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0';
  document.body.appendChild(video);

  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('That video could not be decoded')), {
      once: true,
    });
  });

  // A duration of Infinity means the container carries no seeking index, which is what
  // MediaRecorder produces. Seeking far past the end makes the browser scan for the real end and
  // learn the duration.
  //
  // Both seeks are awaited, and the second one — back to the start — is why. Resolving as soon as
  // the duration was known left the element parked at the end with its own 'seeked' event still
  // in flight, and the *next* seek would catch that stale event and report success without having
  // moved. Measured symptom: a frame exported from 0:13 of a 32-second video was the last frame
  // of the video, from a scene nineteen seconds later.
  if (video.duration === Infinity) {
    await seek(video, 1e6);
    await seek(video, 0);
  }

  return video;
}

function closeVideo(video: HTMLVideoElement | null): void {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

/**
 * Samples frames at a fixed interval.
 *
 * A fixed interval rather than scene detection: detecting cuts would mean decoding every frame,
 * which is the cost this whole approach exists to avoid. The interval is the resolution of the
 * search — at two seconds, a moment is findable to within about a second either way.
 */
export async function sampleFrames(
  data: ArrayBuffer,
  mime: string,
  options: SampleOptions = {},
): Promise<{ frames: SampledFrame[]; duration: number }> {
  const interval = options.interval ?? 2;
  const maxEdge = options.maxEdge ?? 384;
  const maxFrames = options.maxFrames ?? 300;

  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  let video: HTMLVideoElement | null = null;

  try {
    video = await openVideo(url);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) throw new Error('That video reports no duration');

    // Square, with the frame letterboxed inside it — not the frame's own 16:9.
    //
    // This is not cosmetic. CLIP's image processor resizes the shortest edge to 224 and then
    // centre-crops a 224x224 square, so handing it a widescreen frame throws away about 44% of
    // the width before the model ever sees it. Measured consequence: a keyboard spanning the
    // frame was cropped into an unrecognisable red band and lost to a cat's face in the middle
    // of a different scene, for the query "a red keyboard". Letterboxing first means the crop is
    // a no-op and the model sees the whole shot.
    const size = maxEdge;
    const fit = Math.min(size / video.videoWidth, size / video.videoHeight);
    const drawWidth = Math.max(1, Math.round(video.videoWidth * fit));
    const drawHeight = Math.max(1, Math.round(video.videoHeight * fit));
    const offsetX = Math.round((size - drawWidth) / 2);
    const offsetY = Math.round((size - drawHeight) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: false });
    if (!context) throw new Error('No 2D canvas context is available');

    // Offset by half an interval so the first sample is inside the first shot rather than on the
    // very first frame, which is often black.
    const times: number[] = [];
    for (let time = Math.min(interval / 2, duration / 2); time < duration; time += interval) {
      times.push(time);
      if (times.length >= maxFrames) break;
    }

    const frames: SampledFrame[] = [];
    for (const [index, time] of times.entries()) {
      if (options.signal?.aborted) break;
      await seek(video, time);
      context.fillStyle = '#000000';
      context.fillRect(0, 0, size, size);
      context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.82),
      );
      if (blob) frames.push({ time, blob, width: size, height: size });
      options.onProgress?.(index + 1, times.length);
    }

    return { frames, duration };
  } finally {
    closeVideo(video);
    URL.revokeObjectURL(url);
  }
}

/** Grabs a single frame, for exporting a still from a search result. */
export async function frameAt(
  data: ArrayBuffer,
  mime: string,
  time: number,
  maxEdge = 1280,
): Promise<Blob | null> {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  let video: HTMLVideoElement | null = null;

  try {
    video = await openVideo(url);
    const duration = Number.isFinite(video.duration) ? video.duration : time + 1;
    await seek(video, Math.max(0, Math.min(time, duration - 0.05)));

    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    closeVideo(video);
    URL.revokeObjectURL(url);
  }
}

/**
 * Exports a section of a video as its own file.
 *
 * Done by playing the section and recording the element's own stream. That is real-time — a
 * ten-second clip takes ten seconds — and it re-encodes rather than cutting losslessly.
 *
 * The lossless alternative is to demux the container, copy the keyframe-aligned range and remux
 * it, which means shipping a muxer for every container the browser can play. Re-encoding is the
 * honest trade for a feature whose point is "here is the part you were looking for", and it has
 * one real advantage: the section starts exactly where it was asked to, rather than at the
 * nearest keyframe.
 */
export interface ClipOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export function canExportClips(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLVideoElement !== 'undefined' &&
    typeof (HTMLVideoElement.prototype as { captureStream?: unknown }).captureStream === 'function'
  );
}

export async function exportClip(
  data: ArrayBuffer,
  mime: string,
  start: number,
  end: number,
  options: ClipOptions = {},
): Promise<{ blob: Blob; seconds: number } | null> {
  if (!canExportClips()) return null;

  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  let video: HTMLVideoElement | null = null;
  let recorder: MediaRecorder | null = null;

  try {
    video = await openVideo(url);
    const duration = Number.isFinite(video.duration) ? video.duration : end;
    const from = Math.max(0, Math.min(start, duration));
    const to = Math.max(from + 0.5, Math.min(end, duration));

    await seek(video, from);

    const stream = (
      video as HTMLVideoElement & { captureStream: () => MediaStream }
    ).captureStream();
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';

    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder!.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
      recorder!.onerror = () => reject(new Error('Clip recording failed'));
    });

    recorder.start(400);
    await video.play();

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (!video || options.signal?.aborted || video.currentTime >= to || video.ended) {
          resolve();
          return;
        }
        options.onProgress?.((video.currentTime - from) / (to - from));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    video.pause();
    recorder.stop();
    const blob = await finished;
    return { blob, seconds: to - from };
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    closeVideo(video);
    URL.revokeObjectURL(url);
  }
}

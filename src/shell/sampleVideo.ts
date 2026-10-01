import { SAMPLE_IMAGES } from './samplePhotos';

/**
 * The sample video.
 *
 * Drawn and encoded here, for the same reason the sample pictures are: shipping a video file would
 * mean either megabytes in the repository or a request to a third host, and the claim of this
 * project is that it talks to two hosts and keeps your files to itself.
 *
 * The scenes are the sample *pictures*, filmed. That is not laziness — it is the conclusion of a
 * measurement. A first version drew its own eight scenes, and the model ranked them almost at
 * random: "a red keyboard" scored the hand-drawn keyboard at 0.21 and a cat's face at 0.24, a
 * spread indistinguishable from noise. The same query against the sample photographs scores the
 * keyboard at 0.32 and everything else at 0.20–0.23. The drawings that retrieve well are the ones
 * already in the repository, so the video is made of those, and a video moment becomes directly
 * comparable with the photo case rather than being a second, weaker fixture.
 *
 * Square, and 512 pixels, for the same reason: CLIP's processor resizes the shortest edge to 224
 * and centre-crops, so a widescreen frame would lose about 44% of its width before the model saw
 * it. A square frame makes that crop a no-op.
 *
 * It is recorded in real time — `MediaRecorder` timestamps frames by the wall clock, so the video
 * takes its own running time to make. Rendering it faster would mean writing a WebM muxer. The
 * canvas is shown while it records, which turns the wait into the more interesting half of the
 * demonstration: the desktop draws a video, then searches it.
 */

const SIZE = 512;
const FPS = 24;
/**
 * Four, not three, because the indexer samples a frame every two seconds.
 *
 * With three-second scenes the samples land at 1, 3, 5, 7… and every other one falls exactly on a
 * cut, so half the index is frames of a transition rather than of a scene. Four seconds puts two
 * clean samples inside every scene. Real footage does not cut every few seconds; this is an
 * artefact of the fixture, and the fixture should not be the thing under test.
 */
const SECONDS_PER_SCENE = 4;

export interface VideoScene {
  /** What the scene shows, in the words someone would search for. */
  subject: string;
  seconds: number;
}

export const SAMPLE_SCENES: VideoScene[] = SAMPLE_IMAGES.map((image) => ({
  subject: image.subject,
  seconds: SECONDS_PER_SCENE,
}));

/** Total running time, so a caller can say how long it will take before starting. */
export const SAMPLE_VIDEO_SECONDS = SAMPLE_SCENES.length * SECONDS_PER_SCENE;

/** Queries the sample video should answer, for the empty state. */
export const SAMPLE_QUERIES = [
  'a red keyboard',
  'a cup of coffee',
  'the night sky',
  'a bar chart',
  'a path through trees',
];

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

export interface RecordOptions {
  /** A canvas already in the document, so the user can watch it being drawn. */
  canvas?: HTMLCanvasElement;
  onProgress?: (fraction: number, subject: string) => void;
  signal?: AbortSignal;
}

export function isSampleVideoSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

/** Records the scenes to a WebM buffer. Takes {@link SAMPLE_VIDEO_SECONDS} of wall clock. */
export async function recordSampleVideo(
  options: RecordOptions = {},
): Promise<{ name: string; mime: string; data: ArrayBuffer }> {
  if (!isSampleVideoSupported()) throw new Error('This browser cannot record a canvas');

  const canvas = options.canvas ?? document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas context is available');

  const mimeType = pickMimeType();
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 2_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    recorder.onerror = () => reject(new Error('Recording failed'));
  });

  recorder.start(500);

  const startedAt = performance.now();
  const totalMs = SAMPLE_VIDEO_SECONDS * 1000;

  try {
    await new Promise<void>((resolve) => {
      const frame = () => {
        if (options.signal?.aborted || performance.now() - startedAt >= totalMs) {
          resolve();
          return;
        }

        const elapsed = (performance.now() - startedAt) / 1000;
        const index = Math.min(SAMPLE_IMAGES.length - 1, Math.floor(elapsed / SECONDS_PER_SCENE));
        const image = SAMPLE_IMAGES[index]!;
        const within = (elapsed % SECONDS_PER_SCENE) / SECONDS_PER_SCENE;

        // A slow push-in, so it is visibly a video rather than a slideshow. Kept to 4% because the
        // point of the scene is that the model can still recognise it — zooming past the subject
        // would be measuring the zoom, not the search.
        context.save();
        context.fillStyle = '#000000';
        context.fillRect(0, 0, SIZE, SIZE);
        const scale = 1 + 0.04 * within;
        context.translate(SIZE / 2, SIZE / 2);
        context.scale(scale, scale);
        context.translate(-SIZE / 2, -SIZE / 2);
        image.draw(context, SIZE);
        context.restore();

        options.onProgress?.((performance.now() - startedAt) / totalMs, image.subject);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  } finally {
    recorder.stop();
    for (const track of stream.getTracks()) track.stop();
  }

  const blob = await finished;
  // A tab out of view is not drawn, so the recorder gets no frames and hands back nothing. Saving
  // that as "Sample video created, 0 B" was the result; saying why is the useful answer.
  if (blob.size === 0) {
    throw new Error(
      'The recording came out empty. The browser stops drawing a tab that is out of view, so keep this one in front while the sample is made.',
    );
  }
  return {
    name: 'Sample scenes.webm',
    mime: blob.type || 'video/webm',
    data: await blob.arrayBuffer(),
  };
}

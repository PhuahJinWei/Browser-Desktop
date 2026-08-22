/**
 * Audio decoding and resampling.
 *
 * Whisper wants mono 16 kHz float samples, and files arrive as MP3, WAV, M4A or whatever the
 * browser will open. Decoding happens on the main thread because the Web Audio API is not exposed
 * to workers — only the samples cross over, as a transferable buffer.
 */

export const TARGET_SAMPLE_RATE = 16_000;

export interface DecodedAudio {
  samples: Float32Array;
  /** Seconds of audio, from the original file rather than the resampled length. */
  duration: number;
  originalSampleRate: number;
  channels: number;
}

/**
 * Decodes to mono at 16 kHz.
 *
 * `OfflineAudioContext` does the resampling: it is the browser's own high-quality resampler, and
 * writing one by hand would be both slower and worse. Channels are mixed down by the context's
 * own down-mixing rules rather than by averaging, which handles surround layouts correctly.
 */
export async function decodeToMono16k(data: ArrayBuffer): Promise<DecodedAudio> {
  const AudioContextClass =
    globalThis.AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser cannot decode audio');

  // A short-lived context purely for decoding; `decodeAudioData` needs one but not a running one.
  const context = new AudioContextClass();
  let buffer: AudioBuffer;
  try {
    // decodeAudioData detaches the buffer it is given, so hand it a copy.
    buffer = await context.decodeAudioData(data.slice(0));
  } finally {
    void context.close();
  }

  const duration = buffer.duration;
  const originalSampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;

  if (originalSampleRate === TARGET_SAMPLE_RATE && channels === 1) {
    return {
      samples: buffer.getChannelData(0).slice(),
      duration,
      originalSampleRate,
      channels,
    };
  }

  const frames = Math.max(1, Math.ceil(duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return {
    samples: rendered.getChannelData(0).slice(),
    duration,
    originalSampleRate,
    channels,
  };
}

/**
 * A coarse amplitude envelope for drawing a waveform.
 *
 * Peak per bucket rather than average: an average of a symmetric waveform tends towards zero and
 * draws a flat line, which is why naive waveform displays look wrong.
 */
export function waveformPeaks(samples: Float32Array, buckets = 400): Float32Array {
  const peaks = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(samples.length / buckets));

  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = bucket * size;
    const end = Math.min(samples.length, start + size);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const value = Math.abs(samples[i] ?? 0);
      if (value > peak) peak = value;
    }
    peaks[bucket] = peak;
  }
  return peaks;
}

/** `83.4` -> `01:23`, or `01:02:03` past an hour. */
export function formatTimestamp(seconds: number, withHours = false): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 || withHours
    ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
    : `${pad(minutes)}:${pad(secs)}`;
}

/** SubRip timestamps use a comma before the milliseconds. */
export function formatSrtTimestamp(seconds: number): string {
  const total = Math.max(0, seconds);
  const milliseconds = Math.floor((total % 1) * 1000);
  return `${formatTimestamp(total, true)},${String(milliseconds).padStart(3, '0')}`;
}

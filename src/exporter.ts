import type { AudioEngine } from './audioEngine';
import { compressVideo } from './compressor';

// Ordered by preference. Chrome and Safari will very likely pick different
// entries here from the same list — that's expected, not a bug: both feed
// into the same compress step below, which always outputs .mp4 regardless.
const MIME_TYPE_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

// 30 Mbps for the live capture: generous enough that the compress pass below
// starts from a clean, low-artifact source instead of compressing an
// already-compressed file (which would stack generation loss). The final
// delivered size comes from the CRF compress step, not this number.
const VIDEO_BITS_PER_SECOND = 30_000_000;

/**
 * Compression runs fully single-threaded (no cross-origin isolation on
 * GitHub Pages) and can legitimately take a long time for a full-length song
 * — but with no bound at all, a genuine stall (worker crash, stuck fetch)
 * would leave the progress bar frozen forever with no feedback. This caps it
 * at whichever is larger: 5 minutes, or 6x the recorded duration — generous
 * enough not to cut off a real slow-but-working encode.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of MIME_TYPE_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

export interface ExportResult {
  blobUrl: string;
  fileExtension: string;
}

export interface ExportCallbacks {
  /** `fraction` is 0..1 progress through whichever phase `message` describes. */
  onProgress?: (message: string, fraction: number) => void;
  onComplete?: (result: ExportResult) => void;
  onError?: (message: string) => void;
}

export interface ExportRange {
  /** Seconds to start playback/recording from. */
  startSec: number;
  /** Seconds to stop at, or null to record to the natural end of the track. */
  endSec: number | null;
}

/**
 * Two-phase export:
 *  1. Record — live capture of the canvas (60fps) + mixed audio via
 *     MediaRecorder while the song plays back at normal speed. Takes as long
 *     as the selected range (or the whole track) and needs the tab foregrounded.
 *  2. Compress — the recording is re-encoded with CRF-based x264 (ffmpeg.wasm,
 *     the same technique HandBrake uses), which is what actually determines
 *     final file size/quality, not the recording bitrate above.
 */
export async function startExport(
  canvas: HTMLCanvasElement,
  audioEngine: AudioEngine,
  audioElement: HTMLAudioElement,
  range: ExportRange,
  callbacks: ExportCallbacks
): Promise<void> {
  const mimeType = pickSupportedMimeType();
  if (!mimeType) {
    callbacks.onError?.('This browser cannot record video. Please try the latest Chrome or Safari.');
    return;
  }

  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const rawBlob = await recordRange(canvas, audioEngine, audioElement, range, mimeType, callbacks);
  if (!rawBlob) return; // error already reported by recordRange

  const effectiveEndSec = range.endSec ?? (audioElement.duration || 0);
  const recordedDurationSec = Math.max(0, effectiveEndSec - range.startSec);
  const compressTimeoutMs = Math.max(5 * 60_000, recordedDurationSec * 1000 * 6);

  callbacks.onProgress?.('Downloading compression engine…', 0);
  try {
    const compressed = await withTimeout(
      compressVideo(rawBlob, mimeType, (phase, fraction) => {
        const message = phase === 'downloading-engine' ? 'Downloading compression engine…' : 'Compressing…';
        callbacks.onProgress?.(message, fraction);
      }),
      compressTimeoutMs
    );
    const blobUrl = URL.createObjectURL(compressed);
    callbacks.onComplete?.({ blobUrl, fileExtension: 'mp4' });
  } catch (err) {
    // Compression is a bonus step — if it fails or times out for any reason,
    // still hand back the (larger, uncompressed) recording rather than
    // leaving the render stuck or losing it entirely.
    console.error('Video compression failed or timed out, falling back to the uncompressed recording:', err);
    const blobUrl = URL.createObjectURL(rawBlob);
    const fileExtension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    callbacks.onProgress?.('Compression failed — using the uncompressed recording instead.', 1);
    callbacks.onComplete?.({ blobUrl, fileExtension });
  }
}

function recordRange(
  canvas: HTMLCanvasElement,
  audioEngine: AudioEngine,
  audioElement: HTMLAudioElement,
  range: ExportRange,
  mimeType: string,
  callbacks: ExportCallbacks
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const videoTrack = canvas.captureStream(60).getVideoTracks()[0];
    const audioTrack = audioEngine.streamDestination.stream.getAudioTracks()[0];
    const tracks = [videoTrack, audioTrack].filter((t): t is MediaStreamTrack => Boolean(t));
    const mixedStream = new MediaStream(tracks);

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(mixedStream, {
      mimeType,
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = () => {
      callbacks.onError?.('Recording failed partway through. Please try again.');
      resolve(null);
    };

    const controller = new AbortController();
    let stopped = false;
    const stopOnce = () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      audioElement.pause();
      audioEngine.setSpeakerMuted(false);
      if (recorder.state !== 'inactive') recorder.stop();
    };

    audioElement.addEventListener('ended', stopOnce, { signal: controller.signal });

    // A custom end point won't naturally fire 'ended', so watch playback
    // position directly and stop as soon as it's reached.
    if (range.endSec !== null) {
      audioElement.addEventListener(
        'timeupdate',
        () => {
          if (audioElement.currentTime >= range.endSec!) stopOnce();
        },
        { signal: controller.signal }
      );
    }

    audioElement.addEventListener(
      'timeupdate',
      () => {
        const endSec = range.endSec ?? (audioElement.duration || 0);
        const span = Math.max(0.001, endSec - range.startSec);
        const fraction = Math.min(1, Math.max(0, (audioElement.currentTime - range.startSec) / span));
        callbacks.onProgress?.('Recording…', fraction);
      },
      { signal: controller.signal }
    );

    // Wrapped in one try/catch, not just around play(): if resume() or
    // anything else here throws, this fire-and-forget IIFE would otherwise
    // become an unhandled rejection and leave the surrounding Promise (and
    // the whole export) hanging forever with no error ever shown.
    (async () => {
      try {
        audioElement.currentTime = range.startSec;
        await audioEngine.resume();

        // The recording path (streamDestination) has its own separate gain
        // node, so muting the speaker path here doesn't touch the recorded
        // audio at all — the exported video still gets full volume, it just
        // won't play out loud on this machine while it renders.
        audioEngine.setSpeakerMuted(true);

        recorder.start();
        callbacks.onProgress?.('Recording…', 0);

        await audioElement.play();

        // Safety net in case neither 'ended' nor the timeupdate check fires.
        const effectiveEndSec = range.endSec ?? (audioElement.duration || 0);
        const durationMs = Math.max(0, effectiveEndSec - range.startSec) * 1000 + 1500;
        setTimeout(stopOnce, durationMs);
      } catch {
        stopOnce();
        callbacks.onError?.('Could not start playback for recording.');
        resolve(null);
      }
    })();
  });
}

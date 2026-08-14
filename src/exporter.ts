import type { AudioEngine } from './audioEngine';

// Ordered by preference. Chrome and Safari will very likely pick different
// entries here from the same list — that's expected, not a bug: treat one
// browser as your "final export" browser and the other as an editing/fallback path.
const MIME_TYPE_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const VIDEO_BITS_PER_SECOND = 40_000_000; // ~40 Mbps, well within a 1080p60 YouTube-quality target

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
  onProgress?: (message: string) => void;
  onComplete?: (result: ExportResult) => void;
  onError?: (message: string) => void;
}

/**
 * Real-time export: records the canvas (60fps) + the actual mixed audio together
 * with MediaRecorder while the song plays back at normal speed. Export therefore
 * takes exactly as long as the track and requires the tab to stay foregrounded.
 */
export async function startExport(
  canvas: HTMLCanvasElement,
  audioEngine: AudioEngine,
  audioElement: HTMLAudioElement,
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
    const blob = new Blob(chunks, { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const fileExtension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    callbacks.onComplete?.({ blobUrl, fileExtension });
  };

  recorder.onerror = () => {
    callbacks.onError?.('Recording failed partway through. Please try again.');
  };

  let stopped = false;
  const stopOnce = () => {
    if (stopped) return;
    stopped = true;
    if (recorder.state !== 'inactive') recorder.stop();
  };

  audioElement.onended = stopOnce;

  audioElement.currentTime = 0;
  await audioEngine.resume();

  recorder.start();
  callbacks.onProgress?.('Recording…');

  try {
    await audioElement.play();
  } catch (err) {
    stopOnce();
    callbacks.onError?.('Could not start playback for recording.');
    return;
  }

  // Safety net in case the 'ended' event doesn't fire for some reason.
  const durationMs = (audioElement.duration || 0) * 1000 + 1500;
  setTimeout(stopOnce, durationMs);
}

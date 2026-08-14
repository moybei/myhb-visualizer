import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

// Pinned to the core version this @ffmpeg/ffmpeg release expects, fetched from
// a CDN rather than bundled — it's a ~30MB WASM engine, too large to vendor
// into this repo, and it's only downloaded once per browser session (cached
// by the browser after that — see prefetchWithProgress below for why we still
// fetch it ourselves once even though it's cached afterward).
const FFMPEG_CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.9/dist/umd';
const FFMPEG_CORE_JS_URL = `${FFMPEG_CORE_BASE}/ffmpeg-core.js`;
const FFMPEG_CORE_WASM_URL = `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`;

// Fixed "Standard" preset by design — no user-facing quality picker. CRF is
// quality-based (not flat bitrate): it spends bits where the frame actually
// needs them and saves them where it doesn't, so this is meaningfully smaller
// than the live-captured source at equivalent visual quality (the same
// technique HandBrake uses under the hood).
const COMPRESS_CRF = 21;
// No cross-origin isolation on GitHub Pages -> single-threaded wasm, so a
// slower x264 preset would take too long without real speed benefit here.
const COMPRESS_PRESET = 'veryfast';

export type CompressPhase = 'downloading-engine' | 'encoding';

// ~30MB should never legitimately take anywhere near this long on any real
// connection — if the engine hasn't loaded within this window, something is
// genuinely stuck (stalled fetch, worker failed silently), not just slow.
// Encoding itself (which can legitimately take minutes for a full song) isn't
// bound by this — only the engine download/init step is.
const ENGINE_LOAD_TIMEOUT_MS = 90_000;

let ffmpegPromise: Promise<FFmpeg> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
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

/**
 * Fetches a URL with byte-level progress via the response stream, then
 * discards the bytes — the point is purely to populate the browser's HTTP
 * cache *with progress visible*, since ffmpeg.load() below re-fetches the
 * same URL directly (required — passing pre-fetched blob URLs to ffmpeg.load()
 * breaks its worker in testing) and that second fetch then resolves instantly
 * from cache instead of silently blocking with no feedback.
 */
async function prefetchWithProgress(url: string, onProgress: (fraction: number) => void): Promise<void> {
  const response = await fetch(url);
  const totalStr = response.headers.get('content-length');
  const total = totalStr ? Number(totalStr) : 0;

  if (!response.body || !total) {
    await response.arrayBuffer();
    onProgress(1);
    return;
  }

  const reader = response.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    onProgress(Math.min(1, received / total));
  }
}

async function getFFmpeg(onProgress: (phase: CompressPhase, fraction: number) => void): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      // The wasm binary (~25-30MB) dwarfs core.js (~100KB), so weight progress
      // toward it rather than splitting 50/50.
      onProgress('downloading-engine', 0);
      await prefetchWithProgress(FFMPEG_CORE_JS_URL, (f) => onProgress('downloading-engine', f * 0.05));
      await prefetchWithProgress(FFMPEG_CORE_WASM_URL, (f) => onProgress('downloading-engine', 0.05 + f * 0.95));

      const ffmpeg = new FFmpeg();
      // Passing the CDN URLs directly (rather than pre-fetching them into blob
      // URLs, which is the more commonly documented pattern) is what actually
      // works reliably here — wrapping them in toBlobURL() caused ffmpeg's
      // worker to fail importing the core script in testing. Both URLs are
      // now warm in the HTTP cache from the prefetch above, so this resolves
      // near-instantly rather than re-downloading.
      await ffmpeg.load({ coreURL: FFMPEG_CORE_JS_URL, wasmURL: FFMPEG_CORE_WASM_URL });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

/**
 * Re-encodes a recorded video with CRF-based x264 — content-aware compression
 * producing a meaningfully smaller file than the live capture's flat bitrate
 * at equivalent visual quality. Always outputs .mp4 (h264/aac), regardless of
 * the source container, which also sidesteps the Chrome-vs-Safari
 * different-output-format issue for the final deliverable.
 */
export async function compressVideo(
  inputBlob: Blob,
  sourceMimeType: string,
  onProgress: (phase: CompressPhase, fraction: number) => void
): Promise<Blob> {
  const ffmpeg = await withTimeout(
    getFFmpeg(onProgress),
    ENGINE_LOAD_TIMEOUT_MS,
    `Compression engine failed to load within ${ENGINE_LOAD_TIMEOUT_MS / 1000}s`
  );
  const inputName = `input.${sourceMimeType.includes('mp4') ? 'mp4' : 'webm'}`;
  const outputName = 'output.mp4';

  await ffmpeg.writeFile(inputName, await fetchFile(inputBlob));

  const handleProgress = ({ progress }: { progress: number }) => {
    // ffmpeg occasionally reports slightly out-of-range values at the very
    // start/end of the pass.
    onProgress('encoding', Math.min(1, Math.max(0, progress)));
  };
  ffmpeg.on('progress', handleProgress);

  try {
    await ffmpeg.exec([
      '-i',
      inputName,
      '-c:v',
      'libx264',
      '-crf',
      String(COMPRESS_CRF),
      '-preset',
      COMPRESS_PRESET,
      // The live capture's real-time timestamps can jitter slightly (never
      // exactly 60.000fps every frame), and without an explicit output rate
      // ffmpeg falls back to inferring one from that timing — which came out
      // as 30fps. -r forces the true target rate; -vsync cfr converts the
      // variable-timestamp input into a strict constant frame rate by
      // duplicating/dropping frames as needed instead of just relabeling it.
      '-r',
      '60',
      '-vsync',
      'cfr',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      outputName,
    ]);

    const data = await ffmpeg.readFile(outputName);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    return new Blob([bytes], { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', handleProgress);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

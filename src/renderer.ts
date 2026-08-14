import type { AppState } from './state';

// All layout numbers are in canvas pixels on the fixed 1920x1080 stage, so the
// preview and the exported video are always pixel-identical.
const STAGE_W = 1920;
const STAGE_H = 1080;

const GAP_ART_TO_TEXT = 150; // spacing between the album art box and the text column

const ART_BOX = { x: 190, y: 110, size: 640 }; // moved up for more gap before the spectrum section
const TEXT_X = ART_BOX.x + ART_BOX.size + GAP_ART_TO_TEXT;
const TEXT_RIGHT_MARGIN = 130;
const TEXT_W = STAGE_W - TEXT_RIGHT_MARGIN - TEXT_X;

// Offsets from the album art box's top, so the text stack's internal rhythm
// follows automatically if the box ever moves vertically.
const ARTIST_LABEL_Y = ART_BOX.y + 70;
const ARTIST_VALUE_Y = ART_BOX.y + 125;
const TITLE_LABEL_Y = ART_BOX.y + 250;
const TITLE_VALUE_Y = ART_BOX.y + 305;
const TITLE_SUBTITLE_Y = ART_BOX.y + 350;
const WAVEFORM_LABEL_Y = ART_BOX.y + 440;
const WAVEFORM_FIELD_Y = ART_BOX.y + 465;
const WAVEFORM_FIELD_H = 126; // 90 * 1.4 — 40% taller
const WAVEFORM_FIELD_W = Math.round(TEXT_W * 0.5); // halved per feedback

// Bottom cluster stays independent of the top padding — anchored to the
// stage bottom as before.
const SPECTRUM_X = 80;
const SPECTRUM_W = STAGE_W - SPECTRUM_X * 2;
const SPECTRUM_Y = STAGE_H - 260; // more bottom padding — whole cluster shifted up
const SPECTRUM_H = 120;

const PROGRESS_BAR_X = SPECTRUM_X;
const PROGRESS_BAR_W = SPECTRUM_W;
const PROGRESS_BAR_Y = SPECTRUM_Y + SPECTRUM_H + 26;
const PROGRESS_BAR_H = 6;
const TIME_LABEL_Y = PROGRESS_BAR_Y + PROGRESS_BAR_H + 34;

const NUM_SPECTRUM_BARS = 150;

let bgCacheCanvas: HTMLCanvasElement | null = null;
let bgCacheKey = '';

/**
 * Draws one full frame of the scene. `freqData`/`waveformHistory` are null before
 * any playback has started. `currentTimeSec`/`durationSec` drive the bottom
 * progress bar and its time labels (`durationSec` may be NaN before the audio
 * file's metadata has loaded). `sampleRate` is the AudioContext's sample rate,
 * needed to map the spectrum's frequency band (Hz) to analyser bin indices.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  freqData: Uint8Array | null,
  waveformHistory: Float32Array | null,
  currentTimeSec: number,
  durationSec: number,
  sampleRate: number
): void {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);

  drawBackground(ctx, state);
  drawAlbumArtBox(ctx, state);
  drawTextStack(ctx, state);
  drawWaveformField(ctx, state, waveformHistory);
  drawSpectrumBar(ctx, state, freqData, sampleRate);
  drawProgressBar(ctx, state, currentTimeSec, durationSec);
}

function drawBackground(ctx: CanvasRenderingContext2D, state: AppState): void {
  // Scoped so the brightness filter never leaks into later layers (album art,
  // text, etc.) — only the background itself gets brightened/darkened.
  ctx.save();
  ctx.filter = `brightness(${state.backgroundBrightness}%)`;

  if (state.backgroundMode === 'color') {
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  } else if (state.backgroundMode === 'image') {
    if (state.backgroundImage) {
      drawImageCover(ctx, state.backgroundImage, 0, 0, STAGE_W, STAGE_H, 1);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }
  } else {
    // blurredAlbumArt
    const cached = getBlurredBackgroundCanvas(state);
    if (cached) {
      ctx.drawImage(cached, 0, 0);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }
  }

  ctx.restore();
}

/**
 * The blur filter is expensive to run every frame (a known Safari perf/frame-drop
 * hot spot), so it's rendered once into an offscreen canvas whenever the source
 * image, zoom, or blur amount change, and every real frame just does one cheap
 * drawImage of that cache.
 */
function getBlurredBackgroundCanvas(state: AppState): HTMLCanvasElement | null {
  if (!state.albumArtImage) return null;

  const key = `${state.albumArtImage.src}|${state.backgroundZoom}|${state.backgroundBlurPx}`;
  if (bgCacheCanvas && bgCacheKey === key) return bgCacheCanvas;

  const off = document.createElement('canvas');
  off.width = STAGE_W;
  off.height = STAGE_H;
  const octx = off.getContext('2d')!;
  octx.filter = `blur(${state.backgroundBlurPx}px)`;
  drawImageCover(octx, state.albumArtImage, 0, 0, STAGE_W, STAGE_H, state.backgroundZoom);
  octx.filter = 'none';

  bgCacheCanvas = off;
  bgCacheKey = key;
  return off;
}

function drawAlbumArtBox(ctx: CanvasRenderingContext2D, state: AppState): void {
  const { x, y, size } = ART_BOX;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  if (state.albumArtImage) {
    drawImageCover(ctx, state.albumArtImage, x, y, size, size, 1);
  } else {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, size, size);
}

const LABEL_FONT = '600 24px -apple-system, "Segoe UI", Arial, sans-serif';
const LABEL_OPACITY = 0.55;

/** Parses "#rrggbb" into "rgba(r,g,b,alpha)" — falls back to white if malformed. */
function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(match[1].slice(0, 2), 16);
  const g = parseInt(match[1].slice(2, 4), 16);
  const b = parseInt(match[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawLabel(ctx: CanvasRenderingContext2D, state: AppState, text: string, x: number, y: number): void {
  ctx.font = LABEL_FONT;
  ctx.fillStyle = hexToRgba(state.textColor, LABEL_OPACITY);
  ctx.textBaseline = 'alphabetic';
  // Manual letter-spacing: ctx.letterSpacing isn't reliably supported across
  // Chrome/Safari versions, so space the characters out by hand instead.
  const spaced = text.toUpperCase().split('').join('  ');
  ctx.fillText(spaced, x, y);
}

function drawTextStack(ctx: CanvasRenderingContext2D, state: AppState): void {
  drawLabel(ctx, state, 'Artist', TEXT_X, ARTIST_LABEL_Y);
  ctx.font = `400 52px ${state.fontFamily}`;
  ctx.fillStyle = state.textColor;
  fillTextClipped(ctx, state.artistName || 'MYHB', TEXT_X, ARTIST_VALUE_Y, TEXT_W);

  drawLabel(ctx, state, 'Title', TEXT_X, TITLE_LABEL_Y);
  ctx.font = `400 52px ${state.fontFamily}`;
  ctx.fillStyle = state.textColor;
  fillTextClipped(ctx, state.songTitle || 'Make Your Heart Beat', TEXT_X, TITLE_VALUE_Y, TEXT_W);

  if (state.titleSubtitle) {
    ctx.font = `400 28px ${state.fontFamily}`;
    ctx.fillStyle = state.textColor;
    fillTextClipped(ctx, state.titleSubtitle, TEXT_X, TITLE_SUBTITLE_Y, TEXT_W);
  }

  drawLabel(ctx, state, 'Waveform', TEXT_X, WAVEFORM_LABEL_Y);
}

function fillTextClipped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
  let s = text;
  while (ctx.measureText(s).width > maxWidth && s.length > 1) {
    s = s.slice(0, -1);
  }
  if (s !== text) s = s.slice(0, -1) + '…';
  ctx.fillText(s, x, y);
}

/**
 * Live, scrolling oscilloscope-style waveform (After Effects "audio waveform"
 * template look): `waveformHistory` holds actual raw sample values (-1..1),
 * oldest at index 0 / leftmost pixel, newest at the last index / rightmost
 * pixel, drawn as one continuous stroked curve (real oscillation, not
 * amplitude bars). The buffer represents a very short real-time window (a
 * fraction of a second), so a kick's transient sweeps across the whole field
 * almost instantly rather than crawling across over several seconds.
 */
function drawWaveformField(ctx: CanvasRenderingContext2D, state: AppState, waveformHistory: Float32Array | null): void {
  const x = TEXT_X;
  const y = WAVEFORM_FIELD_Y;
  const w = WAVEFORM_FIELD_W;
  const h = WAVEFORM_FIELD_H;
  const centerY = y + h / 2;

  if (!waveformHistory || waveformHistory.length === 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, centerY);
    ctx.lineTo(x + w, centerY);
    ctx.stroke();
    return;
  }

  const columns = waveformHistory.length;
  const colWidth = w / (columns - 1);

  ctx.strokeStyle = state.textColor;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < columns; i++) {
    const sample = Math.max(-1, Math.min(1, waveformHistory[i]));
    const px = x + i * colWidth;
    const py = centerY - sample * (h / 2);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

// The analyser's minDecibels/maxDecibels window (see audioEngine.ts) now does
// the main log-domain contrast work — normal level low, real hits near max.
// This curve is just a light residual shaping on top of that, not the primary
// mechanism anymore, so it's much milder than before.
const SPECTRUM_RESPONSE_EXPONENT = 1.6;
const SPECTRUM_SENSITIVITY = 1.2;

// Per-bar attack/release envelope (like a real level meter) instead of relying
// solely on the analyser's own smoothing, which dampens rises and falls
// equally. A fast attack lets a kick/snare transient snap up to its full
// height immediately (so it actually reads as a hit), while a slow release
// lets it fade back out gently instead of vanishing next frame.
const SPECTRUM_ATTACK = 0.9;
const SPECTRUM_RELEASE = 0.12;
let spectrumEnvelope: Float32Array | null = null;

function drawSpectrumBar(ctx: CanvasRenderingContext2D, state: AppState, freqData: Uint8Array | null, sampleRate: number): void {
  const x = SPECTRUM_X;
  const y = SPECTRUM_Y;
  const w = SPECTRUM_W;
  const h = SPECTRUM_H;
  const barWidth = w / NUM_SPECTRUM_BARS;
  const gap = barWidth * 0.7;

  // Follows the theme color by default; once the user picks their own bar
  // color it stops following and stays independent.
  const barColor = state.visualizerColorCustomized ? state.visualizerColor : state.textColor;
  ctx.fillStyle = barColor;
  ctx.strokeStyle = barColor;

  if (!spectrumEnvelope || spectrumEnvelope.length !== NUM_SPECTRUM_BARS) {
    spectrumEnvelope = new Float32Array(NUM_SPECTRUM_BARS);
  }

  if (!freqData) {
    // idle state before playback starts: flat baseline
    ctx.globalAlpha = 0.3;
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.globalAlpha = 1;
    return;
  }

  // Map the requested Hz band onto analyser bin indices using the real sample
  // rate: bin i covers i * (sampleRate / 2) / freqData.length Hz.
  const nyquist = sampleRate / 2;
  const startBin = Math.max(0, Math.floor((state.spectrumMinHz / nyquist) * freqData.length));
  const endBin = Math.min(freqData.length, Math.ceil((state.spectrumMaxHz / nyquist) * freqData.length));

  for (let i = 0; i < NUM_SPECTRUM_BARS; i++) {
    const target = sampleBand(freqData, i, startBin, endBin);
    const rate = target > spectrumEnvelope[i] ? SPECTRUM_ATTACK : SPECTRUM_RELEASE;
    spectrumEnvelope[i] += (target - spectrumEnvelope[i]) * rate;
  }

  for (let i = 0; i < NUM_SPECTRUM_BARS; i++) {
    const value = spectrumEnvelope[i];
    const barHeight = Math.max(2, value * h);
    const bx = x + i * barWidth;

    if (state.visualizerStyle === 'mirroredBars') {
      const centerY = y + h / 2;
      ctx.fillRect(bx, centerY - barHeight / 2, barWidth - gap, barHeight);
    } else {
      ctx.fillRect(bx, y + h - barHeight, barWidth - gap, barHeight);
    }
  }
}

function sampleBand(freqData: Uint8Array, bandIndex: number, startBin: number, endBin: number): number {
  const bandBins = endBin - startBin;
  const start = startBin + Math.floor((bandIndex / NUM_SPECTRUM_BARS) * bandBins);
  const end = Math.max(start + 1, startBin + Math.floor(((bandIndex + 1) / NUM_SPECTRUM_BARS) * bandBins));
  let sum = 0;
  for (let i = start; i < end; i++) sum += freqData[i];
  const raw = sum / (end - start) / 255;
  return Math.min(1, Math.pow(raw, SPECTRUM_RESPONSE_EXPONENT) * SPECTRUM_SENSITIVITY);
}

function drawProgressBar(ctx: CanvasRenderingContext2D, state: AppState, currentTimeSec: number, durationSec: number): void {
  const x = PROGRESS_BAR_X;
  const y = PROGRESS_BAR_Y;
  const w = PROGRESS_BAR_W;
  const h = PROGRESS_BAR_H;

  const hasDuration = Number.isFinite(durationSec) && durationSec > 0;
  const playedFraction = hasDuration ? currentTimeSec / durationSec : 0;

  // Track tinted with the theme color at low opacity — dark enough to read as
  // a track (not the bright fill), but still visibly colored, not plain gray.
  ctx.fillStyle = hexToRgba(state.textColor, 0.2);
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = state.textColor;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, playedFraction)), h);

  ctx.font = LABEL_FONT;
  ctx.fillStyle = hexToRgba(state.textColor, LABEL_OPACITY);
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  ctx.fillText(formatTime(currentTimeSec), x, TIME_LABEL_Y);

  ctx.textAlign = 'right';
  ctx.fillText(formatTime(hasDuration ? durationSec : 0), x + w, TIME_LABEL_Y);

  ctx.textAlign = 'left';
}

function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Draws `img` covering the target rect (like CSS background-size: cover). zoom > 1 crops in tighter. */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom: number
): void {
  const boxRatio = w / h;
  const imgRatio = img.width / img.height;

  let sw: number;
  let sh: number;
  if (imgRatio > boxRatio) {
    sh = img.height / zoom;
    sw = sh * boxRatio;
  } else {
    sw = img.width / zoom;
    sh = sw / boxRatio;
  }
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

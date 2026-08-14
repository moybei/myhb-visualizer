import type { AppState } from './state';

// All layout numbers are in canvas pixels on the fixed 1920x1080 stage, so the
// preview and the exported video are always pixel-identical.
const STAGE_W = 1920;
const STAGE_H = 1080;

const ART_BOX = { x: 130, y: 150, size: 640 };
const TEXT_X = ART_BOX.x + ART_BOX.size + 90; // 860
const TEXT_RIGHT_MARGIN = 130;
const TEXT_W = STAGE_W - TEXT_RIGHT_MARGIN - TEXT_X;

const ARTIST_LABEL_Y = 220;
const ARTIST_VALUE_Y = 275;
const TITLE_LABEL_Y = 400;
const TITLE_VALUE_Y = 455;
const WAVEFORM_LABEL_Y = 590;
const WAVEFORM_FIELD_Y = 615;
const WAVEFORM_FIELD_H = 90;
const WAVEFORM_FIELD_W = Math.round(TEXT_W * 0.5); // halved per feedback

const SPECTRUM_X = 80;
const SPECTRUM_W = STAGE_W - SPECTRUM_X * 2;
const SPECTRUM_Y = STAGE_H - 220;
const SPECTRUM_H = 120;

const PROGRESS_BAR_X = SPECTRUM_X;
const PROGRESS_BAR_W = SPECTRUM_W;
const PROGRESS_BAR_Y = SPECTRUM_Y + SPECTRUM_H + 26;
const PROGRESS_BAR_H = 6;

// Lots of thin bars, like the reference screenshot's dense spectrum look.
const NUM_SPECTRUM_BARS = 300;
const SPECTRUM_FREQ_MIN_HZ = 40;
const SPECTRUM_FREQ_MAX_HZ = 6000;

let bgCacheCanvas: HTMLCanvasElement | null = null;
let bgCacheKey = '';

/**
 * Draws one full frame of the scene. `freqData`/`waveformHistory` are null before
 * any playback has started. `playedFraction` drives only the bottom progress bar.
 * `sampleRate` is the AudioContext's sample rate, needed to map the spectrum's
 * frequency band (Hz) to analyser bin indices.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  freqData: Uint8Array | null,
  waveformHistory: Float32Array | null,
  playedFraction: number,
  sampleRate: number
): void {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);

  drawBackground(ctx, state);
  drawAlbumArtBox(ctx, state);
  drawTextStack(ctx, state);
  drawWaveformField(ctx, state, waveformHistory);
  drawSpectrumBar(ctx, state, freqData, sampleRate);
  drawProgressBar(ctx, state, playedFraction);
}

function drawBackground(ctx: CanvasRenderingContext2D, state: AppState): void {
  if (state.backgroundMode === 'color') {
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    return;
  }

  if (state.backgroundMode === 'image') {
    if (state.backgroundImage) {
      drawImageCover(ctx, state.backgroundImage, 0, 0, STAGE_W, STAGE_H, 1);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }
    return;
  }

  // blurredAlbumArt
  const cached = getBlurredBackgroundCanvas(state);
  if (cached) {
    ctx.drawImage(cached, 0, 0);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
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

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = '600 24px -apple-system, "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textBaseline = 'alphabetic';
  // Manual letter-spacing: ctx.letterSpacing isn't reliably supported across
  // Chrome/Safari versions, so space the characters out by hand instead.
  const spaced = text.toUpperCase().split('').join('  ');
  ctx.fillText(spaced, x, y);
}

function drawTextStack(ctx: CanvasRenderingContext2D, state: AppState): void {
  drawLabel(ctx, 'Original Artist', TEXT_X, ARTIST_LABEL_Y);
  ctx.font = `600 52px ${state.fontFamily}`;
  ctx.fillStyle = state.textColor;
  fillTextClipped(ctx, state.artistName || 'Artist Name', TEXT_X, ARTIST_VALUE_Y, TEXT_W);

  drawLabel(ctx, 'Title', TEXT_X, TITLE_LABEL_Y);
  ctx.font = `600 52px ${state.fontFamily}`;
  ctx.fillStyle = state.textColor;
  fillTextClipped(ctx, state.songTitle || 'Song Title', TEXT_X, TITLE_VALUE_Y, TEXT_W);

  drawLabel(ctx, 'Waveform', TEXT_X, WAVEFORM_LABEL_Y);
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
  ctx.lineWidth = 2;
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

// A sub-linear exponent boosts quieter moments so bars keep moving instead of
// sitting flat between hits.
const SPECTRUM_RESPONSE_EXPONENT = 0.6;

function drawSpectrumBar(ctx: CanvasRenderingContext2D, state: AppState, freqData: Uint8Array | null, sampleRate: number): void {
  const x = SPECTRUM_X;
  const y = SPECTRUM_Y;
  const w = SPECTRUM_W;
  const h = SPECTRUM_H;
  const barWidth = w / NUM_SPECTRUM_BARS;
  const gap = Math.min(1.5, barWidth * 0.25);

  ctx.fillStyle = state.visualizerColor;
  ctx.strokeStyle = state.visualizerColor;

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
  const startBin = Math.max(0, Math.floor((SPECTRUM_FREQ_MIN_HZ / nyquist) * freqData.length));
  const endBin = Math.min(freqData.length, Math.ceil((SPECTRUM_FREQ_MAX_HZ / nyquist) * freqData.length));

  if (state.visualizerStyle === 'line') {
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < NUM_SPECTRUM_BARS; i++) {
      const value = sampleBand(freqData, i, startBin, endBin);
      const px = x + i * barWidth + barWidth / 2;
      const py = y + h - value * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    return;
  }

  for (let i = 0; i < NUM_SPECTRUM_BARS; i++) {
    const value = sampleBand(freqData, i, startBin, endBin);
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
  return Math.pow(raw, SPECTRUM_RESPONSE_EXPONENT);
}

function drawProgressBar(ctx: CanvasRenderingContext2D, state: AppState, playedFraction: number): void {
  const x = PROGRESS_BAR_X;
  const y = PROGRESS_BAR_Y;
  const w = PROGRESS_BAR_W;
  const h = PROGRESS_BAR_H;

  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = state.visualizerColor;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, playedFraction)), h);
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

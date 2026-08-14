import type { AppState, BackgroundMode, VisualizerStyle } from './state';
import type { AudioEngine } from './audioEngine';
import { startExport } from './exporter';
import { extractMetadata } from './metadata';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

function sanitizeFilenamePart(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.replace(/[\\/:*?"<>|]/g, '') : '';
}

/** Parses "mm:ss" or a plain seconds number. Returns NaN if empty/unparseable. */
function parseTimeToSeconds(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return NaN;
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => parseFloat(p));
    if (parts.some((p) => Number.isNaN(p))) return NaN;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  return parseFloat(trimmed);
}

function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Keeps a <input type="color"> and a plain hex <input type="text"> in sync both ways. */
function bindColorWithHex(colorInput: HTMLInputElement, hexInput: HTMLInputElement, onChange: (hex: string) => void): void {
  colorInput.addEventListener('input', () => {
    hexInput.value = colorInput.value;
    onChange(colorInput.value);
  });
  hexInput.addEventListener('input', () => {
    const value = hexInput.value.startsWith('#') ? hexInput.value : `#${hexInput.value}`;
    if (HEX_COLOR_RE.test(value)) {
      colorInput.value = value;
      onChange(value);
    }
  });
}

/** Double-click a range input to snap it back to its default value. */
function bindSliderReset(input: HTMLInputElement, defaultValue: number, onChange: (value: number) => void): void {
  input.addEventListener('dblclick', () => {
    input.value = String(defaultValue);
    onChange(defaultValue);
  });
}

/**
 * Wires drag-and-drop onto a single row (not the whole page): dropping a file
 * syncs it into the input's own file list (so the native picker UI reflects
 * it too, same as choosing it via the button) and runs the same handler.
 */
function bindFileDropzone(dropzone: HTMLLabelElement, input: HTMLInputElement, onFile: (file: File) => void): void {
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;

    onFile(file);
  });
}

export interface ControlDeps {
  state: AppState;
  audioEngine: AudioEngine;
  audioElement: HTMLAudioElement;
  canvas: HTMLCanvasElement;
}

export function setupControls({ state, audioEngine, audioElement, canvas }: ControlDeps): void {
  const previewScaleInput = el<HTMLInputElement>('previewScale');
  const previewScaleLabel = el<HTMLElement>('previewScaleLabel');
  function applyPreviewScale(): void {
    const pct = previewScaleInput.value;
    // Percent of the canvas's own container (not the viewport) — vw could ask
    // for more width than the space actually available next to the panel,
    // which overflowed the layout at higher slider values. % is always
    // relative to the container's real available size, so it can never
    // exceed what's actually there.
    canvas.style.maxWidth = `${pct}%`;
    previewScaleLabel.textContent = `${pct}%`;
  }
  previewScaleInput.addEventListener('input', applyPreviewScale);
  applyPreviewScale(); // sync canvas/label to the slider's actual starting value, not a separate hardcoded default

  const audioFileInput = el<HTMLInputElement>('audioFile');
  const albumArtFileInput = el<HTMLInputElement>('albumArtFile');
  const bgImageFileInput = el<HTMLInputElement>('bgImageFile');
  const bgModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="bgMode"]');
  const bgColorInput = el<HTMLInputElement>('bgColor');
  const bgColorHexInput = el<HTMLInputElement>('bgColorHex');
  const bgZoomInput = el<HTMLInputElement>('bgZoom');
  const bgBlurInput = el<HTMLInputElement>('bgBlur');
  const bgBrightnessInput = el<HTMLInputElement>('bgBrightness');
  const artistNameInput = el<HTMLInputElement>('artistName');
  const songTitleInput = el<HTMLInputElement>('songTitle');
  const titleSubtitleInput = el<HTMLInputElement>('titleSubtitle');
  const textColorInput = el<HTMLInputElement>('textColor');
  const textColorHexInput = el<HTMLInputElement>('textColorHex');
  const fontFamilySelect = el<HTMLSelectElement>('fontFamily');
  const visualizerColorInput = el<HTMLInputElement>('visualizerColor');
  const visualizerColorHexInput = el<HTMLInputElement>('visualizerColorHex');
  const barColorModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="barColorMode"]');
  const barColorRow = el<HTMLElement>('barColorRow');
  const visualizerStyleSelect = el<HTMLSelectElement>('visualizerStyle');
  const spectrumMinHzInput = el<HTMLInputElement>('spectrumMinHz');
  const spectrumMaxHzInput = el<HTMLInputElement>('spectrumMaxHz');
  const renderRangeModeRadios = document.querySelectorAll<HTMLInputElement>('input[name="renderRangeMode"]');
  const renderRangeRow = el<HTMLElement>('renderRangeRow');
  const renderStartInput = el<HTMLInputElement>('renderStart');
  const renderEndInput = el<HTMLInputElement>('renderEnd');
  const pbPlayBtn = el<HTMLButtonElement>('pbPlayBtn');
  const pbCurrentTime = el<HTMLElement>('pbCurrentTime');
  const pbEndTime = el<HTMLElement>('pbEndTime');
  const pbSeek = el<HTMLInputElement>('pbSeek');
  const renderBtn = el<HTMLButtonElement>('renderBtn');
  const statusEl = el<HTMLDivElement>('status');
  const renderProgressWrap = el<HTMLElement>('renderProgressWrap');
  const renderProgressFill = el<HTMLElement>('renderProgressFill');
  const downloadLink = el<HTMLAnchorElement>('downloadLink');

  const panel = document.querySelector<HTMLElement>('.panel')!;

  let previousBlobUrl: string | null = null;

  function setStatus(message: string): void {
    statusEl.textContent = message;
  }

  function setRenderProgress(message: string, fraction: number): void {
    statusEl.textContent = `${message} ${Math.round(fraction * 100)}%`;
    renderProgressFill.style.width = `${Math.round(fraction * 100)}%`;
  }

  function resetOnEnded(): void {
    audioElement.onended = () => {
      state.isPlaying = false;
      pbPlayBtn.textContent = '▶';
      pbPlayBtn.setAttribute('aria-label', 'Play');
    };
  }
  resetOnEnded();

  audioElement.onplay = () => {
    state.isPlaying = true;
    pbPlayBtn.textContent = '⏸';
    pbPlayBtn.setAttribute('aria-label', 'Pause');
  };
  audioElement.onpause = () => {
    state.isPlaying = false;
    pbPlayBtn.textContent = '▶';
    pbPlayBtn.setAttribute('aria-label', 'Play');
  };

  audioElement.addEventListener('loadedmetadata', () => {
    pbEndTime.textContent = formatTime(audioElement.duration);
  });

  // Avoid the timeupdate listener fighting the slider while the user is
  // actively dragging it.
  let isScrubbing = false;
  audioElement.addEventListener('timeupdate', () => {
    pbCurrentTime.textContent = formatTime(audioElement.currentTime);
    if (isScrubbing) return;
    const duration = audioElement.duration;
    if (Number.isFinite(duration) && duration > 0) {
      pbSeek.value = String(Math.round((audioElement.currentTime / duration) * 1000));
    }
  });

  pbSeek.addEventListener('input', () => {
    isScrubbing = true;
    const duration = audioElement.duration;
    if (Number.isFinite(duration) && duration > 0) {
      audioElement.currentTime = (Number(pbSeek.value) / 1000) * duration;
      pbCurrentTime.textContent = formatTime(audioElement.currentTime);
    }
  });
  pbSeek.addEventListener('change', () => {
    isScrubbing = false;
  });

  async function handleAudioFile(file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file);
    audioElement.src = objectUrl;
    state.hasAudio = true;
    pbPlayBtn.disabled = false;
    pbSeek.disabled = false;
    renderBtn.disabled = false;
    setStatus('Reading song info…');

    // Best-effort autofill from the file's own tags (ID3/Vorbis/MP4) — artist,
    // title, embedded cover art. Purely a convenience: fields stay fully
    // editable after, and a file with no tags just leaves them as they were.
    try {
      const meta = await extractMetadata(file);
      if (meta.artist) {
        state.artistName = meta.artist;
        artistNameInput.value = meta.artist;
      }
      if (meta.title) {
        state.songTitle = meta.title;
        songTitleInput.value = meta.title;
      }
      if (meta.albumArtImage) {
        state.albumArtImage = meta.albumArtImage;
      }
    } catch {
      // No readable tags — not an error the user needs to see, just skip autofill.
    }

    setStatus('Ready.');
  }

  audioFileInput.addEventListener('change', () => {
    const file = audioFileInput.files?.[0];
    if (file) void handleAudioFile(file);
  });
  bindFileDropzone(el<HTMLLabelElement>('audioFileDropzone'), audioFileInput, (file) => void handleAudioFile(file));

  async function handleAlbumArtFile(file: File): Promise<void> {
    state.albumArtImage = await loadImage(file);
  }
  albumArtFileInput.addEventListener('change', () => {
    const file = albumArtFileInput.files?.[0];
    if (file) void handleAlbumArtFile(file);
  });
  bindFileDropzone(el<HTMLLabelElement>('albumArtFileDropzone'), albumArtFileInput, (file) => void handleAlbumArtFile(file));

  async function handleBgImageFile(file: File): Promise<void> {
    state.backgroundImage = await loadImage(file);
  }
  bgImageFileInput.addEventListener('change', () => {
    const file = bgImageFileInput.files?.[0];
    if (file) void handleBgImageFile(file);
  });
  bindFileDropzone(el<HTMLLabelElement>('bgImageFileDropzone'), bgImageFileInput, (file) => void handleBgImageFile(file));

  bgModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) state.backgroundMode = radio.value as BackgroundMode;
    });
  });

  bindColorWithHex(bgColorInput, bgColorHexInput, (hex) => {
    state.backgroundColor = hex;
  });
  bgZoomInput.addEventListener('input', () => {
    state.backgroundZoom = parseFloat(bgZoomInput.value);
  });
  bgBlurInput.addEventListener('input', () => {
    state.backgroundBlurPx = parseFloat(bgBlurInput.value);
  });
  bgBrightnessInput.addEventListener('input', () => {
    state.backgroundBrightness = parseFloat(bgBrightnessInput.value);
  });
  bindSliderReset(bgZoomInput, 1.15, (v) => (state.backgroundZoom = v));
  bindSliderReset(bgBlurInput, 18, (v) => (state.backgroundBlurPx = v));
  bindSliderReset(bgBrightnessInput, 100, (v) => (state.backgroundBrightness = v));

  artistNameInput.addEventListener('input', () => {
    state.artistName = artistNameInput.value;
  });
  songTitleInput.addEventListener('input', () => {
    state.songTitle = songTitleInput.value;
  });
  titleSubtitleInput.addEventListener('input', () => {
    state.titleSubtitle = titleSubtitleInput.value;
  });
  bindColorWithHex(textColorInput, textColorHexInput, (hex) => {
    state.textColor = hex;
  });
  fontFamilySelect.addEventListener('change', () => {
    state.fontFamily = fontFamilySelect.value;
  });

  bindColorWithHex(visualizerColorInput, visualizerColorHexInput, (hex) => {
    state.visualizerColor = hex;
  });
  barColorModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const isCustom = radio.value === 'custom';
      state.visualizerColorCustomized = isCustom;
      barColorRow.style.display = isCustom ? '' : 'none';
      // Seed the custom picker with the current theme color as a starting point.
      if (isCustom) {
        visualizerColorInput.value = state.textColor;
        visualizerColorHexInput.value = state.textColor;
        state.visualizerColor = state.textColor;
      }
    });
  });
  visualizerStyleSelect.addEventListener('change', () => {
    state.visualizerStyle = visualizerStyleSelect.value as VisualizerStyle;
  });

  spectrumMinHzInput.addEventListener('input', () => {
    state.spectrumMinHz = parseFloat(spectrumMinHzInput.value) || 0;
  });
  spectrumMaxHzInput.addEventListener('input', () => {
    state.spectrumMaxHz = parseFloat(spectrumMaxHzInput.value) || 0;
  });

  renderRangeModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.renderRangeMode = radio.value === 'custom' ? 'custom' : 'full';
      renderRangeRow.style.display = state.renderRangeMode === 'custom' ? '' : 'none';
    });
  });
  renderStartInput.addEventListener('input', () => {
    const seconds = parseTimeToSeconds(renderStartInput.value);
    state.renderStartSec = Number.isNaN(seconds) ? 0 : Math.max(0, seconds);
  });
  renderEndInput.addEventListener('input', () => {
    const seconds = parseTimeToSeconds(renderEndInput.value);
    state.renderEndSec = Number.isNaN(seconds) ? 0 : Math.max(0, seconds);
  });

  pbPlayBtn.addEventListener('click', async () => {
    if (audioElement.paused) {
      await audioEngine.resume();
      try {
        await audioElement.play();
      } catch {
        setStatus('Could not start playback.');
      }
    } else {
      audioElement.pause();
    }
  });

  function setControlsDisabled(disabled: boolean): void {
    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button').forEach((elm) => {
      elm.disabled = disabled;
    });
    // The playback bar lives outside .panel (it's pinned to the preview area),
    // so it needs disabling separately — otherwise you could still scrub/play
    // while a recording is in progress and throw off the export.
    pbPlayBtn.disabled = disabled;
    pbSeek.disabled = disabled;
  }

  renderBtn.addEventListener('click', async () => {
    if (!state.hasAudio) return;

    state.isRecording = true;
    setControlsDisabled(true);
    downloadLink.style.display = 'none';
    renderProgressWrap.style.display = 'block';
    renderProgressFill.style.width = '0%';
    setStatus('Preparing…');

    const range =
      state.renderRangeMode === 'custom'
        ? { startSec: state.renderStartSec, endSec: state.renderEndSec > 0 ? state.renderEndSec : null }
        : { startSec: 0, endSec: null };

    await startExport(canvas, audioEngine, audioElement, range, {
      onProgress: (message, fraction) => setRenderProgress(message, fraction),
      onComplete: ({ blobUrl, fileExtension }) => {
        // A rendered video can be a multi-hundred-MB (or bigger) in-memory
        // Blob. Without revoking the previous one, re-rendering repeatedly in
        // the same tab session would pile these up in RAM indefinitely — only
        // the most recent render's file is ever needed at once.
        if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl);
        previousBlobUrl = blobUrl;

        const artistPart = sanitizeFilenamePart(state.artistName);
        const titlePart = sanitizeFilenamePart(state.songTitle);
        const base = [artistPart, titlePart].filter(Boolean).join(' - ') || 'visualizer';
        downloadLink.href = blobUrl;
        downloadLink.download = `${base}.${fileExtension}`;
        downloadLink.style.display = 'inline-block';
        renderProgressWrap.style.display = 'none';
        setStatus('Done! Download your video below.');

        state.isRecording = false;
        setControlsDisabled(false);
        resetOnEnded();
        audioElement.pause();
        audioElement.currentTime = 0;
      },
      onError: (message) => {
        setStatus(message);
        renderProgressWrap.style.display = 'none';
        state.isRecording = false;
        setControlsDisabled(false);
        resetOnEnded();
      },
    });
  });
}

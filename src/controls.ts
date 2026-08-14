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

export interface ControlDeps {
  state: AppState;
  audioEngine: AudioEngine;
  audioElement: HTMLAudioElement;
  canvas: HTMLCanvasElement;
}

export function setupControls({ state, audioEngine, audioElement, canvas }: ControlDeps): void {
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
  const playBtn = el<HTMLButtonElement>('playBtn');
  const renderBtn = el<HTMLButtonElement>('renderBtn');
  const statusEl = el<HTMLDivElement>('status');
  const downloadLink = el<HTMLAnchorElement>('downloadLink');

  const panel = document.querySelector<HTMLElement>('.panel')!;

  function setStatus(message: string): void {
    statusEl.textContent = message;
  }

  function resetOnEnded(): void {
    audioElement.onended = () => {
      state.isPlaying = false;
      playBtn.textContent = 'Play';
    };
  }
  resetOnEnded();

  audioElement.onplay = () => {
    state.isPlaying = true;
    playBtn.textContent = 'Pause';
  };
  audioElement.onpause = () => {
    state.isPlaying = false;
    playBtn.textContent = 'Play';
  };

  audioFileInput.addEventListener('change', async () => {
    const file = audioFileInput.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    audioElement.src = objectUrl;
    state.hasAudio = true;
    playBtn.disabled = false;
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
  });

  albumArtFileInput.addEventListener('change', async () => {
    const file = albumArtFileInput.files?.[0];
    if (!file) return;
    state.albumArtImage = await loadImage(file);
  });

  bgImageFileInput.addEventListener('change', async () => {
    const file = bgImageFileInput.files?.[0];
    if (!file) return;
    state.backgroundImage = await loadImage(file);
  });

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

  playBtn.addEventListener('click', async () => {
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
  }

  renderBtn.addEventListener('click', async () => {
    if (!state.hasAudio) return;

    state.isRecording = true;
    setControlsDisabled(true);
    downloadLink.style.display = 'none';
    setStatus('Preparing…');

    await startExport(canvas, audioEngine, audioElement, {
      onProgress: (message) => setStatus(message),
      onComplete: ({ blobUrl, fileExtension }) => {
        const artistPart = sanitizeFilenamePart(state.artistName);
        const titlePart = sanitizeFilenamePart(state.songTitle);
        const base = [artistPart, titlePart].filter(Boolean).join(' - ') || 'visualizer';
        downloadLink.href = blobUrl;
        downloadLink.download = `${base}.${fileExtension}`;
        downloadLink.style.display = 'inline-block';
        setStatus('Done! Download your video below.');

        state.isRecording = false;
        setControlsDisabled(false);
        resetOnEnded();
        audioElement.pause();
        audioElement.currentTime = 0;
      },
      onError: (message) => {
        setStatus(message);
        state.isRecording = false;
        setControlsDisabled(false);
        resetOnEnded();
      },
    });
  });
}

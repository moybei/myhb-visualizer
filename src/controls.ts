import type { AppState, BackgroundMode, VisualizerStyle } from './state';
import type { AudioEngine } from './audioEngine';
import { decodeAudioFile, computePeaks } from './waveform';
import { startExport } from './exporter';

const WAVEFORM_COLUMNS = 700;

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
  const bgZoomInput = el<HTMLInputElement>('bgZoom');
  const bgBlurInput = el<HTMLInputElement>('bgBlur');
  const artistNameInput = el<HTMLInputElement>('artistName');
  const songTitleInput = el<HTMLInputElement>('songTitle');
  const textColorInput = el<HTMLInputElement>('textColor');
  const fontFamilySelect = el<HTMLSelectElement>('fontFamily');
  const visualizerColorInput = el<HTMLInputElement>('visualizerColor');
  const visualizerStyleSelect = el<HTMLSelectElement>('visualizerStyle');
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

    setStatus('Decoding audio…');
    playBtn.disabled = true;
    renderBtn.disabled = true;

    const objectUrl = URL.createObjectURL(file);
    audioElement.src = objectUrl;

    try {
      const buffer = await decodeAudioFile(audioEngine.audioContext, file);
      state.audioBuffer = buffer;
      state.waveformPeaks = computePeaks(buffer, WAVEFORM_COLUMNS);
      playBtn.disabled = false;
      renderBtn.disabled = false;
      setStatus('Ready.');
    } catch (err) {
      setStatus('Could not decode this audio file.');
    }
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

  bgColorInput.addEventListener('input', () => {
    state.backgroundColor = bgColorInput.value;
  });
  bgZoomInput.addEventListener('input', () => {
    state.backgroundZoom = parseFloat(bgZoomInput.value);
  });
  bgBlurInput.addEventListener('input', () => {
    state.backgroundBlurPx = parseFloat(bgBlurInput.value);
  });

  artistNameInput.addEventListener('input', () => {
    state.artistName = artistNameInput.value;
  });
  songTitleInput.addEventListener('input', () => {
    state.songTitle = songTitleInput.value;
  });
  textColorInput.addEventListener('input', () => {
    state.textColor = textColorInput.value;
  });
  fontFamilySelect.addEventListener('change', () => {
    state.fontFamily = fontFamilySelect.value;
  });

  visualizerColorInput.addEventListener('input', () => {
    state.visualizerColor = visualizerColorInput.value;
  });
  visualizerStyleSelect.addEventListener('change', () => {
    state.visualizerStyle = visualizerStyleSelect.value as VisualizerStyle;
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
    if (!state.audioBuffer) return;

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

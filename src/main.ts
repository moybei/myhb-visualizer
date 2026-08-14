import { createInitialState } from './state';
import { AudioEngine } from './audioEngine';
import { drawScene } from './renderer';
import { setupControls } from './controls';
import { LiveWaveformHistory } from './liveWaveform';

// 240 samples at 8 samples/frame = 30 frames of history = 0.5s sweep at 60fps.
const WAVEFORM_HISTORY_LENGTH = 240;
const WAVEFORM_CHUNK_SIZE = 8;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const audioElement = document.getElementById('audioEl') as HTMLAudioElement;

if (!ctx) {
  throw new Error('Canvas 2D context is not available in this browser.');
}

const state = createInitialState();
const audioEngine = new AudioEngine(audioElement);
const waveformHistory = new LiveWaveformHistory(WAVEFORM_HISTORY_LENGTH, WAVEFORM_CHUNK_SIZE);

setupControls({ state, audioEngine, audioElement, canvas });

// Single continuous render loop: always redraws every frame (idle or playing),
// so any control change shows up on the very next frame with no separate
// "renderOnce" code path needed.
function loop(): void {
  const freqData = state.isPlaying ? audioEngine.getFrequencyData() : null;
  if (state.isPlaying) {
    waveformHistory.pushFromRaw(audioEngine.getTimeDomainSnapshot());
  } else {
    waveformHistory.pushSilence();
  }

  const duration = audioElement.duration;
  const playedFraction = duration && Number.isFinite(duration) && duration > 0 ? audioElement.currentTime / duration : 0;

  drawScene(ctx!, state, freqData, waveformHistory.data, playedFraction, audioEngine.audioContext.sampleRate);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

import type { WaveformPeaks } from './state';

/** Decode an audio File into a full PCM AudioBuffer (used once for waveform peaks). */
export async function decodeAudioFile(audioContext: AudioContext, file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

/**
 * Downsample the first channel into `numColumns` {min, max} pairs — a classic
 * SoundCloud-style waveform peak table. Computed once per audio file; the renderer
 * just recolors this per frame based on playback progress, no recomputation needed.
 */
export function computePeaks(buffer: AudioBuffer, numColumns: number): WaveformPeaks {
  const channelData = buffer.getChannelData(0);
  const min = new Float32Array(numColumns);
  const max = new Float32Array(numColumns);
  const samplesPerColumn = Math.max(1, Math.floor(channelData.length / numColumns));

  for (let col = 0; col < numColumns; col++) {
    const start = col * samplesPerColumn;
    const end = col === numColumns - 1 ? channelData.length : Math.min(channelData.length, start + samplesPerColumn);
    let colMin = 0;
    let colMax = 0;
    for (let i = start; i < end; i++) {
      const v = channelData[i];
      if (v < colMin) colMin = v;
      if (v > colMax) colMax = v;
    }
    min[col] = colMin;
    max[col] = colMax;
  }

  return { min, max };
}

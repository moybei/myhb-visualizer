/**
 * Fixed-length rolling buffer of real audio sample values (-1..1) driving the
 * scrolling live waveform trace. Each frame a small chunk — a downsampled
 * slice of the analyser's current raw waveform — is appended at the right
 * (newest) end, and every existing sample shifts left by the chunk size. The
 * buffer only spans a fraction of a second, so a transient (kick) sweeps
 * across the whole displayed width almost instantly instead of crawling
 * across over several seconds, while still reading as a real scrolling
 * oscilloscope trace rather than a single static frame.
 */
export class LiveWaveformHistory {
  private readonly buffer: Float32Array;
  private readonly chunkSize: number;

  constructor(length: number, chunkSize: number) {
    if (length % chunkSize !== 0) {
      throw new Error('LiveWaveformHistory length must be a multiple of chunkSize');
    }
    this.buffer = new Float32Array(length);
    this.chunkSize = chunkSize;
  }

  /** Downsamples `rawSamples` to this history's chunk size and pushes it in. */
  pushFromRaw(rawSamples: Float32Array): void {
    this.buffer.copyWithin(0, this.chunkSize);
    const offset = this.buffer.length - this.chunkSize;
    const stride = rawSamples.length / this.chunkSize;
    for (let i = 0; i < this.chunkSize; i++) {
      this.buffer[offset + i] = rawSamples[Math.floor(i * stride)];
    }
  }

  /** Shifts in silence — used while nothing is playing so the trace settles flat. */
  pushSilence(): void {
    this.buffer.copyWithin(0, this.chunkSize);
    this.buffer.fill(0, this.buffer.length - this.chunkSize);
  }

  get data(): Float32Array {
    return this.buffer;
  }
}

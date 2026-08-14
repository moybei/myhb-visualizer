/**
 * Fixed-length rolling buffer of per-frame audio amplitude, used to drive the
 * scrolling live waveform. `push` shifts every existing sample one slot toward
 * index 0 and writes the newest sample into the last slot — so index 0 is the
 * oldest sample (drawn at the leftmost pixel) and the last index is the newest
 * sample (drawn at the rightmost pixel). Because the shift happens every frame,
 * a spike entering on the right visibly travels left over the following frames.
 */
export class LiveWaveformHistory {
  private readonly buffer: Float32Array;

  constructor(length: number) {
    this.buffer = new Float32Array(length);
  }

  push(amplitude: number): void {
    this.buffer.copyWithin(0, 1);
    this.buffer[this.buffer.length - 1] = amplitude;
  }

  get data(): Float32Array {
    return this.buffer;
  }
}

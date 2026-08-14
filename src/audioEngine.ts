// Wraps the Web Audio graph for a single <audio> element:
//   audioElement -> MediaElementAudioSourceNode -> AnalyserNode -> GainNode -> [speakers, MediaStreamAudioDestinationNode]
//
// createMediaElementSource() can only be called once per <audio> element, so this
// engine is constructed exactly once at startup and reused for every loaded file
// (loading a new song just changes audioElement.src, not the element itself).
export class AudioEngine {
  readonly audioContext: AudioContext;
  readonly analyser: AnalyserNode;
  readonly gainNode: GainNode;
  readonly streamDestination: MediaStreamAudioDestinationNode;
  private readonly freqData: Uint8Array<ArrayBuffer>;
  private readonly timeDomainData: Float32Array<ArrayBuffer>;

  constructor(audioElement: HTMLAudioElement) {
    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioContextCtor();

    this.analyser = this.audioContext.createAnalyser();
    // 1024 gives crisp bar separation without the CPU cost of a larger FFT.
    // Smoothing is kept low here on purpose: the analyser's own smoothing
    // dampens both rises AND falls equally, which blunts real transients
    // (kick/snare) before they even reach the renderer. The renderer applies
    // its own fast-attack/slow-release envelope per bar instead, so motion
    // still looks calm without flattening hits at the source.
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.4;
    // getByteFrequencyData() is already dB-scaled (log), linearly mapped from
    // minDecibels..maxDecibels into 0..255. The default window (-100 to -30dB)
    // sits high enough that normal program material already reads "loud" before
    // any further shaping — narrowing + raising it does the log-domain work
    // properly (floor cuts normal/ambient level to near-zero, ceiling requires
    // a real hit to approach 255) instead of faking it with a post-hoc power
    // curve on top of already-log data. These are starting points — nudge them
    // by ear/eye once tested against a real track.
    this.analyser.minDecibels = -60;
    this.analyser.maxDecibels = -20;

    this.gainNode = this.audioContext.createGain();
    this.streamDestination = this.audioContext.createMediaStreamDestination();
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeDomainData = new Float32Array(this.analyser.fftSize);

    const sourceNode = this.audioContext.createMediaElementSource(audioElement);
    sourceNode.connect(this.analyser);
    this.analyser.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.connect(this.streamDestination);
  }

  /** Must be called synchronously inside a user-gesture handler (click) on both Chrome and Safari. */
  async resume(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /** Returns a reused Uint8Array — do not hold onto the reference across frames. */
  getFrequencyData(): Uint8Array<ArrayBuffer> {
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  /**
   * Raw current waveform snapshot (~fftSize samples spanning a few tens of ms,
   * range -1..1). Returns a reused Float32Array — read it before the next call.
   */
  getTimeDomainSnapshot(): Float32Array<ArrayBuffer> {
    this.analyser.getFloatTimeDomainData(this.timeDomainData);
    return this.timeDomainData;
  }
}

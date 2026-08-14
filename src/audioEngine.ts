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

  constructor(audioElement: HTMLAudioElement) {
    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioContextCtor();

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    this.gainNode = this.audioContext.createGain();
    this.streamDestination = this.audioContext.createMediaStreamDestination();
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

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
}

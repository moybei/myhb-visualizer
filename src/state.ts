export type BackgroundMode = 'color' | 'image' | 'blurredAlbumArt';
export type VisualizerStyle = 'bars' | 'mirroredBars' | 'line';

export interface AppState {
  albumArtImage: HTMLImageElement | null;

  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundImage: HTMLImageElement | null;
  backgroundZoom: number;
  backgroundBlurPx: number;

  artistName: string;
  songTitle: string;
  textColor: string;
  fontFamily: string;

  visualizerColor: string;
  visualizerStyle: VisualizerStyle;

  hasAudio: boolean;

  isPlaying: boolean;
  isRecording: boolean;
}

export function createInitialState(): AppState {
  return {
    albumArtImage: null,

    backgroundMode: 'color',
    backgroundColor: '#000000',
    backgroundImage: null,
    backgroundZoom: 1.15,
    backgroundBlurPx: 18,

    artistName: '',
    songTitle: '',
    textColor: '#ffffff',
    fontFamily: "'Helvetica Neue', Arial, sans-serif",

    visualizerColor: '#ffffff',
    visualizerStyle: 'line',

    hasAudio: false,

    isPlaying: false,
    isRecording: false,
  };
}

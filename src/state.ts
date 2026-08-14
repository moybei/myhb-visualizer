export type BackgroundMode = 'color' | 'image' | 'blurredAlbumArt';
export type VisualizerStyle = 'bars' | 'mirroredBars';

export interface AppState {
  albumArtImage: HTMLImageElement | null;

  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundImage: HTMLImageElement | null;
  backgroundZoom: number;
  backgroundBlurPx: number;
  backgroundBrightness: number;

  artistName: string;
  songTitle: string;
  titleSubtitle: string;
  textColor: string;
  fontFamily: string;

  visualizerColor: string;
  /** Once true, visualizerColor is independent; until then it follows textColor (the theme color). */
  visualizerColorCustomized: boolean;
  visualizerStyle: VisualizerStyle;
  spectrumMinHz: number;
  spectrumMaxHz: number;

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
    backgroundBrightness: 100,

    artistName: '',
    songTitle: '',
    titleSubtitle: '',
    textColor: '#ffffff',
    fontFamily: "'Zen Kaku Gothic Antique', sans-serif",

    visualizerColor: '#ffffff',
    visualizerColorCustomized: false,
    visualizerStyle: 'bars',
    spectrumMinHz: 0,
    spectrumMaxHz: 3000,

    hasAudio: false,

    isPlaying: false,
    isRecording: false,
  };
}

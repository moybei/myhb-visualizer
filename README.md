# myhb-visualizer

A personal, fully client-side music-visualizer video maker. Upload a song and
album art, customize the background/text/colors, and export a 1080p/60fps
video ready to upload to YouTube — nothing ever leaves your browser.

## Layout

- Album art in a bordered square on the left.
- "Original Artist" / "Title" / "Waveform" fields stacked on the right — the
  waveform shows the whole track's shape with a moving progress fill as the
  song plays.
- A full-width animated spectrum bar across the bottom that reacts live to the
  music.

## Local development

```bash
npm install
npm run dev
```

Open the printed `localhost` URL in Chrome or Safari.

## Using it

1. Upload an audio file and album art.
2. Pick a background: plain color, a custom image, or a blurred/zoomed version
   of the album art (with zoom/blur sliders).
3. Type the artist name and song title, and pick text/visualizer colors.
4. Hit **Play** to preview.
5. Hit **Render Video** to record — this takes exactly as long as the song, so
   keep the tab in the foreground until it finishes, then use the download
   link that appears.

## Notes on exporting

- Export records the canvas + audio live in real time (`canvas.captureStream`
  + `MediaRecorder`), at ~40 Mbps for strong 1080p60 quality.
- **Chrome and Safari will likely produce different output files** (e.g. `.mp4`
  h264/aac vs `.webm` vp9/opus) from the same session — pick one browser as
  your "real" export browser once you're happy with a test render.
- Do a short test render first to confirm quality/sync before rendering a full
  song.

## Deploying to GitHub Pages

Push to `main` on GitHub — `.github/workflows/deploy.yml` builds and deploys
automatically. One-time setup: in the repo's Settings → Pages, set the source
to "GitHub Actions". The app will be served at
`https://<your-username>.github.io/myhb-visualizer/`.

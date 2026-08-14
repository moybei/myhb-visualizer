import { parseBlob, selectCover } from 'music-metadata';

export interface ExtractedMetadata {
  artist?: string;
  title?: string;
  albumArtImage?: HTMLImageElement;
}

/**
 * Best-effort ID3/Vorbis/MP4 tag read (artist, title, embedded cover art) from
 * an audio file, for autofill only — the caller decides what to do with a
 * partial or empty result, and the user can always edit the fields afterward.
 * Throws if the file has no readable tags at all; callers should catch this.
 */
export async function extractMetadata(file: File): Promise<ExtractedMetadata> {
  const metadata = await parseBlob(file);
  const { common } = metadata;

  const result: ExtractedMetadata = {
    artist: common.artist || common.albumartist || undefined,
    title: common.title || undefined,
  };

  const cover = selectCover(common.picture);
  if (cover) {
    // Re-wrap in a fresh Uint8Array<ArrayBuffer> — cover.data's buffer type is
    // too loose (ArrayBufferLike) for BlobPart under strict TS lib typings.
    const blob = new Blob([new Uint8Array(cover.data)], { type: cover.format });
    const url = URL.createObjectURL(blob);
    result.albumArtImage = await loadImageFromUrl(url);
  }

  return result;
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load embedded cover art'));
    img.src = url;
  });
}

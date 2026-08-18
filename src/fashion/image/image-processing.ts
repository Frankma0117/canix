import { runFfmpeg } from '../../audio/ffmpeg.js';

/**
 * Resizes/compresses a garment photo (JPEG/PNG/WebP in, always JPEG out) via the same
 * ffmpeg-static spawn pattern already used for audio conversion and sticker generation (see
 * audio/ffmpeg.ts, util/stickers.ts) - deliberately NOT sharp/jimp, which this project has already
 * avoided once for native-binding/Node-version risk (see util/stickers.ts's comment). `-f mjpeg`
 * (not `image2`) is required for a single still frame piped to stdout - `image2` expects a
 * filename pattern and errors on `pipe:1`.
 */
function resize(input: Buffer, maxDimension: number, quality: number): Promise<Buffer> {
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vf',
      `scale='min(${maxDimension},iw)':'min(${maxDimension},ih)':force_original_aspect_ratio=decrease`,
      '-q:v',
      String(quality),
      '-f',
      'mjpeg',
      'pipe:1',
    ],
    input,
  );
}

/** A downscaled, compressed copy for the vision-analysis step only - the original stored in
 *  Spaces is never touched/replaced. 768px is generous headroom over what a CLIP-family model
 *  needs internally (~224-336px), so nothing is lost for classification purposes. */
export function toAnalysisCopy(input: Buffer): Promise<Buffer> {
  return resize(input, 768, 4);
}

/** A small thumbnail for future wardrobe-listing/detail display. */
export function toThumbnail(input: Buffer): Promise<Buffer> {
  return resize(input, 256, 6);
}

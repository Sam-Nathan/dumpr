// Browser prepare step: md5 (spark-md5, incremental over File.slice), display/thumb JPEGs via
// createImageBitmap + canvas, blurhash from a 32 px canvas (@dumpr/core encoder).
import {
  DISPLAY_LONG_EDGE,
  DISPLAY_QUALITY,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
  UploadError,
  contentHashFromMd5Hex,
  encodeBlurhash,
} from '@dumpr/core';
import SparkMD5 from 'spark-md5';

const MD5_CHUNK = 4 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

export function guessMime(type: string, name: string): string {
  const t = type.toLowerCase();
  if (t.startsWith('image/')) return t === 'image/jpg' ? 'image/jpeg' : t;
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? (t || 'application/octet-stream');
}

export function isHeic(mime: string): boolean {
  return mime === 'image/heic' || mime === 'image/heif';
}

/** Long edge scaled down to `longEdge` (never up). */
export function fitSize(w: number, h: number, longEdge: number): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export async function md5ContentHash(file: Blob, signal?: AbortSignal): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  for (let off = 0; off < file.size; off += MD5_CHUNK) {
    if (signal?.aborted) throw new UploadError('cancelled');
    spark.append(await file.slice(off, Math.min(off + MD5_CHUNK, file.size)).arrayBuffer());
  }
  return contentHashFromMd5Hex(spark.end());
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: AnyContext } {
  let canvas: AnyCanvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
  else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d') as AnyContext | null;
  if (!ctx) throw new UploadError('prepare_failed', { message: 'no 2d context' });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

async function toJpeg(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new UploadError('prepare_failed'))),
      'image/jpeg',
      quality,
    ),
  );
}

async function renderJpeg(bitmap: ImageBitmap, longEdge: number, quality: number): Promise<Blob> {
  const { width, height } = fitSize(bitmap.width, bitmap.height, longEdge);
  const { canvas, ctx } = makeCanvas(width, height);
  // JPEG has no alpha: paint transparent PNG/WebP areas white instead of black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return toJpeg(canvas, quality);
}

function blurhashOf(bitmap: ImageBitmap): string | null {
  try {
    const { width, height } = fitSize(bitmap.width, bitmap.height, 32);
    const { ctx } = makeCanvas(width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return encodeBlurhash(ctx.getImageData(0, 0, width, height).data, width, height, 4, 3);
  } catch {
    return null;
  }
}

export interface PreparedMedia {
  mime: string;
  contentHash: string;
  width: number;
  height: number;
  display: Blob;
  thumb: Blob;
  blurhash: string | null;
}

/**
 * Throws UploadError: `heic_unsupported` when the browser cannot decode a HEIC/HEIF (we cannot make
 * the display/thumb variants, so the file is flagged instead of uploaded), `unsupported_type` for
 * other undecodable files.
 */
export async function prepareFile(file: File, signal?: AbortSignal): Promise<PreparedMedia> {
  const mime = guessMime(file.type, file.name);
  if (!mime.startsWith('image/')) throw new UploadError('unsupported_type');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new UploadError(isHeic(mime) ? 'heic_unsupported' : 'unsupported_type');
  }
  try {
    if (signal?.aborted) throw new UploadError('cancelled');
    const display = await renderJpeg(bitmap, DISPLAY_LONG_EDGE, DISPLAY_QUALITY);
    const thumb = await renderJpeg(bitmap, THUMB_LONG_EDGE, THUMB_QUALITY);
    const blurhash = blurhashOf(bitmap);
    const contentHash = await md5ContentHash(file, signal);
    return {
      mime,
      contentHash,
      width: bitmap.width,
      height: bitmap.height,
      display,
      thumb,
      blurhash,
    };
  } finally {
    bitmap.close();
  }
}

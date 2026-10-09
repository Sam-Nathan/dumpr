// Prepare step: working copy, md5 of the original, display (2048) + thumb (480) JPEGs, blurhash.
// Works in Expo Go: expo-file-system (File#md5), expo-image-manipulator, expo-image's
// generateBlurhashAsync are all part of the Expo Go runtime.
import {
  DISPLAY_LONG_EDGE,
  DISPLAY_QUALITY,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
  UploadError,
  contentHashFromMd5Hex,
} from '@dumpr/core';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { UploadRow } from './db.ts';

export function uploadsRoot(): Directory {
  return new Directory(Paths.document, 'dumpr-uploads');
}

export function itemDir(id: string): Directory {
  return new Directory(uploadsRoot(), id);
}

/** Deletes our working copies for an item. Never touches the source the app handed us. */
export function deleteWorkingFiles(id: string): void {
  try {
    const dir = itemDir(id);
    if (dir.exists) dir.delete();
  } catch {
    // best effort
  }
}

/** Deletes the large working copies (original copy, display) but keeps the thumb for the C4 row. */
export function deleteLargeWorkingFiles(
  row: Pick<UploadRow, 'local_uri' | 'source_uri' | 'display_uri'>,
): void {
  for (const uri of [row.local_uri, row.display_uri]) {
    if (!uri || uri === row.source_uri || !uri.startsWith(uploadsRoot().uri)) continue;
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // best effort
    }
  }
}

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

export function extOf(name: string | null | undefined): string {
  const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(name ?? '');
  return m ? m[1]!.toLowerCase() : '';
}

export function guessMime(
  mime: string | null | undefined,
  ...names: (string | null | undefined)[]
): string {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return m === 'image/jpg' ? 'image/jpeg' : m;
  for (const n of names) {
    const byExt = EXT_MIME[extOf(n)];
    if (byExt) return byExt;
  }
  return 'image/jpeg';
}

/** EXIF "2026:03:12 18:20:00" or ISO → ISO string; anything unparseable → null. */
export function normalizeTakenAt(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = v.trim();
  if (/^\d{4}:\d{2}:\d{2}[ T]\d{2}:\d{2}/.test(s))
    s = s.replace(/^(\d{4}):(\d{2}):(\d{2})[ T]/, '$1-$2-$3T');
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const year = new Date(t).getUTCFullYear();
  return year >= 1900 && year <= 2200 ? new Date(t).toISOString() : null;
}

function hexOf(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function md5Of(file: File): Promise<string> {
  let hex: string | null = null;
  try {
    hex = file.info({ md5: true }).md5 ?? file.md5;
  } catch {
    hex = null;
  }
  if (!hex) {
    // Fallback: hash the bytes in JS land (expo-crypto). Only used if the native md5 is unavailable.
    hex = hexOf(await Crypto.digest(Crypto.CryptoDigestAlgorithm.MD5, await file.bytes()));
  }
  return contentHashFromMd5Hex(hex);
}

function fit(w: number, h: number, longEdge: number): { width?: number; height?: number } | null {
  if (Math.max(w, h) <= longEdge) return null;
  return w >= h ? { width: longEdge } : { height: longEdge };
}

async function renderJpeg(
  source: Parameters<typeof ImageManipulator.manipulate>[0],
  w: number,
  h: number,
  longEdge: number,
  quality: number,
  dest: File,
): Promise<{ uri: string; bytes: number }> {
  const ctx = ImageManipulator.manipulate(source);
  const size = fit(w, h, longEdge);
  if (size) ctx.resize(size);
  const ref = await ctx.renderAsync();
  try {
    const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: quality });
    const tmp = new File(out.uri);
    if (dest.exists) dest.delete();
    tmp.moveSync(dest);
    return { uri: dest.uri, bytes: dest.size };
  } finally {
    ref.release();
    ctx.release();
  }
}

export type PreparedFields = Pick<
  UploadRow,
  | 'local_uri'
  | 'mime'
  | 'bytes'
  | 'width'
  | 'height'
  | 'content_hash'
  | 'display_uri'
  | 'display_bytes'
  | 'thumb_uri'
  | 'thumb_bytes'
  | 'blurhash'
>;

export function isPrepared(r: UploadRow): boolean {
  if (
    !r.content_hash ||
    !r.display_uri ||
    !r.thumb_uri ||
    !r.bytes ||
    !r.display_bytes ||
    !r.thumb_bytes
  )
    return false;
  try {
    return (
      new File(r.local_uri).exists && new File(r.display_uri).exists && new File(r.thumb_uri).exists
    );
  } catch {
    return false;
  }
}

export async function prepareItem(row: UploadRow, signal: AbortSignal): Promise<PreparedFields> {
  const dir = itemDir(row.id);
  dir.create({ intermediates: true, idempotent: true });

  // 1. Working copy, so the queue survives the OS clearing picker/camera caches.
  let local = row.local_uri;
  const insideRoot = local.startsWith(uploadsRoot().uri);
  if (!insideRoot || !new File(local).exists) {
    const src = new File(row.source_uri);
    if (!src.exists) throw new UploadError('file_missing');
    const ext = extOf(row.file_name) || extOf(row.source_uri) || 'jpg';
    const copy = new File(dir, `original.${ext}`);
    try {
      if (copy.exists) copy.delete();
      await src.copy(copy);
      local = copy.uri;
    } catch {
      local = row.source_uri; // keep going from the source; never fail the photo over a copy
    }
  }
  if (signal.aborted) throw new UploadError('cancelled');

  const file = new File(local);
  if (!file.exists) throw new UploadError('file_missing');
  const bytes = file.size;
  if (!bytes) throw new UploadError('file_missing');
  const contentHash = row.content_hash ?? (await md5Of(file));
  if (signal.aborted) throw new UploadError('cancelled');

  // 2. Decode once for the real (orientation-corrected) size, then derive the variants.
  let width: number;
  let height: number;
  let display: { uri: string; bytes: number };
  let thumb: { uri: string; bytes: number };
  try {
    const base = await ImageManipulator.manipulate(local).renderAsync();
    try {
      width = base.width;
      height = base.height;
      display = await renderJpeg(
        base,
        width,
        height,
        DISPLAY_LONG_EDGE,
        DISPLAY_QUALITY,
        new File(dir, 'display.jpg'),
      );
      thumb = await renderJpeg(
        base,
        width,
        height,
        THUMB_LONG_EDGE,
        THUMB_QUALITY,
        new File(dir, 'thumb.jpg'),
      );
    } finally {
      base.release();
    }
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError('prepare_failed', {
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // 3. Blurhash from the thumb (expo-image computes it natively; optional).
  let blurhash: string | null = row.blurhash;
  if (!blurhash) {
    try {
      blurhash = await Image.generateBlurhashAsync(thumb.uri, [4, 3]);
    } catch {
      blurhash = null;
    }
  }

  return {
    local_uri: local,
    mime: guessMime(row.mime, row.file_name, row.source_uri),
    bytes,
    width,
    height,
    content_hash: contentHash,
    display_uri: display.uri,
    display_bytes: display.bytes,
    thumb_uri: thumb.uri,
    thumb_bytes: thumb.bytes,
    blurhash: blurhash && blurhash.length <= 100 ? blurhash : null,
  };
}

// Cloudflare R2 (S3-compatible) helpers: presigned URLs (SigV4 query signing) and the few
// server-side calls we need (multipart lifecycle, HEAD, DELETE). Never proxies photo bytes.
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import type { R2Config } from './env.ts';

export interface R2 {
  /**
   * Presigned single PUT. `content-type` and `content-length` are part of the signature (X-Amz-SignedHeaders),
   * so R2 rejects a request that sends another type or a body of another length.
   */
  presignPut(key: string, opts: { contentType: string; contentLength: number; expiresIn?: number }): Promise<string>;
  /**
   * Presigned GET. `signedAt` pins the SigV4 timestamp (X-Amz-Date): with the same key, `signedAt` and options the
   * URL is byte-identical, so callers that round it down (to the hour) hand out cache-stable URLs.
   * `cacheControl` becomes `response-cache-control` (R2 answers with that Cache-Control header).
   */
  presignGet(
    key: string,
    opts?: { expiresIn?: number; downloadName?: string; signedAt?: Date; cacheControl?: string },
  ): Promise<string>;
  createMultipart(key: string, contentType: string): Promise<string>;
  /** Presigned multipart part; `content-length` is signed, so a part is exactly `contentLength` bytes. */
  presignPart(key: string, uploadId: string, partNumber: number, contentLength: number, expiresIn?: number): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** null when the object does not exist. */
  headObject(key: string): Promise<{ size: number; etag: string; contentType: string | null } | null>;
  deleteObjects(keys: string[]): Promise<{ deleted: number; failed: string[] }>;
}

const DEFAULT_TTL = 60 * 60; // 1 h

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function assertLength(n: number): void {
  if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError('contentLength must be a positive integer');
}

export function createR2(cfg: R2Config): R2 {
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const objectUrl = (key: string) => new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);

  // aws4fetch leaves content-type / content-length out of X-Amz-SignedHeaders unless allHeaders is on; with
  // headers given we sign exactly those (plus host), otherwise only host (GET).
  async function presign(method: string, url: URL, expiresIn: number, headers?: Record<string, string>, signedAt?: Date) {
    url.searchParams.set('X-Amz-Expires', String(expiresIn));
    const signed = await aws.sign(url.toString(), {
      method,
      headers,
      aws: {
        signQuery: true,
        allHeaders: headers !== undefined,
        // aws4fetch takes 'YYYYMMDDTHHMMSSZ'; omitted = now
        ...(signedAt ? { datetime: signedAt.toISOString().replace(/[:-]|\.\d{3}/g, '') } : {}),
      },
    });
    return signed.url;
  }

  async function call(method: string, url: URL, body?: string, headers?: Record<string, string>) {
    const res = await aws.fetch(url.toString(), { method, body, headers });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`r2 ${method} ${res.status} ${text.slice(0, 200)}`);
    }
    return res;
  }

  return {
    presignPut(key, { contentType, contentLength, expiresIn = DEFAULT_TTL }) {
      assertLength(contentLength);
      // Content-Type and Content-Length are signed: the client must send exactly this type and this many bytes.
      return presign('PUT', objectUrl(key), expiresIn, {
        'content-type': contentType,
        'content-length': String(contentLength),
      });
    },
    presignGet(key, { expiresIn = DEFAULT_TTL, downloadName, signedAt, cacheControl } = {}) {
      const url = objectUrl(key);
      if (downloadName) {
        url.searchParams.set('response-content-disposition', `attachment; filename="${downloadName.replace(/"/g, '')}"`);
      }
      if (cacheControl) url.searchParams.set('response-cache-control', cacheControl);
      return presign('GET', url, expiresIn, undefined, signedAt);
    },
    async createMultipart(key, contentType) {
      const url = objectUrl(key);
      url.searchParams.set('uploads', '');
      const res = await call('POST', url, undefined, { 'content-type': contentType });
      const xml = await res.text();
      const m = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
      if (!m) throw new Error('r2 createMultipart: no UploadId');
      return m[1];
    },
    presignPart(key, uploadId, partNumber, contentLength, expiresIn = DEFAULT_TTL * 6) {
      assertLength(contentLength);
      const url = objectUrl(key);
      url.searchParams.set('partNumber', String(partNumber));
      url.searchParams.set('uploadId', uploadId);
      return presign('PUT', url, expiresIn, { 'content-length': String(contentLength) });
    },
    async completeMultipart(key, uploadId, parts) {
      const url = objectUrl(key);
      url.searchParams.set('uploadId', uploadId);
      const body =
        '<CompleteMultipartUpload>' +
        [...parts]
          .sort((a, b) => a.n - b.n)
          .map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag.replace(/[<>&]/g, '')}</ETag></Part>`)
          .join('') +
        '</CompleteMultipartUpload>';
      const res = await call('POST', url, body, { 'content-type': 'application/xml' });
      const text = await res.text();
      if (res.status === 404 || text.includes('<Error>')) throw new Error('r2 completeMultipart failed');
    },
    async abortMultipart(key, uploadId) {
      const url = objectUrl(key);
      url.searchParams.set('uploadId', uploadId);
      await call('DELETE', url);
    },
    async headObject(key) {
      const res = await call('HEAD', objectUrl(key));
      if (res.status === 404) return null;
      return {
        size: Number(res.headers.get('content-length') ?? 0),
        etag: (res.headers.get('etag') ?? '').replace(/"/g, ''),
        contentType: res.headers.get('content-type'),
      };
    },
    async deleteObjects(keys) {
      const failed: string[] = [];
      let deleted = 0;
      // Small fixed concurrency; R2 DELETE is idempotent (404 counts as deleted).
      const queue = [...keys];
      const worker = async () => {
        for (let k = queue.shift(); k !== undefined; k = queue.shift()) {
          try {
            await call('DELETE', objectUrl(k));
            deleted++;
          } catch {
            failed.push(k);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, keys.length) }, worker));
      return { deleted, failed };
    },
  };
}

/** R2 keys (architecture §3). Built server-side only. */
export const mediaKeys = {
  original: (crewId: string, rollId: string, photoId: string) => `o/${crewId}/${rollId}/${photoId}`,
  display: (crewId: string, rollId: string, photoId: string) => `d/${crewId}/${rollId}/${photoId}.jpg`,
  thumb: (crewId: string, rollId: string, photoId: string) => `t/${crewId}/${rollId}/${photoId}.jpg`,
  avatar: (userId: string, id: string) => `a/${userId}/${id}.jpg`,
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const AVATAR_KEY_RE = new RegExp(`^a/(${UUID})/${UUID}\\.jpg$`, 'i');

/** The user an avatar key belongs to (`a/<user id>/<uuid>.jpg`), lowercase; null for any other key shape. */
export function avatarKeyOwner(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const m = AVATAR_KEY_RE.exec(key);
  return m ? m[1].toLowerCase() : null;
}

/**
 * True when `key` is exactly an avatar key of `userId`. profiles.avatar_key is client-writable, so every
 * place that signs or purges an avatar key must check this (never trust the column on its own).
 */
export function isAvatarKeyOf(userId: string, key: unknown): key is string {
  const owner = avatarKeyOwner(key);
  return owner !== null && owner === String(userId).toLowerCase();
}

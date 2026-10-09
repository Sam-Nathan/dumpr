// Cloudflare R2 (S3-compatible) helpers: presigned URLs (SigV4 query signing) and the few
// server-side calls we need (multipart lifecycle, HEAD, DELETE). Never proxies photo bytes.
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import type { R2Config } from './env.ts';

export interface R2 {
  presignPut(key: string, opts: { contentType: string; expiresIn?: number }): Promise<string>;
  presignGet(key: string, opts?: { expiresIn?: number; downloadName?: string }): Promise<string>;
  createMultipart(key: string, contentType: string): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number, expiresIn?: number): Promise<string>;
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

export function createR2(cfg: R2Config): R2 {
  const aws = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const objectUrl = (key: string) => new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);

  async function presign(method: string, url: URL, expiresIn: number, headers?: Record<string, string>) {
    url.searchParams.set('X-Amz-Expires', String(expiresIn));
    const signed = await aws.sign(url.toString(), { method, headers, aws: { signQuery: true, allHeaders: false } });
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
    presignPut(key, { contentType, expiresIn = DEFAULT_TTL }) {
      // Content-Type is signed: the client must send exactly this header.
      return presign('PUT', objectUrl(key), expiresIn, { 'content-type': contentType });
    },
    presignGet(key, { expiresIn = DEFAULT_TTL, downloadName } = {}) {
      const url = objectUrl(key);
      if (downloadName) {
        url.searchParams.set('response-content-disposition', `attachment; filename="${downloadName.replace(/"/g, '')}"`);
      }
      return presign('GET', url, expiresIn);
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
    presignPart(key, uploadId, partNumber, expiresIn = DEFAULT_TTL * 6) {
      const url = objectUrl(key);
      url.searchParams.set('partNumber', String(partNumber));
      url.searchParams.set('uploadId', uploadId);
      return presign('PUT', url, expiresIn);
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

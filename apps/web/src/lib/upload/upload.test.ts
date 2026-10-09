import { UploadError, type UploadInitResponse, type UploadTransport } from '@dumpr/core';
import { describe, expect, it } from 'vitest';
import { createWebUploader, hasActiveUploads, type WebUploadItem } from './index';
import { fitSize, guessMime, isHeic, md5ContentHash } from './media';
import type { PreparedMedia } from './media';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await tick(5);
  }
}

const prepared = (): PreparedMedia => ({
  mime: 'image/jpeg',
  contentHash: 'md5:0123456789abcdef0123456789abcdef',
  width: 10,
  height: 10,
  display: new Blob(['d']),
  thumb: new Blob(['t']),
  blurhash: null,
});

function setup(
  opts: { failInit?: (call: number) => UploadError | null; prepareError?: UploadError } = {},
) {
  let concurrent = 0;
  let maxConcurrent = 0;
  let initCalls = 0;
  let n = 0;
  const transport = (): UploadTransport => ({
    async init(req): Promise<UploadInitResponse> {
      const err = opts.failInit?.(initCalls++);
      if (err) throw err;
      return {
        status: 'upload',
        photo_id: req.photo_id,
        original: { mode: 'put', url: 'u', headers: {} },
        display: { url: 'u', headers: {} },
        thumb: { url: 'u', headers: {} },
        expires_at: '',
      };
    },
    async putVariant(_v, _t, onProgress) {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await tick(10);
      onProgress(1);
      concurrent--;
      return { etag: null };
    },
    async putPart() {
      return { etag: 'e' };
    },
    async complete(req) {
      return { status: 'ready', photo: { id: req.photo_id } as never };
    },
  });
  const up = createWebUploader(
    { supabaseUrl: 'https://x', anonKey: 'k', getAccessToken: async () => 't' },
    {
      prepare: async () => {
        if (opts.prepareError) throw opts.prepareError;
        return prepared();
      },
      transport,
      uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      isOnline: () => true,
      createObjectURL: () => 'blob:x',
      revokeObjectURL: () => {},
    },
  );
  let items: WebUploadItem[] = [];
  up.subscribe((i) => (items = i));
  return { up, items: () => items, maxConcurrent: () => maxConcurrent };
}

const file = (name: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

describe('createWebUploader', () => {
  it('uploads everything with at most 3 at a time', async () => {
    const s = setup();
    s.up.add([file('a.jpg'), file('b.jpg'), file('c.jpg'), file('d.jpg'), file('e.jpg')], {
      rollId: 'r',
    });
    expect(s.items()).toHaveLength(5);
    expect(hasActiveUploads()).toBe(true);
    await until(() => s.items().every((i) => i.state === 'done'));
    expect(s.maxConcurrent()).toBeLessThanOrEqual(3);
    expect(s.items().every((i) => i.progress === 1 && i.bytes === 100)).toBe(true);
  });

  it('flags HEIC the browser cannot decode as blocked', async () => {
    const s = setup({ prepareError: new UploadError('heic_unsupported') });
    s.up.add([file('IMG_1.HEIC')], { rollId: 'r' });
    await until(() => s.items()[0]?.state === 'blocked');
    expect(s.items()[0]!.errorCode).toBe('heic_unsupported');
  });

  it('blocked server codes stop; a manual retry runs again', async () => {
    let fail = true;
    const s = setup({ failInit: () => (fail ? new UploadError('uploads_disabled') : null) });
    s.up.add([file('a.jpg')], { rollId: 'r' });
    await until(() => s.items()[0]?.state === 'blocked');
    expect(s.items()[0]!.errorCode).toBe('uploads_disabled');
    fail = false;
    s.up.retry(s.items()[0]!.id);
    await until(() => s.items()[0]?.state === 'done');
  });

  it('retryable errors back off (failed with a code)', async () => {
    const s = setup({ failInit: () => new UploadError('internal') });
    s.up.add([file('a.jpg')], { rollId: 'r' });
    await until(() => s.items()[0]?.state === 'failed');
    expect(s.items()[0]!.errorCode).toBe('internal');
    s.up.cancel(s.items()[0]!.id);
  });

  it('cancel removes the item', async () => {
    const s = setup();
    s.up.add([file('a.jpg')], { rollId: 'r' });
    s.up.cancel(s.items()[0]!.id);
    expect(s.items()).toHaveLength(0);
  });
});

describe('media helpers', () => {
  it('guessMime / isHeic', () => {
    expect(guessMime('', 'IMG_1.HEIC')).toBe('image/heic');
    expect(guessMime('image/jpg', 'x')).toBe('image/jpeg');
    expect(guessMime('', 'a.png')).toBe('image/png');
    expect(isHeic('image/heif')).toBe(true);
  });

  it('fitSize never upscales', () => {
    expect(fitSize(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitSize(3000, 4000, 480)).toEqual({ width: 360, height: 480 });
    expect(fitSize(100, 50, 480)).toEqual({ width: 100, height: 50 });
  });

  it('md5ContentHash matches known digests, across chunk boundaries', async () => {
    expect(await md5ContentHash(new Blob(['']))).toBe('md5:d41d8cd98f00b204e9800998ecf8427e');
    expect(await md5ContentHash(new Blob(['The quick brown fox jumps over the lazy dog']))).toBe(
      'md5:9e107d9d372bb6826bd81d3542a419d6',
    );
    const big = new Uint8Array(9 * 1024 * 1024).fill(97);
    const { createHash } = await import('node:crypto');
    const want = createHash('md5').update(big).digest('hex');
    expect(await md5ContentHash(new Blob([big]))).toBe(`md5:${want}`);
  });
});

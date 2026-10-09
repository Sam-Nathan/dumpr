import { describe, expect, it } from 'vitest';
import { MiB } from './constants.ts';
import { UploadError } from './errors.ts';
import type { PartRange } from './parts.ts';
import {
  emptyProgress,
  runUpload,
  type PreparedUpload,
  type UploadProgressState,
  type UploadTransport,
} from './pipeline.ts';
import type { PresignedPut, UploadInitRequest, UploadInitResponse, UploadPartEtag, UploadVariant } from './types.ts';

const MD5 = '0123456789abcdef0123456789abcdef';
const job = (patch: Partial<PreparedUpload> = {}): PreparedUpload => ({
  photoId: 'p1',
  rollId: 'r1',
  contentHash: `md5:${MD5}`,
  mime: 'image/jpeg',
  bytes: 1000,
  width: 10,
  height: 10,
  displayBytes: 100,
  thumbBytes: 10,
  blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  ...patch,
});

const put = (name: string): PresignedPut => ({ url: `https://r2/${name}`, headers: { 'content-type': 'image/jpeg' } });

interface Calls {
  init: UploadInitRequest[];
  puts: UploadVariant[];
  parts: number[];
  complete: { photo_id: string; parts?: UploadPartEtag[]; blurhash?: string | null }[];
}

function fakeTransport(opts: {
  initResponses?: UploadInitResponse[];
  completeErrors?: UploadError[];
  putFail?: (v: UploadVariant, call: number) => UploadError | null;
  partFail?: (n: number, call: number) => UploadError | null;
  etag?: (v: UploadVariant) => string | null;
}) {
  const calls: Calls = { init: [], puts: [], parts: [], complete: [] };
  let initCall = 0;
  let completeCall = 0;
  let putCall = 0;
  let partCall = 0;
  const t: UploadTransport = {
    async init(req) {
      calls.init.push(req);
      const r = opts.initResponses ?? [];
      return r[Math.min(initCall++, r.length - 1)]!;
    },
    async putVariant(v, _target, onProgress) {
      const err = opts.putFail?.(v, putCall++);
      if (err) throw err;
      calls.puts.push(v);
      onProgress(1);
      return { etag: opts.etag ? opts.etag(v) : v === 'original' ? `"${MD5}"` : '"x"' };
    },
    async putPart(part: PartRange, _url, onProgress) {
      const err = opts.partFail?.(part.n, partCall++);
      if (err) throw err;
      calls.parts.push(part.n);
      onProgress(part.end - part.start);
      return { etag: `"etag-${part.n}"` };
    },
    async complete(req) {
      calls.complete.push(req);
      const errs = opts.completeErrors ?? [];
      const e = errs[completeCall++];
      if (e) throw e;
      return {
        status: 'ready',
        photo: { id: req.photo_id } as never,
      };
    },
  };
  return { t, calls };
}

const uploadRes = (patch: Partial<Extract<UploadInitResponse, { status: 'upload' }>> = {}): UploadInitResponse => ({
  status: 'upload',
  photo_id: 'p1',
  original: { mode: 'put', ...put('o') },
  display: put('d'),
  thumb: put('t'),
  expires_at: new Date(0).toISOString(),
  ...patch,
});

const multipartRes = (uploadId: string, partSize = 8 * MiB, count = 3): UploadInitResponse =>
  uploadRes({
    original: {
      mode: 'multipart',
      upload_id: uploadId,
      part_size: partSize,
      parts: Array.from({ length: count }, (_, i) => ({ n: i + 1, url: `https://r2/part${i + 1}` })),
    },
  });

describe('runUpload', () => {
  it('uploads thumb → display → original and completes', async () => {
    const { t, calls } = fakeTransport({ initResponses: [uploadRes()] });
    const saved: UploadProgressState[] = [];
    const stages: string[] = [];
    const res = await runUpload(job(), emptyProgress(), t, {
      saveProgress: (p) => void saved.push(p),
      onStage: (s) => void stages.push(s),
    });
    expect(res).toEqual({ kind: 'done', status: 'ready', response: { status: 'ready', photo: { id: 'p1' } } });
    expect(calls.puts).toEqual(['thumb', 'display', 'original']);
    expect(stages).toEqual(['initiating', 'uploading', 'completing']);
    expect(saved.at(-1)).toEqual({ variantsDone: ['thumb', 'display', 'original'], multipart: null });
    expect(calls.init[0]).toMatchObject({ photo_id: 'p1', roll_id: 'r1', display_bytes: 100, thumb_bytes: 10, chapter_id: null });
    expect(calls.complete[0]).toEqual({ photo_id: 'p1', blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj' });
  });

  it('skips variants already uploaded in an earlier attempt', async () => {
    const { t, calls } = fakeTransport({ initResponses: [uploadRes()] });
    await runUpload(job({ blurhash: null }), { variantsDone: ['thumb', 'display'], multipart: null }, t);
    expect(calls.puts).toEqual(['original']);
    expect(calls.complete[0]).toEqual({ photo_id: 'p1' });
  });

  it('returns duplicate, or done when the duplicate is this photo', async () => {
    const dup = fakeTransport({ initResponses: [{ status: 'duplicate', existing_photo_id: 'other' }] });
    expect(await runUpload(job(), emptyProgress(), dup.t)).toEqual({ kind: 'duplicate', existingPhotoId: 'other' });
    expect(dup.calls.puts).toEqual([]);
    const self = fakeTransport({ initResponses: [{ status: 'duplicate', existing_photo_id: 'p1' }] });
    expect(await runUpload(job(), emptyProgress(), self.t)).toEqual({ kind: 'done', status: 'ready', response: null });
  });

  it('rejects an original whose ETag is not the expected md5', async () => {
    const { t } = fakeTransport({ initResponses: [uploadRes()], etag: (v) => (v === 'original' ? '"deadbeef"' : null) });
    await expect(runUpload(job(), emptyProgress(), t)).rejects.toMatchObject({ code: 'checksum_mismatch' });
  });

  it('accepts a missing ETag (CORS not exposing it) — the server verifies anyway', async () => {
    const { t } = fakeTransport({ initResponses: [uploadRes()], etag: () => null });
    expect((await runUpload(job(), emptyProgress(), t)).kind).toBe('done');
  });

  it('uploads multipart parts, persists each, and sends them sorted to complete', async () => {
    const bytes = 20 * MiB;
    const { t, calls } = fakeTransport({ initResponses: [multipartRes('U1')] });
    const saved: UploadProgressState[] = [];
    const progress: number[] = [];
    await runUpload(job({ bytes }), emptyProgress(), t, {
      saveProgress: (p) => void saved.push(p),
      onProgress: (s) => void progress.push(s),
    });
    expect(calls.parts).toEqual([1, 2, 3]);
    expect(calls.puts).toEqual(['thumb', 'display']);
    expect(calls.complete[0]!.parts).toEqual([
      { n: 1, etag: '"etag-1"' },
      { n: 2, etag: '"etag-2"' },
      { n: 3, etag: '"etag-3"' },
    ]);
    expect(saved.at(-1)!.multipart).toEqual({
      uploadId: 'U1',
      partSize: 8 * MiB,
      partsDone: [
        { n: 1, etag: '"etag-1"' },
        { n: 2, etag: '"etag-2"' },
        { n: 3, etag: '"etag-3"' },
      ],
    });
    expect(Math.max(...progress)).toBe(bytes + 110);
    // monotonic
    for (let i = 1; i < progress.length; i++) expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]! - 0);
  });

  it('resumes a multipart upload at the next part with the same upload id', async () => {
    const { t, calls } = fakeTransport({ initResponses: [multipartRes('U1')] });
    const prior: UploadProgressState = {
      variantsDone: ['thumb', 'display'],
      multipart: { uploadId: 'U1', partSize: 8 * MiB, partsDone: [{ n: 1, etag: 'e1' }] },
    };
    await runUpload(job({ bytes: 20 * MiB }), prior, t);
    expect(calls.puts).toEqual([]);
    expect(calls.parts).toEqual([2, 3]);
    expect(calls.complete[0]!.parts!.map((p) => p.n)).toEqual([1, 2, 3]);
  });

  it('starts over when the server hands out a new multipart upload id', async () => {
    const { t, calls } = fakeTransport({ initResponses: [multipartRes('U2')] });
    const prior: UploadProgressState = {
      variantsDone: ['thumb'],
      multipart: { uploadId: 'U1', partSize: 8 * MiB, partsDone: [{ n: 1, etag: 'e1' }] },
    };
    await runUpload(job({ bytes: 20 * MiB }), prior, t);
    expect(calls.parts).toEqual([1, 2, 3]);
    expect(calls.puts).toEqual(['display']);
  });

  it('retries a failing part a few times before giving up', async () => {
    const sleeps: number[] = [];
    const flaky = fakeTransport({
      initResponses: [multipartRes('U1')],
      partFail: (n, call) => (n === 2 && call < 3 ? new UploadError('network') : null),
    });
    await runUpload(job({ bytes: 20 * MiB }), emptyProgress(), flaky.t, {
      sleep: async (ms) => void sleeps.push(ms),
      partRetries: 4,
    });
    expect(flaky.calls.parts).toEqual([1, 2, 3]);
    expect(sleeps).toEqual([1000, 2000]);

    const dead = fakeTransport({ initResponses: [multipartRes('U1')], partFail: (n) => (n === 2 ? new UploadError('network') : null) });
    const saved: UploadProgressState[] = [];
    await expect(
      runUpload(job({ bytes: 20 * MiB }), emptyProgress(), dead.t, {
        sleep: async () => {},
        saveProgress: (p) => void saved.push(p),
      }),
    ).rejects.toMatchObject({ code: 'network' });
    // part 1 is remembered for the next attempt
    expect(saved.at(-1)!.multipart!.partsDone).toEqual([{ n: 1, etag: '"etag-1"' }]);
  });

  it('does not retry a part on a blocked error', async () => {
    const { t } = fakeTransport({ initResponses: [multipartRes('U1')], partFail: () => new UploadError('storage_full') });
    const sleeps: number[] = [];
    await expect(
      runUpload(job({ bytes: 20 * MiB }), emptyProgress(), t, { sleep: async (ms) => void sleeps.push(ms) }),
    ).rejects.toMatchObject({ code: 'storage_full' });
    expect(sleeps).toEqual([]);
  });

  it('re-sends only the variants upload-complete reports missing', async () => {
    const { t, calls } = fakeTransport({
      initResponses: [uploadRes()],
      completeErrors: [new UploadError('upload_incomplete', { status: 422, details: { missing: ['display'] } })],
    });
    const res = await runUpload(job(), emptyProgress(), t);
    expect(res.kind).toBe('done');
    expect(calls.init).toHaveLength(2);
    expect(calls.puts).toEqual(['thumb', 'display', 'original', 'display']);
    expect(calls.complete).toHaveLength(2);
  });

  it('restart_multipart drops the old upload id; reset_parts re-sends every part', async () => {
    const restart = fakeTransport({
      initResponses: [multipartRes('U1'), multipartRes('U2')],
      completeErrors: [
        new UploadError('upload_incomplete', { details: { missing: ['original'], restart_multipart: true } }),
      ],
    });
    await runUpload(job({ bytes: 20 * MiB }), emptyProgress(), restart.t);
    expect(restart.calls.parts).toEqual([1, 2, 3, 1, 2, 3]);

    const reset = fakeTransport({
      initResponses: [multipartRes('U1')],
      completeErrors: [new UploadError('upload_incomplete', { details: { missing: ['original'], reset_parts: true } })],
    });
    await runUpload(job({ bytes: 20 * MiB }), emptyProgress(), reset.t);
    expect(reset.calls.parts).toEqual([1, 2, 3, 1, 2, 3]);
    expect(reset.calls.puts).toEqual(['thumb', 'display']);
  });

  it('gives up with upload_incomplete after three rounds', async () => {
    const e = () => new UploadError('upload_incomplete', { details: { missing: ['thumb'] } });
    const { t, calls } = fakeTransport({ initResponses: [uploadRes()], completeErrors: [e(), e(), e()] });
    await expect(runUpload(job(), emptyProgress(), t)).rejects.toMatchObject({ code: 'upload_incomplete' });
    expect(calls.init).toHaveLength(3);
  });

  it('propagates other complete errors', async () => {
    const { t } = fakeTransport({ initResponses: [uploadRes()], completeErrors: [new UploadError('uploads_disabled')] });
    await expect(runUpload(job(), emptyProgress(), t)).rejects.toMatchObject({ code: 'uploads_disabled' });
  });

  it('stops with cancelled when the signal aborts', async () => {
    const signal = { aborted: false };
    const { t, calls } = fakeTransport({
      initResponses: [uploadRes()],
      putFail: (v) => {
        if (v === 'display') signal.aborted = true;
        return null;
      },
    });
    await expect(runUpload(job(), emptyProgress(), t, { signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls.puts).toEqual(['thumb', 'display']);
    expect(calls.complete).toHaveLength(0);
  });

  it('does not mutate the progress it was given', async () => {
    const { t } = fakeTransport({ initResponses: [uploadRes()] });
    const prior = emptyProgress();
    await runUpload(job(), prior, t);
    expect(prior).toEqual({ variantsDone: [], multipart: null });
  });
});

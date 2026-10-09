// Browser uploader for the guest web flow (A5). In-memory queue (the tab must stay open — use
// hasActiveUploads() for a beforeunload warning), 3 concurrent items, the shared @dumpr/core
// pipeline + state machine, XHR PUTs for byte progress, multipart for originals > 16 MiB.
import {
  NETWORK_CODES,
  UPLOAD_CONCURRENCY,
  UploadError,
  emptyProgress,
  errorFromResponse,
  isActive,
  isRunnable,
  itemProgress,
  runUpload,
  toUploadError,
  transition,
  type PartRange,
  type PresignedPut,
  type UploadEvent,
  type UploadItemState,
  type UploadProgressState,
  type UploadTransport,
} from '@dumpr/core';
import { prepareFile, type PreparedMedia } from './media';

export interface WebUploadItem {
  id: string;
  name: string;
  /** UploadState kind: queued|preparing|initiating|uploading|completing|done|duplicate|failed|blocked|paused */
  state: string;
  /** 0..1 */
  progress: number;
  errorCode?: string;
  previewUrl: string;
  /** Original size in bytes. */
  bytes: number;
}

export interface WebUploaderOptions {
  supabaseUrl: string;
  anonKey: string;
  getAccessToken: () => Promise<string | null>;
}

export interface WebUploader {
  add(files: File[], target: { rollId: string }): void;
  subscribe(fn: (items: WebUploadItem[]) => void): () => void;
  retry(id: string): void;
  cancel(id: string): void;
}

/** Test seams. */
export interface WebUploaderDeps {
  prepare?: (file: File, signal: AbortSignal) => Promise<PreparedMedia>;
  transport?: (
    item: { file: File; prepared: PreparedMedia },
    signal: AbortSignal,
  ) => UploadTransport;
  uuid?: () => string;
  isOnline?: () => boolean;
  createObjectURL?: (b: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

interface Entry extends UploadItemState {
  id: string;
  file: File;
  rollId: string;
  previewUrl: string;
  prepared: PreparedMedia | null;
  progressState: UploadProgressState;
  ctrl: AbortController | null;
}

const live = new Set<() => boolean>();

/** True while any uploader on the page still has work (show a beforeunload warning). */
export function hasActiveUploads(): boolean {
  for (const f of live) if (f()) return true;
  return false;
}

// ------------------------------------------------------------------ browser transport

/**
 * PUT a blob to a presigned URL. The URL signs Content-Type and the exact body length: send exactly the
 * `headers` upload-init returned and a body of the signed `content-length` (the browser derives the
 * Content-Length header from the Blob; it cannot be set by script).
 */
function xhrPut(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  signedLength: number | undefined,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
): Promise<{ etag: string | null }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new UploadError('cancelled'));
    if (typeof signedLength === 'number' && body.size !== signedLength) {
      return reject(
        new UploadError('file_missing', {
          message: `file is ${body.size} bytes, the upload was signed for ${signedLength}`,
        }),
      );
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    const onAbort = () => xhr.abort();
    signal.addEventListener('abort', onAbort);
    const done = () => signal.removeEventListener('abort', onAbort);
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve({ etag: xhr.getResponseHeader('ETag') });
      else if (xhr.status === 403) reject(new UploadError('url_expired', { status: 403 }));
      else reject(new UploadError('put_failed', { status: xhr.status }));
    };
    xhr.onerror = () => {
      done();
      reject(new UploadError('network'));
    };
    xhr.ontimeout = () => {
      done();
      reject(new UploadError('timeout'));
    };
    xhr.onabort = () => {
      done();
      reject(new UploadError('cancelled'));
    };
    xhr.send(body);
  });
}

function browserTransport(opts: WebUploaderOptions) {
  async function call<T>(name: string, body: unknown, signal: AbortSignal): Promise<T> {
    let token: string | null;
    try {
      token = await opts.getAccessToken();
    } catch {
      token = null;
    }
    if (!token) throw new UploadError('not_authenticated');
    let res: Response;
    try {
      res = await fetch(`${opts.supabaseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: opts.anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      throw new UploadError(signal.aborted ? 'cancelled' : 'network');
    }
    const parsed = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw errorFromResponse(res.status, parsed);
    return parsed as T;
  }

  return (item: { file: File; prepared: PreparedMedia }, signal: AbortSignal): UploadTransport => ({
    init: (req) => call('upload-init', req, signal),
    complete: (req) => call('upload-complete', req, signal),
    putVariant: (v, target: PresignedPut, onProgress) => {
      const blob =
        v === 'thumb' ? item.prepared.thumb : v === 'display' ? item.prepared.display : item.file;
      return xhrPut(target.url, blob, target.headers, target.content_length, onProgress, signal);
    },
    putPart: (part: PartRange, url, onProgress) =>
      xhrPut(
        url,
        item.file.slice(part.start, part.end),
        {},
        part.end - part.start,
        onProgress,
        signal,
      ),
  });
}

// ------------------------------------------------------------------ the uploader

export function createWebUploader(
  options: WebUploaderOptions,
  deps: WebUploaderDeps = {},
): WebUploader {
  const prepare = deps.prepare ?? prepareFile;
  const makeTransport = deps.transport ?? browserTransport(options);
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const isOnline =
    deps.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const createURL = deps.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b));
  const revokeURL = deps.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));

  const entries = new Map<string, Entry>();
  const subs = new Set<(items: WebUploadItem[]) => void>();
  let running = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let emitQueued = false;
  let view: WebUploadItem[] = [];

  const toView = (e: Entry): WebUploadItem => {
    const s = e.state;
    const v: WebUploadItem = {
      id: e.id,
      name: e.file.name,
      state: s.kind,
      progress: itemProgress(s),
      previewUrl: e.previewUrl,
      bytes: e.file.size,
    };
    if (s.kind === 'failed' || s.kind === 'blocked') v.errorCode = s.code;
    else if (s.kind === 'paused') v.errorCode = s.reason;
    return v;
  };

  const emitNow = () => {
    emitQueued = false;
    view = [...entries.values()].map(toView);
    for (const fn of subs) fn(view);
  };
  const emit = (immediate: boolean) => {
    if (immediate) return emitNow();
    if (emitQueued) return;
    emitQueued = true;
    setTimeout(emitNow, 100);
  };

  const dispatch = (id: string, ev: UploadEvent) => {
    const e = entries.get(id);
    if (!e) return;
    const next = transition(e, ev);
    if (next === e) return;
    entries.set(id, next);
    emit(ev.type !== 'progress');
  };

  const hasWork = () =>
    [...entries.values()].some(
      (e) =>
        isActive(e.state.kind) ||
        e.state.kind === 'queued' ||
        e.state.kind === 'paused' ||
        (e.state.kind === 'failed' && e.state.retryAt !== null),
    );
  live.add(hasWork);

  function scheduleTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
    let next = Infinity;
    for (const e of entries.values())
      if (e.state.kind === 'failed' && e.state.retryAt !== null)
        next = Math.min(next, e.state.retryAt);
    if (next !== Infinity) timer = setTimeout(pump, Math.max(250, next - Date.now()));
  }

  function pump() {
    const now = Date.now();
    if (!isOnline()) {
      for (const e of entries.values())
        if (!isActive(e.state.kind)) dispatch(e.id, { type: 'pause', reason: 'no_network' });
      return;
    }
    for (const e of [...entries.values()]) {
      if (e.state.kind === 'paused') dispatch(e.id, { type: 'resume' });
      else if (e.state.kind === 'failed') dispatch(e.id, { type: 'due', now });
    }
    for (const e of entries.values()) {
      if (running >= UPLOAD_CONCURRENCY) break;
      if (isRunnable(e.state, now) && !e.ctrl) start(e.id);
    }
    scheduleTimer();
  }

  function start(id: string) {
    const e = entries.get(id)!;
    const ctrl = new AbortController();
    entries.set(id, { ...e, ctrl });
    running++;
    void run(id, ctrl).finally(() => {
      running--;
      const cur = entries.get(id);
      if (cur && cur.ctrl === ctrl) entries.set(id, { ...cur, ctrl: null });
      pump();
    });
  }

  async function run(id: string, ctrl: AbortController) {
    const signal = ctrl.signal;
    try {
      let e = entries.get(id)!;
      if (!e.prepared) {
        dispatch(id, { type: 'prepare' });
        const prepared = await prepare(e.file, signal);
        e = entries.get(id)!;
        if (!e || signal.aborted) return;
        const thumbUrl = createURL(prepared.thumb);
        revokeURL(e.previewUrl);
        entries.set(id, { ...e, prepared, previewUrl: thumbUrl });
        dispatch(id, { type: 'prepared' });
      } else {
        dispatch(id, { type: 'initiate' });
      }
      e = entries.get(id)!;
      const p = e.prepared!;
      const result = await runUpload(
        {
          photoId: id,
          rollId: e.rollId,
          contentHash: p.contentHash,
          mime: p.mime,
          bytes: e.file.size,
          width: p.width,
          height: p.height,
          takenAt: null,
          displayBytes: p.display.size,
          thumbBytes: p.thumb.size,
          blurhash: p.blurhash,
        },
        e.progressState,
        makeTransport({ file: e.file, prepared: p }, signal),
        {
          signal,
          onStage: (stage, info) => {
            if (stage === 'uploading')
              dispatch(id, {
                type: 'upload_started',
                totalBytes: info.totalBytes,
                sentBytes: info.sentBytes,
              });
            else if (stage === 'completing') dispatch(id, { type: 'uploaded' });
          },
          onProgress: (sentBytes) => dispatch(id, { type: 'progress', sentBytes }),
          saveProgress: (progressState) => {
            const cur = entries.get(id);
            if (cur) entries.set(id, { ...cur, progressState });
          },
        },
      );
      if (signal.aborted) return;
      if (result.kind === 'duplicate') {
        dispatch(id, { type: 'duplicate', existingPhotoId: result.existingPhotoId, photoId: id });
      } else {
        if (entries.get(id)?.state.kind === 'initiating')
          dispatch(id, { type: 'upload_started', totalBytes: 1, sentBytes: 1 });
        if (entries.get(id)?.state.kind === 'uploading') dispatch(id, { type: 'uploaded' });
        dispatch(id, { type: 'completed', status: result.status });
      }
    } catch (err) {
      if (signal.aborted) return;
      const u = toUploadError(err);
      if (u.code === 'cancelled') return;
      if (NETWORK_CODES.has(u.code) && !isOnline()) {
        dispatch(id, { type: 'pause', reason: 'no_network' });
        return;
      }
      dispatch(id, { type: 'error', code: u.code, now: Date.now() });
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', pump);
    window.addEventListener('offline', pump);
  }

  return {
    add(files, target) {
      for (const file of files) {
        const id = uuid().toLowerCase();
        entries.set(id, {
          id,
          file,
          rollId: target.rollId,
          previewUrl: createURL(file),
          prepared: null,
          progressState: emptyProgress(),
          ctrl: null,
          state: { kind: 'queued' },
          attempt: 0,
        });
      }
      emit(true);
      pump();
    },
    subscribe(fn) {
      subs.add(fn);
      fn(view);
      return () => {
        subs.delete(fn);
      };
    },
    retry(id) {
      dispatch(id, { type: 'retry' });
      pump();
    },
    cancel(id) {
      const e = entries.get(id);
      if (!e) return;
      e.ctrl?.abort();
      entries.delete(id);
      revokeURL(e.previewUrl);
      emit(true);
      pump();
    },
  };
}

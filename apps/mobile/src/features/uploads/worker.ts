// The upload worker: an in-memory mirror of the sqlite queue, a gate (pause / offline / Wi-Fi
// only), 3 concurrent items, backoff timers, and resume after restarts.
//
// Risk #05 ("lost photos destroy trust"): every step is persisted before moving on, mid-flight
// items come back as queued after a crash, and nothing here ever deletes the source the app
// handed us — only our own working copies under documentDirectory/dumpr-uploads/<id>/.
import {
  NETWORK_CODES,
  UPLOAD_CONCURRENCY,
  emptyProgress,
  isActive,
  isRunnable,
  isTerminal,
  itemProgress,
  runUpload,
  stateFromRecord,
  stateToRecord,
  summarizeUploads,
  toUploadError,
  transition,
  type PauseReason,
  type UploadEvent,
  type UploadItemState,
  type UploadProgressState,
  type UploadState,
  type UploadSummary,
} from '@dumpr/core';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { AppState } from 'react-native';
import {
  deleteRows,
  getSetting,
  insertRows,
  loadAllRows,
  parseParts,
  parseVariants,
  setSetting,
  updateRow,
  type UploadRow,
} from './db.ts';
import {
  deleteLargeWorkingFiles,
  deleteWorkingFiles,
  extOf,
  guessMime,
  isPrepared,
  itemDir,
  normalizeTakenAt,
  prepareItem,
} from './prepare.ts';
import { isPurgeableUri } from './queueRules.ts';
import { refreshRollPhotos, type RollPhotosQueryClient } from '../rolls/pages.ts';
import { createMobileTransport } from './transport.ts';

export type EnqueueAsset = {
  uri: string;
  width?: number;
  height?: number;
  takenAt?: string | null;
  mime?: string;
  fileName?: string;
  bytes?: number;
};

export type UploadItemView = {
  id: string;
  rollId: string;
  localUri: string;
  thumbUri?: string;
  state: UploadState['kind'];
  progress: number;
  bytes: number;
  errorCode?: string;
  attempt: number;
  /** ms timestamp of the last state change (a `done` tile is retained briefly after this). */
  updatedAt: number;
  /** Extra, optional detail for C4 rows. */
  fileName?: string;
  /** failed: ms timestamp of the next automatic retry (null = needs a manual retry). */
  retryAt?: number | null;
  /** paused: why. */
  pauseReason?: PauseReason;
  /** duplicate: the photo already in the Roll. */
  existingPhotoId?: string;
};

export interface UploadQueueSnapshot {
  items: UploadItemView[];
  summary: UploadSummary;
  paused: boolean;
  wifiOnly: boolean;
}

type Item = UploadItemState & { row: UploadRow };

/** Done/duplicate/cancelled rows are kept this long for the C4 list, then pruned. */
const KEEP_FINISHED_MS = 24 * 60 * 60 * 1000;

const items = new Map<string, Item>();
const running = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let settings = { paused: false, wifiOnly: false };
let net = { online: true, wifi: true };
let loaded: Promise<void> | null = null;
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let pumpQueued = false;
let snapshotById = new Map<string, UploadItemView>();
let snapshot: UploadQueueSnapshot = {
  items: [],
  summary: summarizeUploads([]),
  paused: false,
  wifiOnly: false,
};

// ---------------------------------------------------------------- query invalidation

type QueryClientLike = RollPhotosQueryClient;
let queryClient: QueryClientLike | null = null;
const invalidateTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setUploadQueryClient(qc: QueryClientLike | null): void {
  queryClient = qc;
}

function invalidateRoll(rollId: string) {
  if (invalidateTimers.has(rollId)) return;
  // Coalesce a burst of completions (38 photos) into ~1 refetch per second per roll.
  invalidateTimers.set(
    rollId,
    setTimeout(() => {
      invalidateTimers.delete(rollId);
      try {
        // Page 1 only: keyset pages must stay contiguous and refetching every loaded page per upload is slow.
        if (queryClient) refreshRollPhotos(queryClient, rollId);
        void queryClient?.invalidateQueries({ queryKey: ['roll-header', rollId] });
      } catch {
        // ignore
      }
    }, 1000),
  );
}

// ---------------------------------------------------------------- snapshot + listeners

let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function toView(it: Item): UploadItemView {
  const s = it.state;
  const r = it.row;
  const v: UploadItemView = {
    id: r.id,
    rollId: r.roll_id,
    localUri: r.local_uri,
    state: s.kind,
    progress: itemProgress(s),
    bytes: r.bytes ?? 0,
    attempt: it.attempt,
    updatedAt: r.updated_at,
  };
  if (r.thumb_uri) v.thumbUri = r.thumb_uri;
  if (r.file_name) v.fileName = r.file_name;
  if (s.kind === 'failed') {
    v.errorCode = s.code;
    v.retryAt = s.retryAt;
  } else if (s.kind === 'blocked') v.errorCode = s.code;
  else if (s.kind === 'paused') v.pauseReason = s.reason;
  else if (s.kind === 'duplicate') v.existingPhotoId = s.existingPhotoId;
  return v;
}

function rebuildSnapshot() {
  const views = [...items.values()].map(toView);
  snapshotById = new Map(views.map((v) => [v.id, v]));
  snapshot = {
    items: views,
    summary: summarizeUploads(views),
    paused: settings.paused,
    wifiOnly: settings.wifiOnly,
  };
  for (const l of listeners) {
    try {
      l();
    } catch {
      // a broken listener must not stop the queue
    }
  }
}

function notify(immediate = false) {
  if (immediate) {
    if (notifyTimer) clearTimeout(notifyTimer);
    notifyTimer = null;
    rebuildSnapshot();
    return;
  }
  notifyTimer ??= setTimeout(() => {
    notifyTimer = null;
    rebuildSnapshot();
  }, 120);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): UploadQueueSnapshot {
  return snapshot;
}

/** 0..1 progress of one item, read from the current snapshot (a primitive, so tiles re-render alone). */
export function getItemProgress(id: string): number {
  return snapshotById.get(id)?.progress ?? 0;
}

// ---------------------------------------------------------------- state changes

function persist(id: string, patch: Partial<UploadRow>) {
  const it = items.get(id);
  const updatedAt = Date.now();
  if (it) it.row = { ...it.row, ...patch, updated_at: updatedAt };
  updateRow(id, { ...patch, updated_at: updatedAt }).catch((e) =>
    console.warn('upload queue write failed', e),
  );
}

function dispatch(id: string, event: UploadEvent): Item | undefined {
  const it = items.get(id);
  if (!it) return undefined;
  const next = transition(it, event);
  if (next === it) return it;
  items.set(id, next);
  if (event.type !== 'progress')
    persist(id, { ...stateToRecord(next.state), attempt: next.attempt });
  notify(event.type !== 'progress');
  return next;
}

// ---------------------------------------------------------------- gate

function gateReason(): PauseReason | null {
  if (settings.paused) return 'user';
  if (!net.online) return 'no_network';
  if (settings.wifiOnly && !net.wifi) return 'wifi_only';
  return null;
}

function applyNetworkState(s: Network.NetworkState) {
  const online = s.isConnected !== false && s.isInternetReachable !== false;
  const wifi =
    s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET;
  const changed = online !== net.online || wifi !== net.wifi;
  net = { online, wifi };
  if (changed) schedulePump();
}

async function refreshNetwork() {
  try {
    applyNetworkState(await Network.getNetworkStateAsync());
  } catch {
    // keep the last known state
  }
}

// ---------------------------------------------------------------- loading

function rowToItem(row: UploadRow): Item {
  return { row, attempt: row.attempt ?? 0, state: stateFromRecord(row) };
}

function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    const [rows, paused, wifiOnly] = await Promise.all([
      loadAllRows(),
      getSetting('paused'),
      getSetting('wifi_only'),
    ]);
    settings = { paused: paused === '1', wifiOnly: wifiOnly === '1' };
    const now = Date.now();
    const prune: string[] = [];
    for (const row of rows) {
      const it = rowToItem(row);
      if (isTerminal(it.state.kind) && now - row.updated_at > KEEP_FINISHED_MS) {
        prune.push(row.id);
        deleteWorkingFiles(row.id);
        continue;
      }
      if (!items.has(row.id)) items.set(row.id, it);
    }
    await deleteRows(prune).catch(() => {});
    notify(true);
  })();
  loaded.catch((e) => {
    console.warn('upload queue failed to load', e);
    loaded = null;
  });
  return loaded;
}

// ---------------------------------------------------------------- the pump

export function schedulePump() {
  if (pumpQueued) return;
  pumpQueued = true;
  setTimeout(() => {
    pumpQueued = false;
    void pump();
  }, 0);
}

async function pump() {
  try {
    await ensureLoaded();
  } catch {
    return;
  }
  const reason = gateReason();
  if (reason) {
    for (const [id, it] of items) {
      if (isTerminal(it.state.kind) || it.state.kind === 'blocked') continue;
      running.get(id)?.abort();
      dispatch(id, { type: 'pause', reason });
    }
    return;
  }
  const now = Date.now();
  for (const [id, it] of items) {
    if (it.state.kind === 'paused') dispatch(id, { type: 'resume' });
    else if (it.state.kind === 'failed') dispatch(id, { type: 'due', now });
  }
  const candidates = [...items.values()]
    .filter((it) => isRunnable(it.state, now) && !running.has(it.row.id))
    .sort((a, b) => a.row.created_at - b.row.created_at);
  for (const it of candidates) {
    if (running.size >= UPLOAD_CONCURRENCY) break;
    startItem(it.row.id);
  }
  scheduleRetryTimer();
}

function scheduleRetryTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
  let next = Infinity;
  for (const it of items.values()) {
    if (it.state.kind === 'failed' && it.state.retryAt !== null)
      next = Math.min(next, it.state.retryAt);
  }
  if (next === Infinity) return;
  timer = setTimeout(
    () => {
      timer = null;
      schedulePump();
    },
    Math.max(250, next - Date.now()),
  );
}

function startItem(id: string) {
  const ctrl = new AbortController();
  running.set(id, ctrl);
  void runItem(id, ctrl)
    .catch((e) => console.warn('upload item crashed', e))
    .finally(() => {
      if (running.get(id) === ctrl) running.delete(id);
      schedulePump();
    });
}

async function runItem(id: string, ctrl: AbortController) {
  const signal = ctrl.signal;
  try {
    let it = items.get(id);
    if (!it) return;
    if (isPrepared(it.row)) {
      dispatch(id, { type: 'initiate' });
    } else {
      dispatch(id, { type: 'prepare' });
      const fields = await prepareItem(it.row, signal);
      if (signal.aborted) return;
      persist(id, fields);
      dispatch(id, { type: 'prepared' });
    }
    it = items.get(id);
    if (!it || it.state.kind !== 'initiating') return;
    const r = it.row;
    const progress: UploadProgressState = {
      variantsDone: parseVariants(r.variants_done),
      multipart:
        r.upload_id && r.part_size
          ? { uploadId: r.upload_id, partSize: r.part_size, partsDone: parseParts(r.parts_done) }
          : emptyProgress().multipart,
    };
    const result = await runUpload(
      {
        photoId: r.id,
        rollId: r.roll_id,
        chapterId: r.chapter_id,
        contentHash: r.content_hash!,
        mime: r.mime ?? 'image/jpeg',
        bytes: r.bytes!,
        width: r.width,
        height: r.height,
        takenAt: r.taken_at,
        displayBytes: r.display_bytes!,
        thumbBytes: r.thumb_bytes!,
        blurhash: r.blurhash,
      },
      progress,
      createMobileTransport(
        { id: r.id, local_uri: r.local_uri, display_uri: r.display_uri!, thumb_uri: r.thumb_uri! },
        signal,
      ),
      {
        signal,
        onStage: (stage, info) => {
          if (stage === 'uploading') {
            dispatch(id, {
              type: 'upload_started',
              totalBytes: info.totalBytes,
              sentBytes: info.sentBytes,
            });
          } else if (stage === 'completing') dispatch(id, { type: 'uploaded' });
        },
        onProgress: (sentBytes) => dispatch(id, { type: 'progress', sentBytes }),
        saveProgress: (p) =>
          persist(id, {
            variants_done: JSON.stringify(p.variantsDone),
            upload_id: p.multipart?.uploadId ?? null,
            part_size: p.multipart?.partSize ?? null,
            parts_done: JSON.stringify(p.multipart?.partsDone ?? []),
          }),
      },
    );
    if (signal.aborted) return;
    if (result.kind === 'duplicate') {
      dispatch(id, { type: 'duplicate', existingPhotoId: result.existingPhotoId, photoId: id });
    } else {
      // Feed the reducer the steps the pipeline may have skipped (e.g. "already complete").
      const cur = items.get(id)?.state.kind;
      if (cur === 'initiating')
        dispatch(id, { type: 'upload_started', totalBytes: 1, sentBytes: 1 });
      if (items.get(id)?.state.kind === 'uploading') dispatch(id, { type: 'uploaded' });
      dispatch(id, { type: 'completed', status: result.status });
      const done = items.get(id);
      if (done) deleteLargeWorkingFiles(done.row);
    }
    invalidateRoll(r.roll_id);
  } catch (e) {
    if (signal.aborted) return; // paused or cancelled: the state was already set by whoever aborted
    const err = toUploadError(e);
    if (err.code === 'cancelled') return;
    if (NETWORK_CODES.has(err.code)) {
      await refreshNetwork();
      if (!net.online) {
        dispatch(id, { type: 'pause', reason: 'no_network' });
        return;
      }
    }
    dispatch(id, { type: 'error', code: err.code, now: Date.now() });
  }
}

// ---------------------------------------------------------------- public operations

let appStateSub: { remove(): void } | null = null;
let netSub: { remove(): void } | null = null;

export function startUploadWorker(): void {
  if (started) return;
  started = true;
  try {
    netSub = Network.addNetworkStateListener(applyNetworkState);
  } catch {
    netSub = null;
  }
  appStateSub = AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      void refreshNetwork();
      schedulePump();
    }
  });
  void refreshNetwork().finally(schedulePump);
}

/** For tests / sign-out: stops listeners and in-flight uploads (the queue stays on disk). */
export function stopUploadWorker(): void {
  started = false;
  netSub?.remove();
  appStateSub?.remove();
  netSub = appStateSub = null;
  for (const c of running.values()) c.abort();
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Copies a cache-directory file into `dumpr-uploads/<id>/`; returns the uri the row should work from. */
function securePurgeable(id: string, a: EnqueueAsset): string {
  try {
    if (!isPurgeableUri(a.uri, [Paths.cache.uri])) return a.uri;
    const src = new File(a.uri);
    if (!src.exists) return a.uri;
    const dir = itemDir(id);
    dir.create({ intermediates: true, idempotent: true });
    const copy = new File(dir, `original.${extOf(a.fileName) || extOf(a.uri) || 'jpg'}`);
    if (copy.exists) copy.delete();
    src.copy(copy);
    return copy.uri;
  } catch {
    return a.uri; // never fail the photo over a copy; prepareItem tries again
  }
}

export async function enqueueUploads(
  assets: EnqueueAsset[],
  target: { rollId: string; chapterId?: string | null },
): Promise<string[]> {
  await ensureLoaded();
  const now = Date.now();
  const ids = assets.map(() => Crypto.randomUUID().toLowerCase());
  // Camera shots (and picker copies) sit in the cache directory, which the OS can purge before the
  // worker prepares them: take our own copy right now, before returning.
  const locals = assets.map((a, i) => securePurgeable(ids[i]!, a));
  const rows: UploadRow[] = assets.map((a, i) => ({
    id: ids[i]!,
    roll_id: target.rollId,
    chapter_id: target.chapterId ?? null,
    source_uri: a.uri,
    local_uri: locals[i]!,
    file_name: a.fileName ?? null,
    mime: guessMime(a.mime, a.fileName, a.uri),
    bytes: a.bytes && a.bytes > 0 ? Math.round(a.bytes) : null,
    width: a.width ? Math.round(a.width) : null,
    height: a.height ? Math.round(a.height) : null,
    taken_at: normalizeTakenAt(a.takenAt),
    content_hash: null,
    display_uri: null,
    display_bytes: null,
    thumb_uri: null,
    thumb_bytes: null,
    blurhash: null,
    ...stateToRecord({ kind: 'queued' }),
    attempt: 0,
    variants_done: '[]',
    upload_id: null,
    part_size: null,
    parts_done: '[]',
    created_at: now + i, // keeps pick order stable
    updated_at: now,
  }));
  await insertRows(rows);
  for (const row of rows) items.set(row.id, rowToItem(row));
  notify(true);
  if (!started) startUploadWorker();
  schedulePump();
  return rows.map((r) => r.id);
}

export function retryUpload(id: string): void {
  dispatch(id, { type: 'retry' });
  schedulePump();
}

export function retryAllFailed(): void {
  for (const [id, it] of items)
    if (it.state.kind === 'failed' || it.state.kind === 'blocked') dispatch(id, { type: 'retry' });
  schedulePump();
}

export function cancelUpload(id: string): void {
  running.get(id)?.abort();
  dispatch(id, { type: 'cancel' });
  // Only our working copies; the user's photo stays where it was.
  deleteWorkingFiles(id);
  schedulePump();
}

/** Removes finished (done / duplicate / cancelled) rows from the list. */
export function clearFinishedUploads(): void {
  const ids = [...items.values()].filter((it) => isTerminal(it.state.kind)).map((it) => it.row.id);
  for (const id of ids) {
    items.delete(id);
    deleteWorkingFiles(id);
  }
  void deleteRows(ids).catch(() => {});
  notify(true);
}

export function setPaused(p: boolean): void {
  settings = { ...settings, paused: p };
  void setSetting('paused', p ? '1' : '0').catch(() => {});
  if (p) {
    for (const [id, it] of items) {
      if (isTerminal(it.state.kind) || it.state.kind === 'blocked') continue;
      running.get(id)?.abort();
      dispatch(id, { type: 'pause', reason: 'user' });
    }
  }
  notify(true);
  schedulePump();
}

export function setWifiOnly(v: boolean): void {
  settings = { ...settings, wifiOnly: v };
  void setSetting('wifi_only', v ? '1' : '0').catch(() => {});
  notify(true);
  void refreshNetwork().finally(schedulePump);
}

/** True while something is uploading or waiting to (background drain uses this). */
export function hasPendingWork(): boolean {
  for (const it of items.values()) {
    if (isActive(it.state.kind) || isRunnable(it.state, Date.now())) return true;
  }
  return running.size > 0;
}

/** Background task: run the queue for at most `budgetMs`, then return. */
export async function drainFor(budgetMs: number): Promise<void> {
  startUploadWorker();
  await ensureLoaded();
  await refreshNetwork();
  schedulePump();
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    if (!hasPendingWork()) return;
  }
}

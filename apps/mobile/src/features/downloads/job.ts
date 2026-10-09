/**
 * F1 download job: pages through a Roll's photos, signs originals in batches of 100, downloads to
 * the cache and saves into the gallery (album per Roll). A zustand store holds the progress so the
 * sheet and the You screen can both show it, and the descriptor + saved ids live in AsyncStorage so
 * an interrupted job resumes (skipping what is already saved).
 *
 * Runs while the app process lives (foreground / short background). If the app is killed the job
 * comes back as "Paused" and resumes from where it stopped.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { callFunction } from '../../data/functions';
import type { SignBatchResponse } from '../../data/signedUrlCache';
import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import { toast } from '../../ui/Toast';
import {
  albumName,
  chunk,
  DOWNLOAD_CONCURRENCY,
  extensionFor,
  remainingIds,
  savedKey,
  SIGN_BATCH,
  variantFor,
  type DownloadDescriptor,
} from './plan';
import { fetchAllRollPhotos } from './rollPhotos';

export type JobStatus = 'idle' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

interface DownloadStore {
  descriptor: DownloadDescriptor | null;
  status: JobStatus;
  total: number;
  done: number;
  /** Photos the server would not sign (removed, downloads off). */
  skipped: number;
  /** Why the job is waiting ("Waiting for Wi-Fi") or stopped. */
  note: string | null;
}

export const useDownloadStore = create<DownloadStore>(() => ({
  descriptor: null,
  status: 'idle',
  total: 0,
  done: 0,
  skipped: 0,
  note: null,
}));

const JOB_KEY = 'dumpr.dl.job';
let controller: AbortController | null = null;

const set = (p: Partial<DownloadStore>) => useDownloadStore.setState(p);

async function persistJob(): Promise<void> {
  const s = useDownloadStore.getState();
  if (!s.descriptor || s.status === 'idle' || s.status === 'done' || s.status === 'cancelled') {
    await AsyncStorage.removeItem(JOB_KEY).catch(() => undefined);
    return;
  }
  await AsyncStorage.setItem(
    JOB_KEY,
    JSON.stringify({ descriptor: s.descriptor, total: s.total, done: s.done }),
  ).catch(() => undefined);
}

/** Brings back an interrupted job as "Paused" (call when the You screen / download sheet opens). */
export async function restoreDownloadJob(): Promise<void> {
  if (useDownloadStore.getState().status !== 'idle') return;
  try {
    const raw = await AsyncStorage.getItem(JOB_KEY);
    if (!raw) return;
    const j = JSON.parse(raw) as { descriptor: DownloadDescriptor; total: number; done: number };
    if (!j.descriptor?.id) return;
    set({
      descriptor: j.descriptor,
      status: 'paused',
      total: j.total,
      done: j.done,
      note: 'Tap Resume to carry on',
    });
  } catch {
    // ignore a corrupt record
  }
}

async function loadSaved(d: DownloadDescriptor): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(savedKey(d));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function storeSaved(d: DownloadDescriptor, saved: Set<string>): Promise<void> {
  await AsyncStorage.setItem(savedKey(d), JSON.stringify([...saved])).catch(() => undefined);
}

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, 'dumpr-dl');
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch {
    // exists
  }
  return dir;
}

/** Permission to add photos to the gallery (write only). */
export async function ensureSavePermission(): Promise<'granted' | 'denied' | 'blocked'> {
  const cur = await MediaLibrary.getPermissionsAsync(true);
  if (cur.granted) return 'granted';
  const asked = await MediaLibrary.requestPermissionsAsync(true);
  if (asked.granted) return 'granted';
  return asked.canAskAgain === false ? 'blocked' : 'denied';
}

export async function hasSavePermission(): Promise<'granted' | 'undetermined' | 'blocked'> {
  try {
    const cur = await MediaLibrary.getPermissionsAsync(true);
    if (cur.granted) return 'granted';
    return cur.canAskAgain === false ? 'blocked' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

async function waitForNetwork(wifiOnly: boolean, signal: AbortSignal): Promise<void> {
  for (;;) {
    if (signal.aborted) return;
    try {
      const s = await Network.getNetworkStateAsync();
      const online = s.isConnected !== false && s.isInternetReachable !== false;
      const wifi =
        s.type === Network.NetworkStateType.WIFI || s.type === Network.NetworkStateType.ETHERNET;
      if (online && (!wifiOnly || wifi)) {
        if (useDownloadStore.getState().status === 'paused') set({ status: 'running', note: null });
        return;
      }
      set({ status: 'paused', note: online ? 'Waiting for Wi-Fi' : 'Waiting for network' });
    } catch {
      return; // cannot tell: try anyway
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

interface PhotoStub {
  id: string;
  mime: string;
}

async function listPhotos(
  d: DownloadDescriptor,
  meId: string | null,
  signal: AbortSignal,
): Promise<PhotoStub[]> {
  if (d.scope === 'roll' && d.rollId) {
    const refs = await fetchAllRollPhotos(d.rollId, {
      chapterId: d.chapterId,
      meId,
      onlyMine: d.onlyMine,
      forDownload: true,
      signal,
    });
    return refs.map((r) => ({ id: r.id, mime: r.mime }));
  }
  // photo / selected: look up mime types (only needed for Original's file extension)
  const out: PhotoStub[] = [];
  for (const ids of chunk(d.photoIds, 100)) {
    const { data, error } = await supabase
      .from('photos')
      .select('id, mime, uploader_id')
      .in('id', ids);
    if (error) throw toAppError(error);
    const rows = (data ?? []) as { id: string; mime: string; uploader_id: string }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = byId.get(id);
      if (d.onlyMine && meId && r?.uploader_id !== meId) continue; // host turned downloads off
      out.push({ id, mime: r?.mime ?? 'image/jpeg' });
    }
  }
  return out;
}

let libraryChain: Promise<unknown> = Promise.resolve();
/** Gallery writes are serialised (album creation must not race). */
function inLibrary<T>(fn: () => Promise<T>): Promise<T> {
  const next = libraryChain.then(fn, fn);
  libraryChain = next.catch(() => undefined);
  return next;
}

async function saveToAlbum(uri: string, title: string): Promise<void> {
  await inLibrary(async () => {
    const asset = await MediaLibrary.createAssetAsync(uri);
    const album = (await MediaLibrary.getAlbumAsync(title)) as MediaLibrary.Album | null;
    if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    else await MediaLibrary.createAlbumAsync(title, asset, false);
  });
}

async function pool<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
  signal: AbortSignal,
) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length && !signal.aborted) {
      const item = items[i++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function run(d: DownloadDescriptor, meId: string | null, signal: AbortSignal): Promise<void> {
  const permission = await ensureSavePermission();
  if (permission !== 'granted') throw toAppError({ code: 'P0001', message: 'forbidden' });

  const photos = await listPhotos(d, meId, signal);
  const saved = await loadSaved(d);
  const mime = new Map(photos.map((p) => [p.id, p.mime]));
  const todo = remainingIds(
    photos.map((p) => p.id),
    saved,
  );
  const alreadySaved = photos.length - todo.length;
  set({ total: photos.length, done: alreadySaved, skipped: 0 });
  await persistJob();

  const title = albumName(Platform.OS, d.rollName);
  const variant = variantFor(d.quality);
  const dir = cacheDir();
  let failedHard = 0;

  for (const batch of chunk(todo, SIGN_BATCH)) {
    if (signal.aborted) return;
    await waitForNetwork(d.wifiOnly, signal);
    if (signal.aborted) return;

    const res = await callFunction<SignBatchResponse>(
      'media-sign',
      { items: batch.map((id) => ({ photo_id: id, variant })) },
      { timeoutMs: 30_000, signal },
    );

    await pool(
      batch,
      DOWNLOAD_CONCURRENCY,
      async (id) => {
        const url = res.urls[`${id}:${variant}`];
        if (!url) {
          set({
            skipped: useDownloadStore.getState().skipped + 1,
            done: useDownloadStore.getState().done + 1,
          });
          return;
        }
        const target = new File(dir, `${id}.${extensionFor(mime.get(id), d.quality)}`);
        try {
          const file = await File.downloadFileAsync(url, target, { idempotent: true });
          await saveToAlbum(file.uri, title);
          saved.add(id);
          set({ done: useDownloadStore.getState().done + 1 });
        } catch (e) {
          if (signal.aborted) return;
          failedHard += 1;
          console.warn('download failed for a photo', e);
        } finally {
          try {
            if (target.exists) target.delete();
          } catch {
            // best effort
          }
        }
      },
      signal,
    );
    await storeSaved(d, saved);
    await persistJob();
  }

  if (signal.aborted) return;
  if (failedHard > 0) {
    set({
      status: 'failed',
      note: `${failedHard} ${failedHard === 1 ? 'photo' : 'photos'} didn't save. Tap Resume to retry.`,
    });
    await persistJob();
    return;
  }
  await AsyncStorage.removeItem(savedKey(d)).catch(() => undefined);
  const s = useDownloadStore.getState();
  set({ status: 'done', note: null });
  await persistJob();
  const count = s.done - s.skipped;
  toast.show({
    message: `Saved ${count} ${count === 1 ? 'photo' : 'photos'} to ${title}`,
  });
}

/** Starts (or resumes) a job. Resolves when it finishes, fails or is cancelled. */
export async function startDownload(d: DownloadDescriptor, meId: string | null): Promise<void> {
  if (useDownloadStore.getState().status === 'running') return;
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  set({ descriptor: d, status: 'running', total: 0, done: 0, skipped: 0, note: null });
  try {
    await run(d, meId, ctrl.signal);
  } catch (e) {
    if (!ctrl.signal.aborted) {
      const err = toAppError(e);
      set({
        status: 'failed',
        note:
          err.code === 'downloads_disabled'
            ? 'The host turned downloads off for this Roll.'
            : err.code === 'forbidden'
              ? "Dumpr can't save to your gallery. Allow it in Settings."
              : 'Something interrupted the download. Tap Resume to carry on.',
      });
      await persistJob();
    }
  } finally {
    if (controller === ctrl) controller = null;
  }
}

/** Resumes the current (or restored) job. */
export function resumeDownload(meId: string | null): void {
  const d = useDownloadStore.getState().descriptor;
  if (d) void startDownload(d, meId);
}

export function cancelDownload(): void {
  controller?.abort();
  controller = null;
  const d = useDownloadStore.getState().descriptor;
  set({ status: 'cancelled', note: null });
  void persistJob();
  if (d) void AsyncStorage.removeItem(savedKey(d)).catch(() => undefined);
  setTimeout(() => set({ descriptor: null, status: 'idle', total: 0, done: 0, skipped: 0 }), 0);
}

/** Pauses by stopping the loop; "Resume" starts again from the saved ids. */
export function pauseDownload(): void {
  controller?.abort();
  controller = null;
  set({ status: 'paused', note: 'Paused' });
  void persistJob();
}

export function dismissFinishedDownload(): void {
  const s = useDownloadStore.getState();
  if (s.status === 'done' || s.status === 'cancelled')
    set({ descriptor: null, status: 'idle', total: 0, done: 0, skipped: 0, note: null });
}

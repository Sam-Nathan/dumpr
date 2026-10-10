// Pure rules of the upload queue UI + enqueue. No React Native imports: unit-tested with vitest.

/** A finished upload stays in the Roll grid this long if the server grid has not shown it yet. */
export const DONE_GRACE_MS = 5000;

/**
 * True for files the OS may purge at any time (camera shots and picker copies live in the cache
 * directory). `cacheRoots` are directory URIs (`Paths.cache.uri`, `file:///.../cache/`).
 */
export function isPurgeableUri(uri: string, cacheRoots: readonly string[]): boolean {
  const norm = (u: string) => u.replace(/^file:\/+/i, '/');
  const target = norm(uri);
  return cacheRoots.some((root) => {
    if (!root) return false;
    const r = norm(root).replace(/\/+$/, '');
    return r.length > 1 && target.startsWith(`${r}/`);
  });
}

/** The fields of an upload view the grid rules need. */
export interface PendingLike {
  id: string;
  rollId: string;
  state: string;
  /** ms timestamp of the last state change (set for `done`). */
  updatedAt?: number;
}

/**
 * Does the Roll grid still show this upload as a local tile?
 * - queued / working / failed / duplicate: yes; cancelled: no;
 * - done: only until the server grid returns the photo (same id), at most `DONE_GRACE_MS`.
 *   Dropping it the moment it is done made the photo flicker out before the refetch brought it in.
 */
export function keepPending(
  it: PendingLike,
  rollId: string,
  serverIds: ReadonlySet<string>,
  now: number,
): boolean {
  if (it.rollId !== rollId || it.state === 'cancelled') return false;
  if (it.state !== 'done') return true;
  if (serverIds.has(it.id)) return false;
  return it.updatedAt !== undefined && now - it.updatedAt < DONE_GRACE_MS;
}

/** When the earliest retained `done` tile expires (ms timestamp), or null when none is retained. */
export function nextDoneExpiry(
  items: readonly PendingLike[],
  rollId: string,
  serverIds: ReadonlySet<string>,
  now: number,
): number | null {
  let next: number | null = null;
  for (const it of items) {
    if (it.state !== 'done' || !keepPending(it, rollId, serverIds, now)) continue;
    const at = (it.updatedAt ?? now) + DONE_GRACE_MS;
    if (next === null || at < next) next = at;
  }
  return next;
}

export interface PendingTileFields extends PendingLike {
  localUri?: string;
  thumbUri?: string;
  errorCode?: string;
  retryAt?: number | null;
  pauseReason?: string;
  existingPhotoId?: string;
  fileName?: string;
}

/**
 * Structural equality of two pending lists that ignores `progress` / `bytes` / `attempt` (tiles read
 * progress themselves), so the grid only re-renders when a tile appears, disappears or changes state.
 */
export function samePending(
  a: readonly PendingTileFields[],
  b: readonly PendingTileFields[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.state !== y.state ||
      x.localUri !== y.localUri ||
      x.thumbUri !== y.thumbUri ||
      x.errorCode !== y.errorCode ||
      x.retryAt !== y.retryAt ||
      x.pauseReason !== y.pauseReason ||
      x.existingPhotoId !== y.existingPhotoId ||
      (x.state === 'done' && x.updatedAt !== y.updatedAt)
    )
      return false;
  }
  return true;
}

import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import {
  getItemProgress,
  getSnapshot,
  subscribe,
  type UploadItemView,
  type UploadQueueSnapshot,
} from './worker.ts';
import { keepPending, nextDoneExpiry, samePending } from './queueRules.ts';

/** C4: every item in the queue, the summary and the global toggles. */
export function useUploadQueue(): UploadQueueSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * `useSyncExternalStore` with a selector and an equality function: the component re-renders only when
 * the selected value is no longer `isEqual` to the previous one (the queue snapshot is rebuilt ~8x/s
 * while uploads run).
 */
function useQueueSelector<T>(
  select: (s: UploadQueueSnapshot) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const cache = useRef<{ snap: UploadQueueSnapshot; select: typeof select; value: T } | null>(null);
  const getSelected = useCallback((): T => {
    const snap = getSnapshot();
    const c = cache.current;
    if (c && c.snap === snap && c.select === select) return c.value;
    const next = select(snap);
    const value = c && isEqual(c.value, next) ? c.value : next;
    cache.current = { snap, select, value };
    return value;
  }, [select, isEqual]);
  return useSyncExternalStore(subscribe, getSelected, getSelected);
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * B3 grid tiles for the caller's not-yet-ready photos in a roll: uploading / waiting / failed /
 * blocked / duplicate, plus a just-finished photo until `serverIds` (the ids of the photos the grid
 * already shows) contains it, for at most 5 s, so it never flickers out between "done" and the refetch.
 * Cancelled items are left out. The returned list changes identity only when a tile appears,
 * disappears or changes state; progress is read per tile with `useUploadProgress`.
 */
export function useRollPendingUploads(
  rollId: string,
  serverIds: ReadonlySet<string> = EMPTY_IDS,
): UploadItemView[] {
  // Re-evaluate when the oldest retained "done" tile reaches its grace limit.
  const [epoch, bump] = useReducer((n: number) => n + 1, 0);
  const select = useCallback(
    (s: UploadQueueSnapshot) => {
      void epoch;
      const now = Date.now();
      return s.items.filter((i) => keepPending(i, rollId, serverIds, now));
    },
    [rollId, serverIds, epoch],
  );
  const list = useQueueSelector(select, samePending);

  useEffect(() => {
    const at = nextDoneExpiry(list, rollId, serverIds, Date.now());
    if (at === null) return undefined;
    const t = setTimeout(bump, Math.max(50, at - Date.now() + 20));
    return () => clearTimeout(t);
  }, [list, rollId, serverIds]);

  return list;
}

/** Progress (0..1) of one upload; only the tile that shows it re-renders on a tick. */
export function useUploadProgress(id: string): number {
  return useSyncExternalStore(
    subscribe,
    () => getItemProgress(id),
    () => getItemProgress(id),
  );
}

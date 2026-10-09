import { useMemo, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, type UploadItemView, type UploadQueueSnapshot } from './worker.ts';

/** C4: every item in the queue, the summary and the global toggles. */
export function useUploadQueue(): UploadQueueSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * B3 grid tiles for the caller's not-yet-ready photos in a roll: uploading / waiting / failed /
 * blocked / duplicate. Done items are left out (the server grid shows them after invalidation),
 * as are cancelled ones.
 */
export function useRollPendingUploads(rollId: string): UploadItemView[] {
  const { items } = useUploadQueue();
  return useMemo(
    () => items.filter((i) => i.rollId === rollId && i.state !== 'done' && i.state !== 'cancelled'),
    [items, rollId],
  );
}

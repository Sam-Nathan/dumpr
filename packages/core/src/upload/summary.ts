// Selectors for the C4 upload screen and the B3 progress pill ("8/20 Uploading · 1 failed").

import type { UploadStateKind } from './state.ts';
import { UPLOAD_STATE_KINDS, isActive } from './state.ts';

/** The minimum a view row needs to be summarised (both mobile and web item views satisfy it). */
export interface SummarizableItem {
  state: UploadStateKind;
  /** Original size in bytes. */
  bytes: number;
  /** 0..1 */
  progress: number;
}

export interface UploadSummary {
  /** Items counted (cancelled items are left out). */
  total: number;
  totalBytes: number;
  /** Bytes uploaded, counting partial progress of in-flight items. */
  doneBytes: number;
  counts: Record<UploadStateKind, number>;
  /** done + duplicate ("24 of 38 uploaded"). */
  uploaded: number;
  /** Currently preparing / initiating / uploading / completing. */
  active: number;
  /** queued + paused. */
  waiting: number;
  /** failed (incl. those waiting for an automatic retry) + blocked ("Retry failed (1)"). */
  failed: number;
  /** Nothing left to do ("All caught up"). True for an empty queue. */
  allDone: boolean;
  /** 0..1 over bytes. */
  fraction: number;
}

export function emptyCounts(): Record<UploadStateKind, number> {
  const c = {} as Record<UploadStateKind, number>;
  for (const k of UPLOAD_STATE_KINDS) c[k] = 0;
  return c;
}

export function summarizeUploads(items: ReadonlyArray<SummarizableItem>): UploadSummary {
  const counts = emptyCounts();
  let total = 0;
  let totalBytes = 0;
  let doneBytes = 0;
  let active = 0;
  for (const it of items) {
    counts[it.state] = (counts[it.state] ?? 0) + 1;
    if (it.state === 'cancelled') continue;
    total++;
    const bytes = Number.isFinite(it.bytes) && it.bytes > 0 ? it.bytes : 0;
    totalBytes += bytes;
    const p =
      it.state === 'done' || it.state === 'duplicate'
        ? 1
        : Math.min(1, Math.max(0, it.progress || 0));
    doneBytes += bytes * p;
    if (isActive(it.state)) active++;
  }
  const uploaded = counts.done + counts.duplicate;
  const failed = counts.failed + counts.blocked;
  const waiting = counts.queued + counts.paused;
  return {
    total,
    totalBytes,
    doneBytes: Math.round(doneBytes),
    counts,
    uploaded,
    active,
    waiting,
    failed,
    allDone: uploaded === total,
    fraction: totalBytes > 0 ? doneBytes / totalBytes : total > 0 && uploaded === total ? 1 : 0,
  };
}

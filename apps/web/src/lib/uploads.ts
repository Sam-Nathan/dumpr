import type { WebUploadItem } from './upload-contract';

/** States that mean "work is still happening" (used for beforeunload and the summary bar). */
const ACTIVE_STATES = new Set([
  'queued',
  'preparing',
  'initiating',
  'uploading',
  'completing',
  'paused',
]);

export function isActiveState(state: string): boolean {
  return ACTIVE_STATES.has(state);
}

export function hasActive(items: readonly Pick<WebUploadItem, 'state'>[]): boolean {
  return items.some((i) => isActiveState(i.state));
}

/** Accepts 0..1 or 0..100 and clamps to 0..1. */
export function normalizeProgress(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  const frac = p > 1 ? p / 100 : p;
  return Math.min(1, frac);
}

export interface UploadSummary {
  total: number;
  /** Items finished in any good way (done + duplicate). */
  finished: number;
  active: number;
  failed: number;
  done: number;
  duplicate: number;
  /** 0..1 across all items. */
  progress: number;
}

export function summarizeUploads(items: readonly WebUploadItem[]): UploadSummary {
  let done = 0;
  let duplicate = 0;
  let failed = 0;
  let active = 0;
  let sum = 0;
  for (const i of items) {
    if (i.state === 'done') {
      done++;
      sum += 1;
    } else if (i.state === 'duplicate') {
      duplicate++;
      sum += 1;
    } else if (i.state === 'failed' || i.state === 'blocked') {
      failed++;
      sum += 1;
    } else {
      active++;
      sum += i.state === 'uploading' ? normalizeProgress(i.progress) : 0;
    }
  }
  const total = items.length;
  return {
    total,
    finished: done + duplicate,
    active,
    failed,
    done,
    duplicate,
    progress: total === 0 ? 0 : sum / total,
  };
}

/** "Uploading 3 of 12" / "12 added" / "11 added · 1 didn't upload". */
export function summaryLabel(s: UploadSummary): string {
  if (s.total === 0) return '';
  if (s.active > 0)
    return `Uploading ${Math.min(s.finished + s.failed + 1, s.total)} of ${s.total}`;
  const ok = s.done + s.duplicate;
  const parts = [`${ok} added`];
  if (s.failed > 0) parts.push(`${s.failed} didn’t upload`);
  return parts.join(' · ');
}

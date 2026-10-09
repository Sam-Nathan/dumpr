// Upload queue state machine (architecture §9). Pure: the worker feeds events, persists the result.
//
//   queued → preparing → initiating → uploading → completing → done
//                             └→ duplicate
//   any active ──error──→ failed(retryAt) ──due──→ queued      (automatic, with backoff)
//                     └─→ failed(retryAt: null)                (8 attempts used / fatal → manual retry)
//                     └─→ blocked(code)                        (storage_full, uploads_disabled, …)
//   non-terminal ──pause──→ paused(no_network | wifi_only | user) ──resume──→ queued
//   non-terminal ──cancel──→ cancelled

import { nextRetryAt } from './backoff.ts';
import { errorToState, type BlockedCode } from './errors.ts';

export type PauseReason = 'no_network' | 'wifi_only' | 'user';

export type UploadState =
  | { kind: 'queued' }
  | { kind: 'preparing' }
  | { kind: 'initiating' }
  | { kind: 'uploading'; sentBytes: number; totalBytes: number }
  | { kind: 'completing' }
  | { kind: 'done'; status: 'ready' | 'review' }
  | { kind: 'duplicate'; existingPhotoId: string }
  /** retryAt: ms timestamp of the next automatic attempt; null = waits for a manual retry. */
  | { kind: 'failed'; code: string; retryAt: number | null }
  | { kind: 'blocked'; code: BlockedCode }
  | { kind: 'paused'; reason: PauseReason }
  | { kind: 'cancelled' };

export type UploadStateKind = UploadState['kind'];

export const UPLOAD_STATE_KINDS: readonly UploadStateKind[] = [
  'queued',
  'preparing',
  'initiating',
  'uploading',
  'completing',
  'done',
  'duplicate',
  'failed',
  'blocked',
  'paused',
  'cancelled',
];

export interface UploadItemState {
  state: UploadState;
  /** Failed attempts since the last manual retry. */
  attempt: number;
}

export type UploadEvent =
  /** queued → preparing (md5, variants, blurhash). */
  | { type: 'prepare' }
  /** preparing → initiating. */
  | { type: 'prepared' }
  /** queued → initiating, for items prepared in an earlier attempt. */
  | { type: 'initiate' }
  /** initiating → uploading. */
  | { type: 'upload_started'; totalBytes: number; sentBytes?: number }
  /** uploading: byte progress. */
  | { type: 'progress'; sentBytes: number }
  /** uploading → completing. */
  | { type: 'uploaded' }
  /** completing → done. */
  | { type: 'completed'; status: 'ready' | 'review' }
  /** initiating → duplicate (or done when the duplicate is this very photo). */
  | { type: 'duplicate'; existingPhotoId: string; photoId?: string }
  /** active → failed / blocked. */
  | { type: 'error'; code: string; now: number; rand?: number }
  | { type: 'pause'; reason: PauseReason }
  /** paused → queued. With `reason`, only resumes items paused for that reason. */
  | { type: 'resume'; reason?: PauseReason }
  /** failed with a due retryAt → queued. */
  | { type: 'due'; now: number }
  /** Manual retry: failed / blocked / paused → queued, attempts reset. */
  | { type: 'retry' }
  | { type: 'cancel' };

export function isActive(kind: UploadStateKind): boolean {
  return kind === 'preparing' || kind === 'initiating' || kind === 'uploading' || kind === 'completing';
}

export function isTerminal(kind: UploadStateKind): boolean {
  return kind === 'done' || kind === 'duplicate' || kind === 'cancelled';
}

/** Needs a person: blocked, or failed with no automatic retry left. */
export function needsAttention(state: UploadState): boolean {
  return state.kind === 'blocked' || (state.kind === 'failed' && state.retryAt === null);
}

/** Can the worker start this item now? */
export function isRunnable(state: UploadState, now: number): boolean {
  return state.kind === 'queued' || (state.kind === 'failed' && state.retryAt !== null && state.retryAt <= now);
}

/** 0..1 progress for one item. */
export function itemProgress(state: UploadState): number {
  switch (state.kind) {
    case 'done':
    case 'duplicate':
    case 'completing':
      return 1;
    case 'uploading':
      return state.totalBytes > 0 ? Math.min(1, Math.max(0, state.sentBytes / state.totalBytes)) : 0;
    default:
      return 0;
  }
}

/**
 * Pure reducer. Events that do not apply to the current state return the item unchanged (same
 * reference), so late events from an aborted attempt are harmless.
 */
export function transition<T extends UploadItemState>(item: T, event: UploadEvent): T {
  const s = item.state;
  const to = (state: UploadState, attempt = item.attempt): T => ({ ...item, state, attempt });

  switch (event.type) {
    case 'prepare':
      return s.kind === 'queued' ? to({ kind: 'preparing' }) : item;
    case 'prepared':
      return s.kind === 'preparing' ? to({ kind: 'initiating' }) : item;
    case 'initiate':
      return s.kind === 'queued' ? to({ kind: 'initiating' }) : item;
    case 'upload_started':
      return s.kind === 'initiating'
        ? to({ kind: 'uploading', totalBytes: event.totalBytes, sentBytes: event.sentBytes ?? 0 })
        : item;
    case 'progress':
      return s.kind === 'uploading'
        ? to({ ...s, sentBytes: Math.min(s.totalBytes, Math.max(0, event.sentBytes)) })
        : item;
    case 'uploaded':
      return s.kind === 'uploading' ? to({ kind: 'completing' }) : item;
    case 'completed':
      return s.kind === 'completing' ? to({ kind: 'done', status: event.status }) : item;
    case 'duplicate':
      if (s.kind !== 'initiating') return item;
      return event.photoId !== undefined && event.photoId === event.existingPhotoId
        ? to({ kind: 'done', status: 'ready' })
        : to({ kind: 'duplicate', existingPhotoId: event.existingPhotoId });
    case 'error': {
      if (!isActive(s.kind) && s.kind !== 'queued') return item;
      const d = errorToState(event.code);
      if (d.kind === 'blocked') return to({ kind: 'blocked', code: d.code });
      const attempt = item.attempt + 1;
      if (d.kind === 'fatal') return to({ kind: 'failed', code: d.code, retryAt: null }, attempt);
      return to({ kind: 'failed', code: d.code, retryAt: nextRetryAt(attempt, event.now, event.rand) }, attempt);
    }
    case 'pause':
      if (isTerminal(s.kind) || s.kind === 'blocked') return item;
      if (s.kind === 'failed' && s.retryAt === null) return item; // waits for a person anyway
      if (s.kind === 'paused' && s.reason === event.reason) return item;
      return to({ kind: 'paused', reason: event.reason });
    case 'resume':
      if (s.kind !== 'paused') return item;
      if (event.reason !== undefined && s.reason !== event.reason) return item;
      return to({ kind: 'queued' });
    case 'due':
      return s.kind === 'failed' && s.retryAt !== null && s.retryAt <= event.now ? to({ kind: 'queued' }) : item;
    case 'retry':
      return s.kind === 'failed' || s.kind === 'blocked' || s.kind === 'paused' ? to({ kind: 'queued' }, 0) : item;
    case 'cancel':
      return isTerminal(s.kind) ? item : to({ kind: 'cancelled' });
  }
}

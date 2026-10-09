// Flat (SQL-friendly) encoding of UploadState so queues can persist it and resume after a restart.

import { isBlockedCode } from './errors.ts';
import type { PauseReason, UploadState, UploadStateKind } from './state.ts';
import { UPLOAD_STATE_KINDS, isActive } from './state.ts';

export interface UploadStateRecord {
  state: UploadStateKind;
  error_code: string | null;
  next_attempt_at: number | null;
  existing_photo_id: string | null;
  result_status: 'ready' | 'review' | null;
  pause_reason: PauseReason | null;
}

export function stateToRecord(s: UploadState): UploadStateRecord {
  const r: UploadStateRecord = {
    state: s.kind,
    error_code: null,
    next_attempt_at: null,
    existing_photo_id: null,
    result_status: null,
    pause_reason: null,
  };
  switch (s.kind) {
    case 'failed':
      r.error_code = s.code;
      r.next_attempt_at = s.retryAt;
      break;
    case 'blocked':
      r.error_code = s.code;
      break;
    case 'duplicate':
      r.existing_photo_id = s.existingPhotoId;
      break;
    case 'done':
      r.result_status = s.status;
      break;
    case 'paused':
      r.pause_reason = s.reason;
      break;
    default:
      break;
  }
  return r;
}

const kinds: ReadonlySet<string> = new Set(UPLOAD_STATE_KINDS);
const pauseReasons: ReadonlySet<string> = new Set(['no_network', 'wifi_only', 'user']);

/**
 * Decodes a persisted state. Items that were mid-flight when the process died (preparing,
 * initiating, uploading, completing) come back as `queued`: every step is idempotent, and the
 * pipeline skips work recorded as done (prepared files, uploaded variants, uploaded parts).
 * Network/Wi-Fi pauses also come back as `queued`; the worker re-applies the current gate.
 */
export function stateFromRecord(r: Partial<UploadStateRecord> & { state: string }): UploadState {
  const kind = kinds.has(r.state) ? (r.state as UploadStateKind) : 'queued';
  if (isActive(kind)) return { kind: 'queued' };
  switch (kind) {
    case 'failed':
      return { kind: 'failed', code: r.error_code || 'unknown', retryAt: r.next_attempt_at ?? null };
    case 'blocked':
      return r.error_code && isBlockedCode(r.error_code)
        ? { kind: 'blocked', code: r.error_code }
        : { kind: 'failed', code: r.error_code || 'unknown', retryAt: null };
    case 'duplicate':
      return r.existing_photo_id ? { kind: 'duplicate', existingPhotoId: r.existing_photo_id } : { kind: 'queued' };
    case 'done':
      return { kind: 'done', status: r.result_status === 'review' ? 'review' : 'ready' };
    case 'paused':
      return r.pause_reason === 'user' ? { kind: 'paused', reason: 'user' } : { kind: 'queued' };
    case 'cancelled':
      return { kind: 'cancelled' };
    default:
      return { kind: 'queued' };
  }
}

export function isPauseReason(v: unknown): v is PauseReason {
  return typeof v === 'string' && pauseReasons.has(v);
}

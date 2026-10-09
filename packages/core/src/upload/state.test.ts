import { describe, expect, it } from 'vitest';
import { MAX_AUTO_ATTEMPTS } from './constants.ts';
import { stateFromRecord, stateToRecord } from './persist.ts';
import {
  isActive,
  isRunnable,
  isTerminal,
  itemProgress,
  needsAttention,
  transition,
  type UploadEvent,
  type UploadItemState,
  type UploadState,
} from './state.ts';

const item = (state: UploadState, attempt = 0): UploadItemState & { id: string } => ({
  id: 'x',
  state,
  attempt,
});
const run = (start: UploadItemState, ...events: UploadEvent[]) =>
  events.reduce((it, e) => transition(it, e), start);

describe('transition: happy path', () => {
  it('queued → preparing → initiating → uploading → completing → done', () => {
    const end = run(
      item({ kind: 'queued' }),
      { type: 'prepare' },
      { type: 'prepared' },
      { type: 'upload_started', totalBytes: 100 },
      { type: 'progress', sentBytes: 40 },
      { type: 'uploaded' },
      { type: 'completed', status: 'ready' },
    );
    expect(end.state).toEqual({ kind: 'done', status: 'ready' });
    expect(end.attempt).toBe(0);
  });

  it('keeps extra fields of the item', () => {
    const it2 = transition(item({ kind: 'queued' }), { type: 'prepare' });
    expect(it2.id).toBe('x');
  });

  it('prepared items skip preparing via initiate', () => {
    expect(transition(item({ kind: 'queued' }), { type: 'initiate' }).state.kind).toBe(
      'initiating',
    );
  });

  it('tracks progress, clamped to the total', () => {
    let it2 = run(item({ kind: 'initiating' }), {
      type: 'upload_started',
      totalBytes: 100,
      sentBytes: 10,
    });
    expect(it2.state).toEqual({ kind: 'uploading', totalBytes: 100, sentBytes: 10 });
    it2 = transition(it2, { type: 'progress', sentBytes: 250 });
    expect(it2.state).toEqual({ kind: 'uploading', totalBytes: 100, sentBytes: 100 });
    it2 = transition(it2, { type: 'progress', sentBytes: -5 });
    expect(it2.state).toEqual({ kind: 'uploading', totalBytes: 100, sentBytes: 0 });
  });

  it('review status for guest uploads', () => {
    expect(
      transition(item({ kind: 'completing' }), { type: 'completed', status: 'review' }).state,
    ).toEqual({
      kind: 'done',
      status: 'review',
    });
  });

  it('duplicate ends the item; a duplicate of itself means done', () => {
    expect(
      transition(item({ kind: 'initiating' }), {
        type: 'duplicate',
        existingPhotoId: 'p2',
        photoId: 'p1',
      }).state,
    ).toEqual({
      kind: 'duplicate',
      existingPhotoId: 'p2',
    });
    expect(
      transition(item({ kind: 'initiating' }), {
        type: 'duplicate',
        existingPhotoId: 'p1',
        photoId: 'p1',
      }).state,
    ).toEqual({
      kind: 'done',
      status: 'ready',
    });
  });
});

describe('transition: errors', () => {
  const now = 1_000_000;

  it('retryable errors back off and count attempts', () => {
    const it2 = transition(item({ kind: 'uploading', sentBytes: 1, totalBytes: 2 }), {
      type: 'error',
      code: 'network',
      now,
      rand: 0.5,
    });
    expect(it2.state).toEqual({ kind: 'failed', code: 'network', retryAt: now + 5000 });
    expect(it2.attempt).toBe(1);
  });

  it('after MAX_AUTO_ATTEMPTS failures the item waits for a manual retry', () => {
    let it2: UploadItemState = item({ kind: 'queued' }, 0);
    for (let i = 0; i < MAX_AUTO_ATTEMPTS; i++) {
      it2 = run(it2, { type: 'initiate' }, { type: 'error', code: 'internal', now, rand: 0.5 });
      if (i < MAX_AUTO_ATTEMPTS - 1) {
        expect(it2.state.kind).toBe('failed');
        expect((it2.state as { retryAt: number | null }).retryAt).not.toBeNull();
        it2 = transition(it2, { type: 'due', now: now + 10 ** 9 });
        expect(it2.state.kind).toBe('queued');
      }
    }
    expect(it2.attempt).toBe(MAX_AUTO_ATTEMPTS);
    expect(it2.state).toEqual({ kind: 'failed', code: 'internal', retryAt: null });
    expect(needsAttention(it2.state)).toBe(true);
    // 'due' does nothing for a manual-retry item
    expect(transition(it2, { type: 'due', now: now * 10 })).toBe(it2);
    // a manual retry resets attempts
    const retried = transition(it2, { type: 'retry' });
    expect(retried.state.kind).toBe('queued');
    expect(retried.attempt).toBe(0);
  });

  it('blocked codes stop the item without counting an attempt', () => {
    for (const code of [
      'storage_full',
      'uploads_disabled',
      'not_a_member',
      'storage_not_configured',
      'guests_not_allowed',
    ]) {
      const it2 = transition(item({ kind: 'initiating' }, 2), { type: 'error', code, now });
      expect(it2.state).toEqual({ kind: 'blocked', code });
      expect(it2.attempt).toBe(2);
      expect(needsAttention(it2.state)).toBe(true);
    }
  });

  it('fatal codes fail without automatic retry', () => {
    const it2 = transition(item({ kind: 'initiating' }), {
      type: 'error',
      code: 'invalid_input',
      now,
    });
    expect(it2.state).toEqual({ kind: 'failed', code: 'invalid_input', retryAt: null });
  });

  it('due only fires once retryAt has passed', () => {
    const failed = item({ kind: 'failed', code: 'network', retryAt: now + 100 });
    expect(transition(failed, { type: 'due', now })).toBe(failed);
    expect(transition(failed, { type: 'due', now: now + 100 }).state.kind).toBe('queued');
  });

  it('errors on idle/terminal items are ignored', () => {
    for (const s of [
      { kind: 'done', status: 'ready' },
      { kind: 'duplicate', existingPhotoId: 'p' },
      { kind: 'cancelled' },
      { kind: 'paused', reason: 'user' },
      { kind: 'blocked', code: 'storage_full' },
    ] as UploadState[]) {
      const it2 = item(s);
      expect(transition(it2, { type: 'error', code: 'network', now })).toBe(it2);
    }
  });
});

describe('transition: pause / resume / cancel', () => {
  it('pauses active and waiting items, resumes to queued', () => {
    for (const s of [
      { kind: 'queued' },
      { kind: 'uploading', sentBytes: 0, totalBytes: 1 },
      { kind: 'failed', code: 'network', retryAt: 5 },
    ] as UploadState[]) {
      const paused = transition(item(s), { type: 'pause', reason: 'wifi_only' });
      expect(paused.state).toEqual({ kind: 'paused', reason: 'wifi_only' });
      expect(transition(paused, { type: 'resume' }).state.kind).toBe('queued');
    }
  });

  it('resume with a reason only resumes that reason', () => {
    const paused = item({ kind: 'paused', reason: 'user' });
    expect(transition(paused, { type: 'resume', reason: 'no_network' })).toBe(paused);
    expect(transition(paused, { type: 'resume', reason: 'user' }).state.kind).toBe('queued');
  });

  it('does not pause terminal, blocked or manual-retry items', () => {
    for (const s of [
      { kind: 'done', status: 'ready' },
      { kind: 'cancelled' },
      { kind: 'blocked', code: 'storage_full' },
      { kind: 'failed', code: 'x', retryAt: null },
    ] as UploadState[]) {
      const it2 = item(s);
      expect(transition(it2, { type: 'pause', reason: 'no_network' })).toBe(it2);
    }
  });

  it('re-pausing for the same reason is a no-op', () => {
    const p = item({ kind: 'paused', reason: 'no_network' });
    expect(transition(p, { type: 'pause', reason: 'no_network' })).toBe(p);
    expect(transition(p, { type: 'pause', reason: 'user' }).state).toEqual({
      kind: 'paused',
      reason: 'user',
    });
  });

  it('cancel works from any non-terminal state and is final', () => {
    const c = transition(item({ kind: 'uploading', sentBytes: 1, totalBytes: 9 }), {
      type: 'cancel',
    });
    expect(c.state.kind).toBe('cancelled');
    expect(transition(c, { type: 'retry' })).toBe(c);
    expect(transition(c, { type: 'prepare' })).toBe(c);
    const d = item({ kind: 'done', status: 'ready' });
    expect(transition(d, { type: 'cancel' })).toBe(d);
  });

  it('ignores out-of-order events (late events from an aborted attempt)', () => {
    const q = item({ kind: 'queued' });
    expect(transition(q, { type: 'progress', sentBytes: 5 })).toBe(q);
    expect(transition(q, { type: 'uploaded' })).toBe(q);
    expect(transition(q, { type: 'completed', status: 'ready' })).toBe(q);
    expect(transition(q, { type: 'prepared' })).toBe(q);
    expect(transition(q, { type: 'upload_started', totalBytes: 1 })).toBe(q);
    expect(transition(q, { type: 'duplicate', existingPhotoId: 'a' })).toBe(q);
  });
});

describe('predicates', () => {
  it('classify states', () => {
    expect(isActive('uploading')).toBe(true);
    expect(isActive('queued')).toBe(false);
    expect(isTerminal('duplicate')).toBe(true);
    expect(isTerminal('failed')).toBe(false);
    expect(isRunnable({ kind: 'queued' }, 0)).toBe(true);
    expect(isRunnable({ kind: 'failed', code: 'n', retryAt: 10 }, 9)).toBe(false);
    expect(isRunnable({ kind: 'failed', code: 'n', retryAt: 10 }, 10)).toBe(true);
    expect(isRunnable({ kind: 'failed', code: 'n', retryAt: null }, 10)).toBe(false);
    expect(isRunnable({ kind: 'paused', reason: 'user' }, 10)).toBe(false);
  });

  it('itemProgress', () => {
    expect(itemProgress({ kind: 'uploading', sentBytes: 25, totalBytes: 100 })).toBe(0.25);
    expect(itemProgress({ kind: 'uploading', sentBytes: 0, totalBytes: 0 })).toBe(0);
    expect(itemProgress({ kind: 'done', status: 'ready' })).toBe(1);
    expect(itemProgress({ kind: 'queued' })).toBe(0);
  });
});

describe('persist', () => {
  const states: UploadState[] = [
    { kind: 'queued' },
    { kind: 'done', status: 'review' },
    { kind: 'duplicate', existingPhotoId: 'p9' },
    { kind: 'failed', code: 'network', retryAt: 123 },
    { kind: 'failed', code: 'invalid_input', retryAt: null },
    { kind: 'blocked', code: 'storage_full' },
    { kind: 'paused', reason: 'user' },
    { kind: 'cancelled' },
  ];
  for (const s of states) {
    it(`round-trips ${s.kind}`, () => {
      expect(stateFromRecord(stateToRecord(s))).toEqual(s);
    });
  }

  it('recovers mid-flight states as queued after a restart', () => {
    for (const s of [
      { kind: 'preparing' },
      { kind: 'initiating' },
      { kind: 'uploading', sentBytes: 5, totalBytes: 10 },
      { kind: 'completing' },
    ] as UploadState[]) {
      expect(stateFromRecord(stateToRecord(s))).toEqual({ kind: 'queued' });
    }
  });

  it('network pauses come back queued (the worker re-applies the gate); unknown → queued', () => {
    expect(stateFromRecord(stateToRecord({ kind: 'paused', reason: 'wifi_only' }))).toEqual({
      kind: 'queued',
    });
    expect(stateFromRecord({ state: 'bogus' as never })).toEqual({ kind: 'queued' });
    expect(stateFromRecord({ state: 'blocked', error_code: 'weird' })).toEqual({
      kind: 'failed',
      code: 'weird',
      retryAt: null,
    });
    expect(stateFromRecord({ state: 'duplicate' })).toEqual({ kind: 'queued' });
  });
});

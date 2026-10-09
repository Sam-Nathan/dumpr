import { describe, expect, it } from 'vitest';
import {
  failureReason,
  formatClockTime,
  isCancellable,
  retryInSeconds,
  revealBody,
  revealEyebrow,
  sortQueue,
  statusLine,
} from './queueCopy';

describe('statusLine', () => {
  const now = 1_000_000;
  it('failed shows the reason and the retry countdown', () => {
    expect(
      statusLine({ state: 'failed', progress: 0, errorCode: 'network', retryAt: now + 9_200 }, now),
    ).toEqual({
      text: 'Network dropped · retrying in 10 s',
      tone: 'danger',
    });
    expect(
      statusLine({ state: 'failed', progress: 0, errorCode: 'internal', retryAt: null }, now).text,
    ).toContain('tap Retry');
  });
  it('blocked, paused, uploading, done', () => {
    expect(statusLine({ state: 'blocked', progress: 0, errorCode: 'storage_full' }, now).text).toBe(
      'Your storage is full',
    );
    expect(statusLine({ state: 'paused', progress: 0, pauseReason: 'wifi_only' }, now).text).toBe(
      'Waiting for Wi-Fi',
    );
    expect(statusLine({ state: 'uploading', progress: 0.644 }, now).text).toBe('64%');
    expect(statusLine({ state: 'done', progress: 1 }, now).tone).toBe('success');
  });
  it('never exposes raw codes', () => {
    expect(failureReason('weird_code')).toBe("Didn't upload");
    expect(failureReason(undefined)).toBe("Didn't upload");
    expect(retryInSeconds(undefined, 0)).toBeNull();
    expect(retryInSeconds(500, 1000)).toBe(0);
  });
});

describe('sortQueue', () => {
  it('puts failed first, then active, waiting, done; drops cancelled; stable', () => {
    const items = [
      { id: 'a', state: 'done' },
      { id: 'b', state: 'queued' },
      { id: 'c', state: 'uploading' },
      { id: 'd', state: 'failed' },
      { id: 'e', state: 'cancelled' },
      { id: 'f', state: 'uploading' },
    ];
    expect(sortQueue(items).map((i) => i.id)).toEqual(['d', 'c', 'f', 'b', 'a']);
    expect(isCancellable('uploading')).toBe(true);
    expect(isCancellable('done')).toBe(false);
  });
});

describe('reveal copy', () => {
  it('formats clock time and copy', () => {
    expect(formatClockTime(new Date(2026, 2, 13, 9, 0))).toBe('9:00 AM');
    expect(formatClockTime(new Date(2026, 2, 13, 0, 5))).toBe('12:05 AM');
    expect(formatClockTime(new Date(2026, 2, 13, 21, 30))).toBe('9:30 PM');
    expect(revealEyebrow("Goa '26", 'next_morning')).toBe("GOA '26 · NEXT-MORNING REVEAL");
    expect(revealBody(38, new Date(2026, 2, 13, 9, 0))).toBe(
      'Your 38 photos are sealed until 9:00 AM. Everyone sees the full Roll at the same moment.',
    );
    expect(revealBody(1, new Date(2026, 2, 13, 9, 0))).toContain('Your photo is sealed');
  });
});

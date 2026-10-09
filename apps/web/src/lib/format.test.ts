import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDateRange,
  formatPeopleCount,
  formatPhotoCount,
  formatUnlockTime,
  initials,
} from './format';

describe('formatDateRange', () => {
  it('same month collapses', () =>
    expect(formatDateRange('2026-03-12', '2026-03-15')).toBe('12–15 Mar'));
  it('same day', () => expect(formatDateRange('2026-03-12', '2026-03-12')).toBe('12 Mar'));
  it('across months', () =>
    expect(formatDateRange('2026-02-28', '2026-03-02')).toBe('28 Feb – 2 Mar'));
  it('across years', () =>
    expect(formatDateRange('2025-12-30', '2026-01-02')).toBe('30 Dec 2025 – 2 Jan 2026'));
  it('single bound or none', () => {
    expect(formatDateRange('2026-03-12', null)).toBe('12 Mar');
    expect(formatDateRange(null, '2026-03-15')).toBe('15 Mar');
    expect(formatDateRange(null, null)).toBe('');
    expect(formatDateRange('garbage', undefined)).toBe('');
  });
  it('accepts timestamps', () =>
    expect(formatDateRange('2026-03-12T00:00:00Z', '2026-03-15T00:00:00Z')).toBe('12–15 Mar'));
});

describe('counts', () => {
  it('groups digits', () => {
    expect(formatCount(1204)).toBe('1,204');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(NaN)).toBe('0');
  });
  it('pluralises photos', () => {
    expect(formatPhotoCount(0)).toBe('0 photos');
    expect(formatPhotoCount(1)).toBe('1 photo');
    expect(formatPhotoCount(142)).toBe('142 photos');
    expect(formatPhotoCount(1204)).toBe('1,204 photos');
  });
  it('pluralises people', () => {
    expect(formatPeopleCount(1)).toBe('1 person');
    expect(formatPeopleCount(6)).toBe('6 people');
  });
});

describe('formatUnlockTime', () => {
  const now = new Date('2026-03-14T03:00:00Z');
  it('time only when same day', () =>
    expect(formatUnlockTime('2026-03-14T09:00:00Z', now, 'UTC')).toBe('9:00 AM'));
  it('adds the day otherwise', () =>
    expect(formatUnlockTime('2026-03-16T21:30:00Z', now, 'UTC')).toBe('Mon 16 Mar, 9:30 PM'));
  it('respects the time zone', () =>
    expect(formatUnlockTime('2026-03-14T09:00:00Z', now, 'Asia/Kolkata')).toBe('2:30 PM'));
  it('empty on bad input', () => {
    expect(formatUnlockTime(null)).toBe('');
    expect(formatUnlockTime('nope')).toBe('');
  });
});

describe('initials', () => {
  it('works', () => {
    expect(initials('Kabir Singh')).toBe('KS');
    expect(initials('diya')).toBe('D');
    expect(initials('  ')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

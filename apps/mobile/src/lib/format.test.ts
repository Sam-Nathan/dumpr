import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  formatBirthday,
  formatBytes,
  formatCount,
  formatCountdown,
  formatDateRange,
  formatRelative,
  formatResend,
  formatStamp,
  initials,
  pluralize,
} from './format';

describe('formatBytes', () => {
  it('uses decimal units and sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1_500)).toBe('2 KB');
    expect(formatBytes(412_000_000)).toBe('412 MB');
    expect(formatBytes(11_200_000)).toBe('11.2 MB');
    expect(formatBytes(6_800_000_000)).toBe('6.8 GB');
    expect(formatBytes(12_000_000_000)).toBe('12 GB');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('formatDateRange', () => {
  it('same month', () => expect(formatDateRange('2026-03-12', '2026-03-15')).toBe('12–15 Mar'));
  it('one day', () => expect(formatDateRange('2026-03-12', '2026-03-12')).toBe('12 Mar'));
  it('across months', () => expect(formatDateRange('2026-02-28', '2026-03-02')).toBe('28 Feb – 2 Mar'));
  it('across years', () =>
    expect(formatDateRange('2025-12-28', '2026-01-02')).toBe("28 Dec '25 – 2 Jan '26"));
  it('open ended / none', () => {
    expect(formatDateRange('2026-03-12', null)).toBe('From 12 Mar');
    expect(formatDateRange(null, null)).toBe('');
  });
});

describe('formatRelative', () => {
  const now = Date.UTC(2026, 9, 9, 12, 0, 0);
  it('compacts', () => {
    expect(formatRelative(now - 10_000, now)).toBe('now');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5m');
    expect(formatRelative(now - 2 * 3600_000, now)).toBe('2h');
    expect(formatRelative(now - 3 * 86_400_000, now)).toBe('3d');
    expect(formatRelative(now - 14 * 86_400_000, now)).toBe('2w');
    expect(formatRelative(Date.UTC(2026, 2, 12), now, { utc: true })).toBe('12 Mar');
    expect(formatRelative(Date.UTC(2025, 2, 12), now, { utc: true })).toBe("12 Mar '25");
    expect(formatRelative(null, now)).toBe('');
  });
});

describe('formatStamp', () => {
  const d = Date.UTC(2026, 2, 14, 7, 42, 10);
  it('matches the design stamp', () => {
    expect(formatStamp(d, { utc: true })).toBe("14 03 '26 · 07:42:10");
    expect(formatStamp(d, { utc: true, seconds: false })).toBe("14 03 '26 · 07:42");
    expect(formatStamp(d, { utc: true, time: false })).toBe("14 03 '26");
    expect(formatStamp('not a date')).toBe('');
  });
});

describe('small helpers', () => {
  it('countdown / resend', () => {
    expect(formatCountdown(((7 * 60 + 42) * 60 + 10) * 1000)).toBe('07:42:10');
    expect(formatCountdown(-1)).toBe('00:00:00');
    expect(formatResend(24)).toBe('0:24');
    expect(formatResend(90)).toBe('1:30');
  });
  it('counts', () => {
    expect(formatCount(1204)).toBe('1,204');
    expect(pluralize(1, 'photo')).toBe('1 photo');
    expect(pluralize(1204, 'photo')).toBe('1,204 photos');
  });
  it('initials', () => {
    expect(initials('Meera Iyer')).toBe('MI');
    expect(initials('diya')).toBe('D');
    expect(initials('  ')).toBe('?');
    expect(initials('Kabir Singh Shah')).toBe('KS');
  });
  it('birthday', () => {
    expect(formatBirthday(12, 8)).toBe('12 August');
    expect(formatBirthday(null, 8)).toBe('');
    expect(daysInMonth(2)).toBe(29);
    expect(daysInMonth(4)).toBe(30);
    expect(daysInMonth(12)).toBe(31);
  });
});

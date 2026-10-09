import { describe, expect, it } from 'vitest';
import { formatRevealClock, revealCountdownLabel, sealedUntil } from './reveal';

const NOW = Date.parse('2026-03-14T01:00:00Z');

describe('sealed countdown', () => {
  it('formats under a day as HH:MM:SS', () => {
    expect(revealCountdownLabel('2026-03-14T08:42:10Z', NOW)).toBe('Reveal in 07:42:10');
  });

  it('adds days beyond 24 hours', () => {
    expect(formatRevealClock(2 * 86_400_000 + 3_723_000)).toBe('2d 01:02:03');
  });

  it('is null once revealed or without a time', () => {
    expect(revealCountdownLabel('2026-03-13T00:00:00Z', NOW)).toBeNull();
    expect(revealCountdownLabel(null, NOW)).toBeNull();
  });

  it('uses the later of reveal_at and locked_until while still in the future', () => {
    expect(
      sealedUntil({ reveal_at: '2026-03-14T08:00:00Z', locked_until: '2026-04-01T00:00:00Z' }, NOW),
    ).toBe('2026-04-01T00:00:00Z');
    expect(sealedUntil({ reveal_at: '2026-03-01T00:00:00Z', locked_until: null }, NOW)).toBeNull();
  });
});

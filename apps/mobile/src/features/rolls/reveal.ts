import { formatCountdown } from '../../lib/format';

/** The moment a sealed Roll opens: the later of `reveal_at` / `locked_until` while still in the future. */
export function sealedUntil(
  roll: { reveal_at: string | null; locked_until?: string | null },
  now: number = Date.now(),
): string | null {
  const times = [roll.reveal_at, roll.locked_until ?? null]
    .filter((t): t is string => !!t)
    .map((t) => ({ t, ms: new Date(t).getTime() }))
    .filter((x) => !Number.isNaN(x.ms) && x.ms > now)
    .sort((a, b) => b.ms - a.ms);
  return times[0]?.t ?? null;
}

/** "07:42:10", or "2d 07:42:10" once more than a day away. */
export function formatRevealClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const dayMs = 24 * 60 * 60 * 1000;
  if (total < dayMs) return formatCountdown(total);
  const days = Math.floor(total / dayMs);
  return `${days}d ${formatCountdown(total - days * dayMs)}`;
}

/** "Reveal in 07:42:10"; null when the time has passed or there is none. */
export function revealCountdownLabel(until: string | null, now: number = Date.now()): string | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (Number.isNaN(ms) || ms <= 0) return null;
  return `Reveal in ${formatRevealClock(ms)}`;
}

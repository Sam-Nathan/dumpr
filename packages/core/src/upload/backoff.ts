import { MAX_AUTO_ATTEMPTS, RETRY_BASE_MS, RETRY_JITTER, RETRY_MAX_MS } from './constants.ts';

/**
 * Delay before the next automatic attempt: min(5 s · 2^n, 15 min) ± 20 % jitter, where
 * n = attempt − 1 (the first failure waits ~5 s).
 *
 * @param attempt number of attempts that have failed so far (>= 1)
 * @param rand    uniform random in [0, 1) — injectable for tests
 */
export function retryDelayMs(attempt: number, rand: number = Math.random()): number {
  const n = Math.max(0, Math.floor(attempt) - 1);
  // 2^n overflows harmlessly to Infinity; clamp before jitter.
  const base = Math.min(RETRY_BASE_MS * 2 ** n, RETRY_MAX_MS);
  const r = Math.min(Math.max(rand, 0), 1);
  const jitter = 1 + (r * 2 - 1) * RETRY_JITTER;
  return Math.round(base * jitter);
}

/**
 * Timestamp (ms) of the next automatic attempt, or null when the item has used its
 * MAX_AUTO_ATTEMPTS automatic attempts and needs a manual retry.
 */
export function nextRetryAt(
  attempt: number,
  now: number,
  rand: number = Math.random(),
): number | null {
  if (attempt >= MAX_AUTO_ATTEMPTS) return null;
  return now + retryDelayMs(attempt, rand);
}

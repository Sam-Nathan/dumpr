/** Copy + ordering for the C4 upload rows. Pure, unit-tested; no React Native imports. */

/** The fields of an upload queue item the copy needs (structurally typed). */
export interface QueueItemLike {
  state: string;
  progress: number;
  errorCode?: string;
  retryAt?: number | null;
  pauseReason?: string;
}

export type LineTone = 'default' | 'secondary' | 'danger' | 'success';

export interface StatusLine {
  text: string;
  tone: LineTone;
}

const REASON: Record<string, string> = {
  network: 'Network dropped',
  timeout: 'Slow connection',
  internal: 'Something went wrong on our side',
  rate_limited: 'Too many tries, quick breather',
  storage_full: 'Your storage is full',
  storage_not_configured: 'Uploads are paused for now',
  uploads_disabled: 'Uploads are closed here',
  not_a_member: "You're no longer in this Roll",
  guests_not_allowed: 'This Roll needs an account',
  payload_too_large: 'File is over the size limit',
  read_failed: "Couldn't read this photo",
};

/** Short, never-blaming reason for a failed / blocked item. */
export function failureReason(code: string | undefined): string {
  if (!code) return "Didn't upload";
  return REASON[code] ?? "Didn't upload";
}

/** Whole-second countdown for the retry hint ("retrying in 10 s"). */
export function retryInSeconds(retryAt: number | null | undefined, now: number): number | null {
  if (retryAt == null) return null;
  return Math.max(0, Math.ceil((retryAt - now) / 1000));
}

export function statusLine(item: QueueItemLike, now: number): StatusLine {
  switch (item.state) {
    case 'failed': {
      const secs = retryInSeconds(item.retryAt, now);
      const base = failureReason(item.errorCode);
      return {
        text: secs === null ? `${base} · tap Retry` : `${base} · retrying in ${secs} s`,
        tone: 'danger',
      };
    }
    case 'blocked':
      return { text: failureReason(item.errorCode), tone: 'danger' };
    case 'paused':
      return {
        text:
          item.pauseReason === 'wifi_only'
            ? 'Waiting for Wi-Fi'
            : item.pauseReason === 'no_network'
              ? 'Waiting for network'
              : 'Paused',
        tone: 'secondary',
      };
    case 'queued':
      return { text: 'waiting', tone: 'secondary' };
    case 'preparing':
      return { text: 'preparing', tone: 'secondary' };
    case 'initiating':
      return { text: 'starting', tone: 'secondary' };
    case 'uploading':
      return {
        text: `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%`,
        tone: 'default',
      };
    case 'completing':
      return { text: 'finishing', tone: 'secondary' };
    case 'done':
      return { text: 'Uploaded', tone: 'success' };
    case 'duplicate':
      return { text: 'Already in the Roll', tone: 'secondary' };
    default:
      return { text: '', tone: 'secondary' };
  }
}

const GROUP: Record<string, number> = {
  failed: 0,
  blocked: 0,
  preparing: 1,
  initiating: 1,
  uploading: 1,
  completing: 1,
  queued: 2,
  paused: 2,
  done: 3,
  duplicate: 4,
};

/** Failed first, then in flight, then waiting, then finished. Cancelled items are dropped. Stable. */
export function sortQueue<T extends { state: string }>(items: readonly T[]): T[] {
  return items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.state !== 'cancelled')
    .sort((a, b) => (GROUP[a.it.state] ?? 5) - (GROUP[b.it.state] ?? 5) || a.i - b.i)
    .map(({ it }) => it);
}

/** True while there is something the person can still cancel. */
export function isCancellable(state: string): boolean {
  return !['done', 'duplicate', 'cancelled'].includes(state);
}

/** "9:00 AM" in the device's local time. */
export function formatClockTime(when: Date | number | string): string {
  const d = when instanceof Date ? when : new Date(when);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${suffix}`;
}

export type RevealMode = 'live' | 'end_of_event' | 'next_morning';

/** Eyebrow of the reveal card: "GOA '26 · NEXT-MORNING REVEAL". */
export function revealEyebrow(rollName: string, mode: RevealMode): string {
  const kind =
    mode === 'next_morning'
      ? 'NEXT-MORNING REVEAL'
      : mode === 'end_of_event'
        ? 'REVEAL WHEN IT ENDS'
        : 'REVEAL';
  return `${rollName.toUpperCase()} · ${kind}`;
}

/** Body of the reveal card. */
export function revealBody(count: number, revealAt: Date | number | string): string {
  const subject = count === 1 ? 'Your photo is' : `Your ${count} photos are`;
  return `${subject} sealed until ${formatClockTime(revealAt)}. Everyone sees the full Roll at the same moment.`;
}

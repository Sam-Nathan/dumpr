// Expo push client: pure helpers (chunking, token validation, ticket interpretation) plus a
// fetch-based sender with chunks of 100 and receipt-less error handling (we read the immediate
// tickets only; DeviceNotRegistered tickets tell us which tokens to delete).

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_CHUNK_SIZE = 100;

/** Android notification channels, one per pref group (architecture §3 notification_prefs). */
export type PushChannel = 'invites' | 'uploads' | 'chats' | 'reveals' | 'games';

export interface ExpoMessage {
  to: string;
  title: string;
  body?: string;
  /** Ids and routes only: never photo content. */
  data?: Record<string, unknown>;
  channelId?: PushChannel;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  ttl?: number;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Per-message outcome:
 *  ok       accepted by Expo
 *  invalid  token is dead (DeviceNotRegistered): delete it
 *  error    permanent failure for this message (retrying will not help)
 *  retry    transient failure (network, 429, 5xx, rate limit, deadline): try again later
 */
export type PushOutcome = 'ok' | 'invalid' | 'error' | 'retry';

export interface SendResult {
  outcomes: PushOutcome[];
  invalidTokens: string[];
  sent: number;
}

export function chunk<T>(items: readonly T[], size = EXPO_CHUNK_SIZE): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const TOKEN_RE = /^(?:Exponent|Expo)PushToken\[[^\]\s]+\]$/;
export function isExpoPushToken(t: unknown): t is string {
  return typeof t === 'string' && TOKEN_RE.test(t);
}

const TRANSIENT_TICKET_ERRORS = new Set(['MessageRateExceeded']);

/** Maps the tickets of one chunk (aligned with its messages) to outcomes. */
export function interpretTickets(messages: readonly ExpoMessage[], tickets: readonly ExpoTicket[] | null | undefined): SendResult {
  const outcomes: PushOutcome[] = [];
  const invalidTokens: string[] = [];
  let sent = 0;
  messages.forEach((m, i) => {
    const t = tickets?.[i];
    if (!t) {
      // Expo accepted the request but returned no ticket for this slot: do not re-send (could duplicate).
      outcomes.push('error');
      return;
    }
    if (t.status === 'ok') {
      outcomes.push('ok');
      sent++;
      return;
    }
    const err = t.details?.error;
    if (err === 'DeviceNotRegistered') {
      outcomes.push('invalid');
      invalidTokens.push(m.to);
    } else if (err && TRANSIENT_TICKET_ERRORS.has(err)) {
      outcomes.push('retry');
    } else {
      outcomes.push('error');
    }
  });
  return { outcomes, invalidTokens, sent };
}

export interface SendOptions {
  accessToken?: string | null;
  fetchImpl?: typeof fetch;
  /** Epoch ms after which remaining chunks are reported as `retry` instead of being sent. */
  deadline?: number;
  timeoutMs?: number;
}

/** Sends messages in chunks of 100. Never throws; failures become `retry` / `error` outcomes. */
export async function sendExpoPush(messages: readonly ExpoMessage[], opts: SendOptions = {}): Promise<SendResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const outcomes: PushOutcome[] = [];
  const invalidTokens: string[] = [];
  let sent = 0;
  for (const part of chunk(messages)) {
    if (opts.deadline !== undefined && Date.now() > opts.deadline) {
      outcomes.push(...part.map((): PushOutcome => 'retry'));
      continue;
    }
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-encoding': 'gzip, deflate',
      };
      if (opts.accessToken) headers.authorization = `Bearer ${opts.accessToken}`;
      const res = await doFetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(part),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        // 429 / 5xx are transient; other 4xx (bad payload, bad credentials) will not fix themselves.
        const transient = res.status === 429 || res.status >= 500;
        outcomes.push(...part.map((): PushOutcome => (transient ? 'retry' : 'error')));
        console.error('expo push http', res.status);
        continue;
      }
      const body = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
      const r = interpretTickets(part, Array.isArray(body?.data) ? body.data : null);
      outcomes.push(...r.outcomes);
      invalidTokens.push(...r.invalidTokens);
      sent += r.sent;
    } catch (e) {
      console.error('expo push failed', e instanceof Error ? e.name : typeof e);
      outcomes.push(...part.map((): PushOutcome => 'retry'));
    }
  }
  return { outcomes, invalidTokens, sent };
}

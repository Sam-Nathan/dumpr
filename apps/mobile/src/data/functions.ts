import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { AppError, parseFunctionError, toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';

export interface CallFunctionOptions {
  /** Defaults to POST when a body is given, otherwise GET. */
  method?: 'GET' | 'POST';
  /** Query string params (GET). */
  query?: Record<string, string | number | boolean | undefined>;
  /** Abort after this many ms (default 20 s). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Call a Supabase Edge Function. Sends `Authorization: Bearer <access token>` when signed in and
 * the `apikey` header always. Failures throw `AppError` with the `{ error: { code } }` code from the
 * function (or `network` / `timeout`).
 */
export async function callFunction<T>(
  name: string,
  body?: unknown,
  opts: CallFunctionOptions = {},
): Promise<T> {
  const method = opts.method ?? (body === undefined ? 'GET' : 'POST');
  const qs = opts.query
    ? '?' +
      Object.entries(opts.query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `${SUPABASE_URL}/functions/v1/${name}${qs}`;

  const token = await accessToken();
  const headers: Record<string, string> = { apikey: SUPABASE_ANON_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method === 'POST') headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  opts.signal?.addEventListener('abort', () => controller.abort());

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw toAppError(e);
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    throw (
      parseFunctionError(parsed, res.status) ??
      new AppError(
        res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'internal' : 'unknown',
        undefined,
        {
          status: res.status,
        },
      )
    );
  }
  const envelope = parseFunctionError(parsed, res.status);
  if (envelope) throw envelope;
  return parsed as T;
}

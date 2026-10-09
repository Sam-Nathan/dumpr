// CORS + JSON helpers and a handler wrapper that turns thrown HttpErrors into JSON errors.
// Error envelope (all functions): { "error": { "code": "<snake_code>", "message": "...", "details"?: ... } }

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://dumpr.app,https://www.dumpr.app,http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

export function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get('origin') ?? '';
  return {
    // Native apps send no Origin; browsers only get CORS for our own sites.
    'access-control-allow-origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://dumpr.app',
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
  };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, req?: Request, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json', ...extra },
  });
}

/**
 * Wraps a handler: CORS preflight, allowed methods, JSON error envelope.
 * Unknown errors are logged by type/code only (messages can carry user data).
 */
export function serve(
  handler: (req: Request) => Promise<Response>,
  methods: ReadonlyArray<'GET' | 'POST'> = ['POST'],
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
    if (!methods.includes(req.method as 'GET' | 'POST')) {
      return json({ error: { code: 'method_not_allowed', message: `Use ${methods.join(' or ')}` } }, 405, req);
    }
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status, req);
      }
      // Postgres raise from an RPC: '<snake_code>' messages map to 400s.
      const pg = e as { code?: string; message?: string } | null;
      if (pg && pg.code === 'P0001' && typeof pg.message === 'string' && /^[a-z_]+$/.test(pg.message)) {
        return json({ error: { code: pg.message, message: pg.message } }, 400, req);
      }
      console.error('unhandled', e instanceof Error ? e.name : typeof e, pg?.code ?? '');
      return json({ error: { code: 'internal', message: 'Something went wrong' } }, 500, req);
    }
  };
}

/** Reads a JSON body of at most `maxBytes` (enforced on streamed bytes, not only Content-Length). */
export async function readJson<T = unknown>(req: Request, maxBytes = 64_000): Promise<T> {
  const tooLarge = () => new HttpError(413, 'payload_too_large', 'Request body is too large');
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw tooLarge();
  if (!req.body) throw new HttpError(400, 'invalid_json', 'Body must be valid JSON');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Body must be valid JSON');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

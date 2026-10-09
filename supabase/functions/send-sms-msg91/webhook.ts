// Standard Webhooks (https://www.standardwebhooks.com) verification, as used by the Supabase Send SMS hook.
// signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`, HMAC-SHA256 with the base64 secret,
// header `webhook-signature` = space separated list of `v1,<base64 signature>`.

export const TOLERANCE_S = 5 * 60;

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'timestamp_out_of_range' | 'bad_signature' | 'bad_secret' };

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Accepts `v1,whsec_<base64>`, `whsec_<base64>` or the bare base64 secret. */
export function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const raw = secret.trim().replace(/^v1,/, '').replace(/^whsec_/, '');
  return b64decode(raw);
}

export async function sign(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secretBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return b64encode(new Uint8Array(mac));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(
  secret: string,
  headers: { get(name: string): string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigHeader = headers.get('webhook-signature');
  if (!id || !ts || !sigHeader) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSeconds - Number(ts)) > TOLERANCE_S) return { ok: false, reason: 'timestamp_out_of_range' };
  let expected: string;
  try {
    expected = await sign(secret, id, ts, body);
  } catch {
    return { ok: false, reason: 'bad_secret' };
  }
  for (const part of sigHeader.split(' ')) {
    const [version, sig] = part.split(',');
    if (version === 'v1' && sig && timingSafeEqual(sig, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}

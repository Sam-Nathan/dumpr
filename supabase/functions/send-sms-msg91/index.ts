// send-sms-msg91: Supabase "Send SMS" auth hook. Verifies the Standard Webhooks signature, then sends the
// OTP through MSG91's Flow API (DLT template). Responds in the hook's error shape.
import { corsHeaders } from '../_shared/http.ts';
import { flowBody, hookError, maskPhone, MSG91_FLOW_URL, msg91Accepted, msg91Config, mobilesFor, parseHookPayload } from './msg91.ts';
import { verifyWebhook } from './webhook.ts';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply(405, hookError(405, 'method_not_allowed'));

  const secret = Deno.env.get('SEND_SMS_HOOK_SECRET');
  const cfg = msg91Config((k) => Deno.env.get(k));
  if (!secret || !cfg) {
    console.error('send-sms-msg91: not configured');
    return reply(500, hookError(500, 'sms_not_configured'));
  }

  const raw = await req.text();
  if (raw.length > 16_000) return reply(413, hookError(413, 'payload_too_large'));
  const verdict = await verifyWebhook(secret, req.headers, raw);
  if (!verdict.ok) {
    console.error('send-sms-msg91: signature rejected', verdict.reason);
    return reply(401, hookError(401, 'invalid_signature'));
  }

  let payload;
  try {
    payload = parseHookPayload(JSON.parse(raw));
  } catch {
    payload = null;
  }
  const mobiles = payload ? mobilesFor(payload.phone) : null;
  if (!payload || !mobiles) return reply(400, hookError(400, 'invalid_payload'));

  try {
    const res = await fetch(MSG91_FLOW_URL, {
      method: 'POST',
      headers: { authkey: cfg.authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(flowBody(cfg, mobiles, payload.otp)),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (!msg91Accepted(res.status, body)) {
      console.error('send-sms-msg91: msg91 rejected', res.status, (body as { type?: string } | null)?.type ?? '', maskPhone(payload.phone));
      return reply(500, hookError(500, 'sms_failed'));
    }
    return reply(200, {});
  } catch (e) {
    console.error('send-sms-msg91: request failed', e instanceof Error ? e.name : typeof e, maskPhone(payload.phone));
    return reply(500, hookError(500, 'sms_failed'));
  }
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('send-sms-msg91: unhandled', e instanceof Error ? e.name : typeof e);
    return reply(500, hookError(500, 'sms_failed'));
  }
});

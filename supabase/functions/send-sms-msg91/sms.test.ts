import { assertEquals } from 'jsr:@std/assert@1';
import { destinationAllowed, flowBody, hookError, maskPhone, mobilesFor, msg91Accepted, msg91Config, parseHookPayload } from './msg91.ts';
import { sign, verifyWebhook } from './webhook.ts';

// Known vector from the Standard Webhooks reference docs.
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const TS = '1614265330';
const BODY = '{"test": 2432232314}';
const SIG = 'g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
const NOW = 1614265330 + 10;

const hdr = (o: Record<string, string>) => new Headers(o);

Deno.test('sign matches the known vector (with and without the v1, prefix)', async () => {
  assertEquals(await sign(SECRET, ID, TS, BODY), SIG);
  assertEquals(await sign(`v1,${SECRET}`, ID, TS, BODY), SIG);
});

Deno.test('verify accepts a valid signature, including among several', async () => {
  const h = hdr({ 'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': `v1,AAAA v1,${SIG}` });
  assertEquals(await verifyWebhook(`v1,${SECRET}`, h, BODY, NOW), { ok: true });
});

Deno.test('verify rejects tampering, stale timestamps and missing headers', async () => {
  const h = hdr({ 'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': `v1,${SIG}` });
  assertEquals((await verifyWebhook(SECRET, h, BODY + ' ', NOW)).ok, false);
  const stale = await verifyWebhook(SECRET, h, BODY, 1614265330 + 301);
  assertEquals(stale, { ok: false, reason: 'timestamp_out_of_range' });
  assertEquals((await verifyWebhook(SECRET, h, BODY, 1614265330 - 301)).ok, false);
  assertEquals(await verifyWebhook(SECRET, hdr({}), BODY, NOW), { ok: false, reason: 'missing_headers' });
  assertEquals(
    await verifyWebhook(SECRET, hdr({ 'webhook-id': ID, 'webhook-timestamp': 'abc', 'webhook-signature': `v1,${SIG}` }), BODY, NOW),
    { ok: false, reason: 'bad_timestamp' },
  );
  assertEquals((await verifyWebhook('v1,whsec_AAAA', h, BODY, NOW)).ok, false);
  const wrongVersion = hdr({ 'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': `v2,${SIG}` });
  assertEquals((await verifyWebhook(SECRET, wrongVersion, BODY, NOW)).ok, false);
});

Deno.test('msg91 config, number format and flow body', () => {
  assertEquals(msg91Config(() => undefined), null);
  const env: Record<string, string> = { MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't' };
  const cfg = msg91Config((k) => env[k])!;
  assertEquals(cfg.androidHash, '');
  assertEquals(mobilesFor('+91 98765-43210'), '919876543210');
  assertEquals(mobilesFor('12'), null);
  assertEquals(flowBody(cfg, '919876543210', '123456'), {
    template_id: 't',
    short_url: '0',
    recipients: [{ mobiles: '919876543210', otp: '123456', hash: '' }],
  });
});

Deno.test('hook payload, masking and response classification', () => {
  assertEquals(parseHookPayload({ user: { phone: '+919876543210' }, sms: { otp: '123456' } }), { phone: '+919876543210', otp: '123456' });
  assertEquals(parseHookPayload({ user: {}, sms: { otp: '1' } }), null);
  assertEquals(parseHookPayload({ user: { phone: '+91' }, sms: { otp: '' } }), null);
  assertEquals(maskPhone('+919876543210'), '**10');
  assertEquals(msg91Accepted(200, { type: 'success' }), true);
  assertEquals(msg91Accepted(200, { type: 'error', message: 'bad template' }), false);
  assertEquals(msg91Accepted(401, { type: 'error' }), false);
  assertEquals(msg91Accepted(200, null), true);
  assertEquals(hookError(500, 'sms_failed'), { error: { http_code: 500, message: 'sms_failed' } });
});

Deno.test('F11: OTPs go to Indian mobiles only unless SMS_ALLOWED_PREFIXES widens it', () => {
  for (const ok of ['919876543210', '916000000000', '917999999999']) assertEquals(destinationAllowed(ok), true, ok);
  for (const bad of [
    '911234567890', // 91 but landline-style first digit
    '91987654321', // too short
    '9198765432100', // too long
    '447911123456', // UK
    '12025550123', // US
    '19005551234', // premium-style
    '9792123456789',
    '', 'abc', '+919876543210', // the hook strips "+" before this check
  ]) {
    assertEquals(destinationAllowed(bad), false, bad);
  }
  assertEquals(destinationAllowed('447911123456', ''), false);
  assertEquals(destinationAllowed('447911123456', '44'), true);
  assertEquals(destinationAllowed('447911123456', '91, +44'), true);
  assertEquals(destinationAllowed('12025550123', '91,44'), false);
  assertEquals(destinationAllowed('911234567890', '91'), true); // an explicit prefix is the operator's call
  assertEquals(destinationAllowed('447911123456', 'garbage,,'), false); // unusable override falls back to the default
  assertEquals(destinationAllowed('919876543210', 'garbage'), true);
});

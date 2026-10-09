import { assertEquals } from 'jsr:@std/assert@1';
import { chunk, type ExpoMessage, interpretTickets, isExpoPushToken, sendExpoPush } from './push.ts';

const msg = (to: string): ExpoMessage => ({ to, title: 't' });

Deno.test('chunk splits into groups of 100', () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  assertEquals(chunk(items).map((c) => c.length), [100, 100, 50]);
  assertEquals(chunk([], 100), []);
});

Deno.test('isExpoPushToken', () => {
  assertEquals(isExpoPushToken('ExponentPushToken[abc_DEF-123]'), true);
  assertEquals(isExpoPushToken('ExpoPushToken[xyz]'), true);
  assertEquals(isExpoPushToken('fcm-token'), false);
  assertEquals(isExpoPushToken('ExponentPushToken[]'), false);
  assertEquals(isExpoPushToken(null), false);
});

Deno.test('interpretTickets maps ok / DeviceNotRegistered / transient / permanent', () => {
  const ms = ['a', 'b', 'c', 'd', 'e'].map(msg);
  const r = interpretTickets(ms, [
    { status: 'ok', id: '1' },
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', details: { error: 'MessageRateExceeded' } },
    { status: 'error', details: { error: 'MessageTooBig' } },
  ]);
  assertEquals(r.outcomes, ['ok', 'invalid', 'retry', 'error', 'error']);
  assertEquals(r.invalidTokens, ['b']);
  assertEquals(r.sent, 1);
});

Deno.test('sendExpoPush chunks, collects invalid tokens, and reports transient failures', async () => {
  const calls: number[] = [];
  const fakeFetch = ((_url: string, init: RequestInit) => {
    const batch = JSON.parse(init.body as string) as ExpoMessage[];
    calls.push(batch.length);
    if (calls.length === 2) return Promise.resolve(new Response('busy', { status: 503 }));
    const data = batch.map((m) =>
      m.to === 'dead' ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' }
    );
    return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
  }) as unknown as typeof fetch;
  const messages = Array.from({ length: 230 }, (_, i) => msg(i === 3 ? 'dead' : `tok${i}`));
  const r = await sendExpoPush(messages, { fetchImpl: fakeFetch, accessToken: 'secret' });
  assertEquals(calls, [100, 100, 30]);
  assertEquals(r.outcomes.length, 230);
  assertEquals(r.outcomes[3], 'invalid');
  assertEquals(r.outcomes[150], 'retry');
  assertEquals(r.outcomes[229], 'ok');
  assertEquals(r.invalidTokens, ['dead']);
  assertEquals(r.sent, 99 + 30);
});

Deno.test('sendExpoPush after the deadline reports retry without calling Expo', async () => {
  let called = false;
  const fakeFetch = (() => {
    called = true;
    return Promise.resolve(new Response('{}'));
  }) as unknown as typeof fetch;
  const r = await sendExpoPush([msg('a')], { fetchImpl: fakeFetch, deadline: Date.now() - 1 });
  assertEquals(r.outcomes, ['retry']);
  assertEquals(called, false);
});

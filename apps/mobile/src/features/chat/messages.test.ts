import { describe, expect, it } from 'vitest';
import type { ChatMessage, PendingMessage } from '../../data/types-cf';
import {
  cleanBody,
  dayHeading,
  mergeMessages,
  messagePreview,
  parseThreadKey,
  prependMessage,
  starterPrompts,
  summarizeReactions,
  threadKeyOf,
  toggleReaction,
} from './messages';

const ME = {
  id: 'me',
  author: { display_name: 'Me', avatar_key: null, ring_color: 'lime' as const },
};
const REF = { kind: 'crew' as const, id: 'c1' };
const T0 = Date.UTC(2026, 2, 13, 10, 0, 0);
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  crew_id: 'c1',
  roll_id: null,
  thread_key: 'c:c1',
  author_id: 'kabir',
  client_id: `client-${id}`,
  body: id,
  photo_id: null,
  reply_to_id: null,
  kind: 'text',
  deleted_at: null,
  created_at: at(0),
  author: null,
  reactions: [],
  photo: null,
  ...over,
});
const pend = (clientId: string, over: Partial<PendingMessage> = {}): PendingMessage => ({
  clientId,
  threadKey: 'c:c1',
  body: 'hi',
  photoId: null,
  replyToId: null,
  kind: 'text',
  createdAt: at(10),
  status: 'sending',
  ...over,
});

describe('thread keys', () => {
  it('parses and builds', () => {
    expect(parseThreadKey('c:1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed')).toEqual({
      kind: 'crew',
      id: '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed',
    });
    expect(parseThreadKey(encodeURIComponent('r:abcdef12-3456'))?.kind).toBe('roll');
    expect(parseThreadKey('x:123')).toBeNull();
    expect(parseThreadKey(undefined)).toBeNull();
    expect(threadKeyOf('roll', 'abc')).toBe('r:abc');
  });
});

describe('mergeMessages', () => {
  it('orders newest first and drops deleted / duplicated rows', () => {
    const rows = [
      msg('b', { created_at: at(2) }),
      msg('a', { created_at: at(1) }),
      msg('a', { created_at: at(1) }),
      msg('x', { created_at: at(3), deleted_at: at(4) }),
    ];
    const out = mergeMessages(rows, [], ME, REF, 'c1');
    expect(out.map((m) => m.id)).toEqual(['b', 'a']);
  });
  it('shows pending messages first and removes them once the server row has their client_id', () => {
    const server = [msg('s1', { created_at: at(5) })];
    const out = mergeMessages(server, [pend('p1')], ME, REF, 'c1');
    expect(out[0]?.pending).toBe('sending');
    expect(out[0]?.author_id).toBe('me');
    const confirmed = [
      msg('s2', { client_id: 'p1', author_id: 'me', created_at: at(10) }),
      ...server,
    ];
    const after = mergeMessages(confirmed, [pend('p1')], ME, REF, 'c1');
    expect(after.some((m) => m.pending)).toBe(false);
    expect(after).toHaveLength(2);
  });
  it('keeps failed messages visible with their status', () => {
    const out = mergeMessages([], [pend('p1', { status: 'failed' })], ME, REF, 'c1');
    expect(out[0]?.pending).toBe('failed');
  });
  it('groups runs by one author within 5 minutes and splits on days', () => {
    const rows = [
      msg('3', { author_id: 'k', created_at: at(3) }),
      msg('2', { author_id: 'k', created_at: at(2) }),
      msg('1', { author_id: 'k', created_at: at(-20) }),
      msg('0', { author_id: 'd', created_at: at(-30) }),
      msg('old', { author_id: 'd', created_at: at(-60 * 30) }),
    ];
    const out = mergeMessages(rows, [], ME, REF, 'c1');
    const by = Object.fromEntries(out.map((m) => [m.id, m]));
    expect(by['3']?.showAuthor).toBe(false);
    expect(by['2']?.showAuthor).toBe(true); // 22 min after '1'
    expect(by['1']?.showAuthor).toBe(true); // author changed
    expect(by['0']?.showDay).toBe(true);
    expect(by['old']?.showDay).toBe(true);
    expect(by['3']?.showDay).toBe(false);
  });
  it('hides reported messages for the reporter', () => {
    const out = mergeMessages([msg('a'), msg('b')], [], ME, REF, 'c1', new Set(['a']));
    expect(out.map((m) => m.id)).toEqual(['b']);
  });
});

describe('prependMessage', () => {
  it('adds a new message to the newest page once', () => {
    const pages = [[msg('a')], [msg('z')]];
    const next = prependMessage(pages, msg('b'));
    expect(next[0]?.map((m) => m.id)).toEqual(['b', 'a']);
    expect(prependMessage(next, msg('b'))[0]).toHaveLength(2);
  });
  it('merges the server row into the matching client_id', () => {
    const pages = [[msg('a', { client_id: 'k1' })]];
    const next = prependMessage(pages, msg('a2', { client_id: 'k1', body: 'edited' }));
    expect(next[0]).toHaveLength(1);
    expect(next[0]?.[0]?.body).toBe('edited');
  });
  it('works on an empty list', () => {
    expect(prependMessage([], msg('a'))).toEqual([[msg('a')]]);
  });
});

describe('reactions', () => {
  it('summarizes with mine and orders by count', () => {
    const s = summarizeReactions(
      [
        { user_id: 'a', kind: 'LMAO' },
        { user_id: 'me', kind: 'ICONIC' },
        { user_id: 'b', kind: 'ICONIC' },
      ],
      'me',
    );
    expect(s).toEqual([
      { kind: 'ICONIC', n: 2, mine: true },
      { kind: 'LMAO', n: 1, mine: false },
    ]);
  });
  it('toggle removes the same word and replaces another', () => {
    const base = [{ user_id: 'me', kind: 'LMAO' as const }];
    expect(toggleReaction(base, 'me', 'LMAO')).toEqual([]);
    expect(toggleReaction(base, 'me', 'HEART')).toEqual([{ user_id: 'me', kind: 'HEART' }]);
    expect(toggleReaction([], 'me', 'SAME')).toHaveLength(1);
  });
});

describe('small helpers', () => {
  it('day headings', () => {
    const now = new Date(2026, 2, 13, 12).getTime();
    expect(dayHeading(new Date(2026, 2, 13, 1).toISOString(), now)).toBe('Today');
    expect(dayHeading(new Date(2026, 2, 12, 23).toISOString(), now)).toBe('Yesterday');
    expect(dayHeading(new Date(2026, 2, 10, 9).toISOString(), now)).toBe('Tue 10 Mar');
  });
  it('previews, prompts, body cleaning', () => {
    expect(messagePreview({ body: ' hi ', kind: 'text', photo_id: null })).toBe('hi');
    expect(messagePreview({ body: null, kind: 'photo', photo_id: 'p' })).toBe('Photo');
    expect(starterPrompts('crew', 'Goa Gang')).toHaveLength(3);
    expect(starterPrompts('roll', "Goa '26")).toHaveLength(3);
    expect(cleanBody('   ')).toBeNull();
    expect(cleanBody(' hey ')).toBe('hey');
    expect(cleanBody('x'.repeat(3000))).toHaveLength(2000);
  });
});

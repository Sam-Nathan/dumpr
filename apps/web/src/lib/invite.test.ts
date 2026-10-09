import { describe, expect, it } from 'vitest';
import { edgeCopy, inviteView, isValidInviteCode, parseInvitePreview } from './invite';
import { inviteMeta } from './seo';

const ok = {
  status: 'ok',
  kind: 'roll',
  crew: { id: 'c1', name: 'Goa Gang', tint: 'sky' },
  roll: {
    id: 'r1',
    name: "Goa '26",
    starts_on: '2026-03-12',
    ends_on: '2026-03-15',
    photo_count: 142,
    sealed: false,
    reveal_at: null,
  },
  host: { display_name: 'Kabir', avatar_key: null },
  member_count: 6,
  facepile: [{ display_name: 'Diya', ring_color: 'lime' }],
  cover_thumb_key: 't/x',
  cover_url: 'https://cdn.example/t.jpg',
  requires_approval: false,
  allow_guests: true,
  viewer: { is_member: false, request_pending: false },
};

describe('parseInvitePreview', () => {
  it('parses a full payload', () => {
    const p = parseInvitePreview(ok)!;
    expect(p.roll?.photoCount).toBe(142);
    expect(p.coverUrl).toBe('https://cdn.example/t.jpg');
    expect(p.host?.displayName).toBe('Kabir');
    expect(p.facepile).toHaveLength(1);
    expect(p.allowGuests).toBe(true);
  });
  it('flags sealed rolls and tolerates a missing cover', () => {
    const p = parseInvitePreview({ ...ok, cover_url: null, roll: { ...ok.roll, sealed: true } })!;
    expect(p.roll?.sealed).toBe(true);
    expect(p.coverUrl).toBeNull();
  });
  it('rejects junk', () => {
    expect(parseInvitePreview(null)).toBeNull();
    expect(parseInvitePreview({ status: 'weird' })).toBeNull();
    expect(parseInvitePreview([])).toBeNull();
  });
  it('survives partial dead-invite payloads', () => {
    const p = parseInvitePreview({ status: 'expired', host: { display_name: 'Tanvi' } })!;
    expect(p.status).toBe('expired');
    expect(p.host?.displayName).toBe('Tanvi');
  });
});

describe('inviteView / edgeCopy', () => {
  it('network failure -> error copy', () => {
    const v = inviteView({ ok: false, reason: 'network' });
    expect(v.type).toBe('error');
    if (v.type !== 'live') {
      const c = edgeCopy(v);
      expect(c.headline).toBe("We couldn't load this invite");
      expect(c.body).toBe('Check your connection.');
      expect(c.retry).toBe(true);
    }
  });
  it('expired uses the F6 copy and the host name', () => {
    const v = inviteView({
      ok: true,
      preview: parseInvitePreview({ status: 'expired', host: { display_name: 'Tanvi' } })!,
    });
    if (v.type !== 'dead') throw new Error('expected dead');
    const c = edgeCopy(v);
    expect(c.headline).toBe('This invite link has expired');
    expect(c.body).toBe('Links last 7 days unless the host changes it.');
    expect(c.ask).toBe('Ask Tanvi for a new one');
  });
  it('falls back to "the host"', () => {
    const v = inviteView({ ok: true, preview: parseInvitePreview({ status: 'revoked' })! });
    if (v.type !== 'dead') throw new Error('expected dead');
    expect(edgeCopy(v).ask).toBe('Ask the host for a new one');
  });
  it('ok -> live', () =>
    expect(inviteView({ ok: true, preview: parseInvitePreview(ok)! }).type).toBe('live'));
});

describe('misc', () => {
  it('validates codes', () => {
    expect(isValidInviteCode('abcd234567')).toBe(true);
    expect(isValidInviteCode('../etc')).toBe(false);
    expect(isValidInviteCode('')).toBe(false);
  });
  it('builds og meta', () => {
    const m = inviteMeta(parseInvitePreview(ok)!);
    expect(m.title).toBe("Goa '26 · 142 photos on Dumpr");
    expect(m.description).toContain('Kabir invited you');
  });
  it('crew meta', () => {
    const m = inviteMeta(parseInvitePreview({ ...ok, kind: 'crew', roll: null })!);
    expect(m.title).toBe('Goa Gang · 6 people on Dumpr');
  });
});

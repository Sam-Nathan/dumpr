import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../../data/types-cf';
import {
  buildActivityView,
  inboxBadgeCount,
  joinNames,
  sectionActivity,
  shortDate,
  unreadActivityCount,
} from './activityCopy';

const NOW = new Date(2026, 2, 13, 12, 0, 0).getTime();
const ev = (over: Partial<ActivityEvent>): ActivityEvent => ({
  id: 1,
  recipient_id: 'me',
  actor_id: 'a',
  crew_id: 'c1',
  roll_id: 'r1',
  photo_id: null,
  kind: 'invite',
  payload: {},
  created_at: new Date(NOW - 2 * 60_000).toISOString(),
  read_at: null,
  actor: { display_name: 'Rohan', avatar_key: null, ring_color: 'lime' },
  ...over,
});
const text = (v: { segments: { text: string }[] }) => v.segments.map((s) => s.text).join('');

describe('buildActivityView', () => {
  it('invite: Join / Preview link / Decline', () => {
    const v = buildActivityView(
      ev({ payload: { roll_name: 'Ananya × Rohan', code: 'abc', crew_name: 'X' } }),
      NOW,
    );
    expect(text(v)).toBe('Rohan invited you to Ananya × Rohan');
    expect(v.actions.map((a) => a.id)).toEqual(['join', 'preview', 'decline']);
    expect(v.time).toBe('2m');
    expect(v.unread).toBe(true);
    expect(v.segments[0]?.bold).toBe(true);
  });
  it('invite without a code has no preview action', () => {
    const v = buildActivityView(ev({ payload: { crew_name: 'Goa Gang' } }), NOW);
    expect(v.actions.map((a) => a.id)).toEqual(['join', 'decline']);
    expect(text(v)).toContain('Goa Gang');
  });
  it('batched uploads read "Diya added 24 photos to Goa \'26"', () => {
    const v = buildActivityView(
      ev({
        kind: 'upload_batch',
        read_at: 'x',
        actor: null,
        payload: {
          count: 24,
          uploader_name: 'Diya',
          roll_name: "Goa '26",
          sample_photo_ids: ['p1', 'p2', 'p3'],
        },
      }),
      NOW,
    );
    expect(text(v)).toBe("Diya added 24 photos to Goa '26");
    expect(v.thumbPhotoIds).toEqual(['p1', 'p2']);
    expect(v.unread).toBe(false);
    expect(v.href).toBe('/roll/r1');
  });
  it('reaction names are joined and reactions are words', () => {
    const v = buildActivityView(
      ev({
        kind: 'reaction',
        photo_id: 'ph',
        payload: { names: ['Aarav', 'Kabir', 'Diya'], reaction: 'iconic' },
      }),
      NOW,
    );
    expect(text(v)).toBe('Aarav, Kabir and 1 more said ICONIC on your photo');
    expect(v.href).toBe('/photo/ph');
  });
  it('reveal is the lime look; join requests carry Approve / Deny', () => {
    const r = buildActivityView(
      ev({ kind: 'reveal', payload: { roll_name: "Goa '26", count: 312, contributors: 6 } }),
      NOW,
    );
    expect(r.look).toBe('reveal');
    expect(text(r)).toBe("Goa '26 is revealed. 312 photos from 6 phones are in.");
    const j = buildActivityView(
      ev({ kind: 'join_request', payload: { requester_name: 'Tanvi', request_id: 'q' } }),
      NOW,
    );
    expect(j.actions.map((a) => a.id)).toEqual(['approve', 'deny']);
    expect(text(j)).toContain('Tanvi wants to join');
  });
  it('removal requests: pending vs decided', () => {
    const pending = buildActivityView(
      ev({
        kind: 'removal_request',
        photo_id: 'p',
        payload: { request_id: 'q', status: 'pending' },
      }),
      NOW,
    );
    expect(pending.actions.map((a) => a.id)).toEqual(['remove_photo', 'keep_photo']);
    const done = buildActivityView(
      ev({ kind: 'removal_request', payload: { status: 'approved' } }),
      NOW,
    );
    expect(done.actions).toEqual([]);
    expect(text(done)).toContain('removed the photo you asked about');
  });
  it('crew deleted shows the deadline and a download action', () => {
    const v = buildActivityView(
      ev({
        kind: 'crew_deleted',
        roll_id: null,
        payload: { crew_name: 'Goa Gang', purge_after: new Date(2026, 3, 12, 12).toISOString() },
      }),
      NOW,
    );
    expect(text(v)).toBe('Rohan deleted Goa Gang. You have until 12 Apr to download your copies.');
    expect(v.actions[0]?.id).toBe('download');
    expect(v.href).toBe('/crew/c1');
  });
  it('mentions link to the chat thread', () => {
    const v = buildActivityView(
      ev({ kind: 'mention', payload: { thread_key: 'r:r1', snippet: 'hey @me' } }),
      NOW,
    );
    expect(v.href).toBe('/chat/r:r1');
    expect(text(v)).toBe('Rohan mentioned you: “hey @me”');
  });
});

describe('sections + counts', () => {
  it('splits today / earlier', () => {
    const today = ev({ id: 2 });
    const earlier = ev({ id: 1, created_at: new Date(NOW - 3 * 24 * 3600_000).toISOString() });
    const s = sectionActivity([today, earlier], NOW);
    expect(s.map((x) => x.title)).toEqual(['TODAY', 'EARLIER']);
    expect(sectionActivity([earlier], NOW).map((x) => x.title)).toEqual(['EARLIER']);
    expect(sectionActivity([], NOW)).toEqual([]);
  });
  it('counts', () => {
    expect(unreadActivityCount([{ read_at: null }, { read_at: 'x' }, { read_at: null }])).toBe(2);
    expect(inboxBadgeCount(3, 2)).toBe(5);
    expect(inboxBadgeCount(-1, 2)).toBe(2);
    expect(joinNames([])).toBe('Someone');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(shortDate(null)).toBe('');
  });
});

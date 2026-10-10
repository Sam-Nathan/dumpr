import { describe, expect, it } from 'vitest';
import {
  inviteHref,
  inviteUrl,
  notificationUrlToPath,
  parseInviteLink,
  rewriteIncomingPath,
} from './deeplinks';

describe('parseInviteLink', () => {
  it('parses web links', () => {
    expect(parseInviteLink('https://dumpr.app/r/k7qm2xpa9d')).toEqual({
      code: 'k7qm2xpa9d',
      kind: 'roll',
    });
    expect(parseInviteLink('https://www.dumpr.app/c/ABCdef2345?utm=wa')).toEqual({
      code: 'abcdef2345',
      kind: 'crew',
    });
    expect(parseInviteLink('dumpr.app/r/k7qm2xpa9d/')).toEqual({
      code: 'k7qm2xpa9d',
      kind: 'roll',
    });
    expect(parseInviteLink('  http://dumpr.app/r/k7qm2xpa9d  ')).toEqual({
      code: 'k7qm2xpa9d',
      kind: 'roll',
    });
  });

  it('parses app-scheme links and router paths', () => {
    expect(parseInviteLink('dumpr://r/k7qm2xpa9d')).toEqual({ code: 'k7qm2xpa9d', kind: 'roll' });
    expect(parseInviteLink('dumpr://c/k7qm2xpa9d')).toEqual({ code: 'k7qm2xpa9d', kind: 'crew' });
    expect(parseInviteLink('/r/k7qm2xpa9d')).toEqual({ code: 'k7qm2xpa9d', kind: 'roll' });
  });

  it('accepts a bare code', () => {
    expect(parseInviteLink('k7qm2xpa9d')).toEqual({ code: 'k7qm2xpa9d', kind: null });
  });

  it('rejects other links and junk', () => {
    expect(parseInviteLink('https://evil.app/r/k7qm2xpa9d')).toBeNull();
    expect(parseInviteLink('https://dumpr.app/x/k7qm2xpa9d')).toBeNull();
    expect(parseInviteLink('https://dumpr.app/r/')).toBeNull();
    expect(parseInviteLink('dumpr.app.evil.com/r/k7qm2xpa9d')).toBeNull();
    expect(parseInviteLink('hi')).toBeNull();
    expect(parseInviteLink('hello there')).toBeNull();
    expect(parseInviteLink('')).toBeNull();
    expect(parseInviteLink(undefined)).toBeNull();
    expect(parseInviteLink('https://dumpr.app/r/%E0%A4%A')).toBeNull();
  });
});

describe('rewriteIncomingPath', () => {
  it('maps invite links to the A4 route', () => {
    expect(rewriteIncomingPath('https://dumpr.app/r/k7qm2xpa9d')).toBe('/invite/k7qm2xpa9d');
    expect(rewriteIncomingPath('dumpr://c/k7qm2xpa9d')).toBe('/invite/k7qm2xpa9d');
    expect(rewriteIncomingPath('/r/k7qm2xpa9d')).toBe('/invite/k7qm2xpa9d');
  });
  it('leaves other paths alone', () => {
    expect(rewriteIncomingPath('/roll/123')).toBe('/roll/123');
    expect(rewriteIncomingPath('dumpr://auth/callback?code=abc')).toBe(
      'dumpr://auth/callback?code=abc',
    );
    expect(rewriteIncomingPath('k7qm2xpa9d')).toBe('k7qm2xpa9d');
  });
  it('builds hrefs and urls', () => {
    expect(inviteHref('abc')).toBe('/invite/abc');
    expect(inviteUrl('abc', 'roll')).toBe('https://dumpr.app/r/abc');
    expect(inviteUrl('abc', 'crew', 'https://dumpr.app/')).toBe('https://dumpr.app/c/abc');
  });
});

describe('notificationUrlToPath', () => {
  const id = '3f1c2b9e-8a41-4f0b-9d7e-5a6b7c8d9e0f';

  it('maps push-dispatch urls to app paths', () => {
    expect(notificationUrlToPath(`dumpr://roll/${id}`)).toBe(`/roll/${id}`);
    expect(notificationUrlToPath(`dumpr://crew/${id}`)).toBe(`/crew/${id}`);
    expect(notificationUrlToPath(`dumpr://photo/${id}`)).toBe(`/photo/${id}`);
    expect(notificationUrlToPath('dumpr://invite/abc234')).toBe('/invite/abc234');
    expect(notificationUrlToPath('dumpr://inbox')).toBe('/inbox');
    expect(notificationUrlToPath('dumpr://inbox/')).toBe('/inbox');
  });

  it('keeps the chat thread key url-encoded as the route param', () => {
    expect(notificationUrlToPath(`dumpr://chat/c%3A${id}`)).toBe(`/chat/c%3A${id}`);
    expect(notificationUrlToPath(`dumpr://chat/r:${id}`)).toBe(`/chat/r%3A${id}`);
    expect(notificationUrlToPath('dumpr://chat/x%3Aabc')).toBeNull();
    expect(notificationUrlToPath('dumpr://chat/%E0%A4%A')).toBeNull();
  });

  it('understands shareable invite links', () => {
    expect(notificationUrlToPath('dumpr://r/k7qm2xpa9d')).toBe('/invite/k7qm2xpa9d');
    expect(notificationUrlToPath('https://dumpr.app/c/k7qm2xpa9d')).toBe('/invite/k7qm2xpa9d');
  });

  it('ignores query strings and rejects anything else', () => {
    expect(notificationUrlToPath(`dumpr://roll/${id}?x=1`)).toBe(`/roll/${id}`);
    expect(notificationUrlToPath('dumpr://roll')).toBeNull();
    expect(notificationUrlToPath('dumpr://roll/../../you')).toBeNull();
    expect(notificationUrlToPath('dumpr://unknown/abc')).toBeNull();
    expect(notificationUrlToPath('https://evil.example/r/k7qm2xpa9d')).toBeNull();
    expect(notificationUrlToPath('')).toBeNull();
    expect(notificationUrlToPath(undefined)).toBeNull();
  });
});

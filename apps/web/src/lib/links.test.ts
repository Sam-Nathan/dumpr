import { describe, expect, it } from 'vitest';
import { askHostUrl, deepLinkFor, platformFromUserAgent, storeUrlFor } from './links';

describe('links', () => {
  it('deep links', () => {
    expect(deepLinkFor('roll', 'abc234')).toBe('dumpr://r/abc234');
    expect(deepLinkFor('crew', 'abc234')).toBe('dumpr://c/abc234');
  });
  it('platform detection', () => {
    expect(platformFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(platformFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('ios');
    expect(platformFromUserAgent('Mozilla/5.0 (Macintosh)')).toBe('other');
    expect(storeUrlFor('other')).toBeNull();
    expect(storeUrlFor('android')).toContain('play.google.com');
    expect(storeUrlFor('ios')).toContain('apps.apple.com');
  });
  it('asks the host over whatsapp', () => {
    const u = askHostUrl('Tanvi', "Goa '26");
    expect(u.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(u)).toContain('Hi Tanvi');
  });
});

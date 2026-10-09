import { describe, expect, it } from 'vitest';
import { buildSignBody, mediaKey, parseSignResponse } from './media';

describe('media-sign helpers', () => {
  it('builds the request body', () =>
    expect(buildSignBody([{ photo_id: 'p1', variant: 'thumb' }])).toEqual({
      items: [{ photo_id: 'p1', variant: 'thumb' }],
    }));
  it('keys by photo_id:variant', () => expect(mediaKey('p1', 'original')).toBe('p1:original'));
  it('keeps only http(s) urls', () =>
    expect(
      parseSignResponse({
        urls: { 'a:thumb': 'https://r2/a', 'b:thumb': 'javascript:alert(1)', 'c:thumb': 5 },
      }),
    ).toEqual({ 'a:thumb': 'https://r2/a' }));
  it('tolerates junk', () => {
    expect(parseSignResponse(null)).toEqual({});
    expect(parseSignResponse({ urls: 'x' })).toEqual({});
  });
});

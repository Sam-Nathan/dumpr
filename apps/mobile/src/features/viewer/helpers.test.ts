import { describe, expect, it } from 'vitest';
import {
  albumName,
  applyReaction,
  captionParts,
  extensionFor,
  saveVariantFor,
  withTombstones,
} from './helpers';

describe('withTombstones', () => {
  it('keeps a placeholder where a photo disappeared', () => {
    const prev = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const next = [{ id: 'a' }, { id: 'c' }];
    expect(withTombstones(prev, next)).toEqual([
      { id: 'a' },
      { id: 'b', removed: true },
      { id: 'c' },
    ]);
  });

  it('keeps an old placeholder across refreshes and drops it when nothing changed', () => {
    const first = withTombstones([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }]);
    expect(withTombstones(first, [{ id: 'a' }])).toEqual(first);
    expect(withTombstones([{ id: 'a' }], [{ id: 'a' }, { id: 'z' }])).toEqual([
      { id: 'a' },
      { id: 'z' },
    ]);
  });

  it('appends rows from the next page after a placeholder', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    const next = [{ id: 'a' }, { id: 'c' }];
    expect(withTombstones(prev, next).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('save helpers', () => {
  it('names the Android album Dumpr/<Roll> without path characters', () => {
    expect(albumName("Goa '26")).toBe("Dumpr/Goa '26");
    expect(albumName('a/b:c*')).toBe('Dumpr/a b c');
    expect(albumName('   ')).toBe('Dumpr');
  });

  it('asks Android for the JPG variant of HEIC photos only', () => {
    expect(saveVariantFor('image/heic', 'android')).toBe('display');
    expect(saveVariantFor('image/heif', 'android')).toBe('display');
    expect(saveVariantFor('image/heic', 'ios')).toBe('original');
    expect(saveVariantFor('image/jpeg', 'android')).toBe('original');
  });

  it('picks a file extension', () => {
    expect(extensionFor('image/heic', 'original')).toBe('heic');
    expect(extensionFor('image/heic', 'display')).toBe('jpg');
    expect(extensionFor('image/png', 'original')).toBe('png');
    expect(extensionFor(null, 'original')).toBe('jpg');
  });
});

describe('captionParts', () => {
  it('marks hashtags', () => {
    expect(captionParts('Nani won #nani-supremacy ok')).toEqual([
      { text: 'Nani won ', tag: false },
      { text: '#nani-supremacy', tag: true },
      { text: ' ok', tag: false },
    ]);
    expect(captionParts('')).toEqual([]);
  });
});

describe('applyReaction', () => {
  it('moves my reaction from one word to another', () => {
    const next = applyReaction({ counts: { ICONIC: 9, LMAO: 6 }, mine: 'LMAO' }, 'ICONIC');
    expect(next).toEqual({ counts: { ICONIC: 10, LMAO: 5 }, mine: 'ICONIC' });
  });
  it('adds and removes without going negative', () => {
    expect(applyReaction({ counts: {}, mine: null }, 'HEART')).toEqual({
      counts: { HEART: 1 },
      mine: 'HEART',
    });
    expect(applyReaction({ counts: { HEART: 1 }, mine: 'HEART' }, null)).toEqual({
      counts: { HEART: 0 },
      mine: null,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { BlurhashError, blurhashAverageColor, decode, encode, isBlurhashValid, validateBlurhash } from './index.ts';

type Rgb = [number, number, number];
function img(w: number, h: number, f: (x: number, y: number) => Rgb): Uint8ClampedArray {
  const p = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      const o = 4 * (y * w + x);
      p[o] = r;
      p[o + 1] = g;
      p[o + 2] = b;
      p[o + 3] = 255;
    }
  return p;
}

// Vectors generated with the reference implementation (npm blurhash@2.0.5).
const VECTORS: { name: string; w: number; h: number; f: (x: number, y: number) => Rgb; cx: number; cy: number; hash: string }[] = [
  { name: 'black', w: 4, h: 4, f: () => [0, 0, 0], cx: 4, cy: 3, hash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ' },
  { name: 'white', w: 4, h: 4, f: () => [255, 255, 255], cx: 4, cy: 3, hash: 'L~TSUA~qfQ~q~q%MfQ%MfQfQfQfQ' },
  { name: 'lime', w: 8, h: 8, f: () => [200, 255, 60], cx: 4, cy: 3, hash: 'LfN39P?:fQ?:?:oxfQoxfQfQfQfQ' },
  { name: 'gradient', w: 32, h: 32, f: (x, y) => [x * 8, y * 8, 128], cx: 4, cy: 3, hash: 'LDH2cX3B|cO?uwRno1aOhVf%fQf%' },
  {
    name: 'checker',
    w: 16,
    h: 16,
    f: (x, y) => (((x >> 2) + (y >> 2)) % 2 ? [255, 0, 0] : [0, 0, 255]),
    cx: 4,
    cy: 3,
    hash: 'LLLjfL,efQ,e,eFPfQ2NfQfQfQfQ',
  },
  {
    name: '9x9 components',
    w: 24,
    h: 20,
    f: (x, y) => [(x * y) % 256, (x * 13) % 256, (y * 29) % 256],
    cx: 9,
    cy: 9,
    hash:
      '|XC@mS96HgucmYb]XPm[X~Bfnj#oX5R,oJj@WVbGJg$4SMSLwxWoa|jso1s}WCR,xDR,bFoKWVj@n[SKwxSKjtsSSMn~jtb$nmWDbbr[ShoKjcW:SNo1a|sUSMo1o1SMo1t8WEjHX7nkj[W:sCW:Wja{o1a{jtWoo1Woa|',
  },
  { name: '1x1 component', w: 5, h: 7, f: (x, y) => [x * 50, y * 30, 200], cx: 1, cy: 1, hash: '00Ee,D' },
];

describe('blurhash encode', () => {
  for (const v of VECTORS) {
    it(`matches the reference for ${v.name}`, () => {
      expect(encode(img(v.w, v.h, v.f), v.w, v.h, v.cx, v.cy)).toBe(v.hash);
    });
  }

  it('defaults to 4x3 components', () => {
    expect(encode(img(4, 4, () => [0, 0, 0]), 4, 4)).toBe('L00000fQfQfQfQfQfQfQfQfQfQfQ');
  });

  it('accepts Uint8Array as well as Uint8ClampedArray', () => {
    const px = new Uint8Array(img(32, 32, (x, y) => [x * 8, y * 8, 128]));
    expect(encode(px, 32, 32)).toBe('LDH2cX3B|cO?uwRno1aOhVf%fQf%');
  });

  it('rejects bad arguments', () => {
    expect(() => encode(new Uint8ClampedArray(16), 2, 2, 0, 3)).toThrow(BlurhashError);
    expect(() => encode(new Uint8ClampedArray(16), 2, 2, 4, 10)).toThrow(BlurhashError);
    expect(() => encode(new Uint8ClampedArray(15), 2, 2)).toThrow(BlurhashError);
    expect(() => encode(new Uint8ClampedArray(0), 0, 0)).toThrow(BlurhashError);
  });
});

describe('blurhash decode', () => {
  it('matches the reference decoder for the canonical sample hash', () => {
    const out = decode('LEHV6nWB2yk8pyo0adR*.7kCMdnj', 4, 3);
    expect(Array.from(out)).toEqual([
      135, 164, 177, 255, 161, 173, 177, 255, 181, 180, 171, 255, 160, 172, 174, 255, 124, 154, 169, 255, 148, 148, 154,
      255, 164, 145, 134, 255, 146, 152, 155, 255, 124, 144, 154, 255, 144, 134, 132, 255, 163, 130, 104, 255, 148, 140,
      134, 255,
    ]);
  });

  it('round-trips a solid colour', () => {
    const hash = encode(img(8, 8, () => [200, 255, 60]), 8, 8);
    const out = decode(hash, 3, 3);
    for (let i = 0; i < 9; i++) {
      expect(Math.abs(out[i * 4]! - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs(out[i * 4 + 1]! - 255)).toBeLessThanOrEqual(1);
      expect(Math.abs(out[i * 4 + 2]! - 60)).toBeLessThanOrEqual(1);
      expect(out[i * 4 + 3]).toBe(255);
    }
  });

  it('produces width·height·4 bytes', () => {
    expect(decode('LEHV6nWB2yk8pyo0adR*.7kCMdnj', 32, 20).length).toBe(32 * 20 * 4);
  });

  it('validates hashes', () => {
    expect(isBlurhashValid('LEHV6nWB2yk8pyo0adR*.7kCMdnj')).toBe(true);
    expect(validateBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdnj')).toEqual({ componentX: 4, componentY: 3 });
    expect(isBlurhashValid('LEHV6nWB2yk8pyo0adR*.7kCMdn')).toBe(false); // too short for 4x3
    expect(isBlurhashValid('abc')).toBe(false);
    expect(isBlurhashValid('LEHV6nWB2yk8pyo0adR*.7kCMd"j')).toBe(false); // bad char
    expect(() => decode('nope', 4, 4)).toThrow(BlurhashError);
  });

  it('reports the average colour', () => {
    expect(blurhashAverageColor('L00000fQfQfQfQfQfQfQfQfQfQfQ')).toBe('#000000');
    expect(blurhashAverageColor(encode(img(4, 4, () => [255, 255, 255]), 4, 4))).toBe('#ffffff');
  });
});

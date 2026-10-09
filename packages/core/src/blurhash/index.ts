// Small pure-TS BlurHash (https://blurha.sh) encoder + decoder, compatible with the reference
// implementation (woltapp/blurhash). Encode from a tiny (e.g. 32 px) RGBA buffer; decode to a
// small RGBA buffer for web placeholders.

const ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const DIGIT: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) DIGIT[ALPHABET[i]!] = i;

export class BlurhashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlurhashError';
  }
}

function encode83(value: number, length: number): string {
  let out = '';
  for (let i = 1; i <= length; i++) {
    const digit = Math.floor(value / 83 ** (length - i)) % 83;
    out += ALPHABET[digit];
  }
  return out;
}

function decode83(str: string): number {
  let value = 0;
  for (const c of str) {
    const d = DIGIT[c];
    if (d === undefined) throw new BlurhashError(`invalid blurhash character ${JSON.stringify(c)}`);
    value = value * 83 + d;
  }
  return value;
}

// sRGB byte → linear, via a 256-entry table (the encoder hits this w·h·3·components times).
const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v <= 0.0031308
    ? Math.trunc(v * 12.92 * 255 + 0.5)
    : Math.trunc((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5);
}

const signPow = (v: number, exp: number) => Math.sign(v) * Math.pow(Math.abs(v), exp);

/**
 * Encodes RGBA pixels (row-major, 4 bytes per pixel) to a BlurHash.
 * @param componentX horizontal components 1..9 (default 4)
 * @param componentY vertical components 1..9 (default 3)
 */
export function encode(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  componentX = 4,
  componentY = 3,
): string {
  if (componentX < 1 || componentX > 9 || componentY < 1 || componentY > 9) {
    throw new BlurhashError('BlurHash must have between 1 and 9 components');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new BlurhashError('width and height must be positive integers');
  }
  if (pixels.length !== width * height * 4)
    throw new BlurhashError('pixel array length must be width·height·4');

  // Precompute cosines per axis.
  const cosX = new Float64Array(componentX * width);
  for (let i = 0; i < componentX; i++)
    for (let x = 0; x < width; x++) cosX[i * width + x] = Math.cos((Math.PI * i * x) / width);
  const cosY = new Float64Array(componentY * height);
  for (let j = 0; j < componentY; j++)
    for (let y = 0; y < height; y++) cosY[j * height + y] = Math.cos((Math.PI * j * y) / height);

  const factors: [number, number, number][] = [];
  const scale = 1 / (width * height);
  for (let j = 0; j < componentY; j++) {
    for (let i = 0; i < componentX; i++) {
      const normalisation = i === 0 && j === 0 ? 1 : 2;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < height; y++) {
        const cy = cosY[j * height + y]!;
        const row = y * width * 4;
        for (let x = 0; x < width; x++) {
          const basis = normalisation * cosX[i * width + x]! * cy;
          const o = row + x * 4;
          r += basis * SRGB_TO_LINEAR[pixels[o]!]!;
          g += basis * SRGB_TO_LINEAR[pixels[o + 1]!]!;
          b += basis * SRGB_TO_LINEAR[pixels[o + 2]!]!;
        }
      }
      factors.push([r * scale, g * scale, b * scale]);
    }
  }

  const dc = factors[0]!;
  const ac = factors.slice(1);
  let hash = encode83(componentX - 1 + (componentY - 1) * 9, 1);

  let maximumValue: number;
  if (ac.length > 0) {
    // Matches the reference implementation, which takes the largest *signed* component.
    let actualMax = -Infinity;
    for (const f of ac) actualMax = Math.max(actualMax, f[0], f[1], f[2]);
    const quantisedMax = Math.floor(Math.max(0, Math.min(82, Math.floor(actualMax * 166 - 0.5))));
    maximumValue = (quantisedMax + 1) / 166;
    hash += encode83(quantisedMax, 1);
  } else {
    maximumValue = 1;
    hash += encode83(0, 1);
  }

  hash += encode83(
    (linearToSrgb(dc[0]) << 16) + (linearToSrgb(dc[1]) << 8) + linearToSrgb(dc[2]),
    4,
  );
  for (const f of ac) {
    const q = (v: number) =>
      Math.floor(Math.max(0, Math.min(18, Math.floor(signPow(v / maximumValue, 0.5) * 9 + 9.5))));
    hash += encode83(q(f[0]) * 19 * 19 + q(f[1]) * 19 + q(f[2]), 2);
  }
  return hash;
}

/** Throws BlurhashError when `hash` is not a well-formed BlurHash. */
export function validateBlurhash(hash: string): { componentX: number; componentY: number } {
  if (typeof hash !== 'string' || hash.length < 6)
    throw new BlurhashError('BlurHash must be at least 6 characters');
  const sizeFlag = decode83(hash[0]!);
  const componentY = Math.floor(sizeFlag / 9) + 1;
  const componentX = (sizeFlag % 9) + 1;
  if (hash.length !== 4 + 2 * componentX * componentY) {
    throw new BlurhashError(
      `BlurHash length mismatch: expected ${4 + 2 * componentX * componentY}, got ${hash.length}`,
    );
  }
  decode83(hash.slice(1)); // validates every character
  return { componentX, componentY };
}

export function isBlurhashValid(hash: string): boolean {
  try {
    validateBlurhash(hash);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decodes a BlurHash to RGBA pixels (`width`·`height`·4). Keep the output tiny (e.g. 32×32) and
 * let CSS scale it.
 * @param punch contrast boost (reference default 1)
 */
export function decode(hash: string, width: number, height: number, punch = 1): Uint8ClampedArray {
  const { componentX, componentY } = validateBlurhash(hash);
  const quantisedMax = decode83(hash[1]!);
  const maximumValue = (quantisedMax + 1) / 166;
  const colors: [number, number, number][] = new Array(componentX * componentY);

  const dcValue = decode83(hash.slice(2, 6));
  colors[0] = [
    SRGB_TO_LINEAR[dcValue >> 16]!,
    SRGB_TO_LINEAR[(dcValue >> 8) & 255]!,
    SRGB_TO_LINEAR[dcValue & 255]!,
  ];
  for (let i = 1; i < colors.length; i++) {
    const value = decode83(hash.slice(4 + i * 2, 6 + i * 2));
    const qr = Math.floor(value / (19 * 19));
    const qg = Math.floor(value / 19) % 19;
    const qb = value % 19;
    const m = maximumValue * punch;
    colors[i] = [
      signPow((qr - 9) / 9, 2) * m,
      signPow((qg - 9) / 9, 2) * m,
      signPow((qb - 9) / 9, 2) * m,
    ];
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const cosX = new Float64Array(componentX * width);
  for (let i = 0; i < componentX; i++)
    for (let x = 0; x < width; x++) cosX[i * width + x] = Math.cos((Math.PI * x * i) / width);
  const cosY = new Float64Array(componentY * height);
  for (let j = 0; j < componentY; j++)
    for (let y = 0; y < height; y++) cosY[j * height + y] = Math.cos((Math.PI * y * j) / height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < componentY; j++) {
        const cy = cosY[j * height + y]!;
        for (let i = 0; i < componentX; i++) {
          const basis = cosX[i * width + x]! * cy;
          const c = colors[i + j * componentX]!;
          r += c[0] * basis;
          g += c[1] * basis;
          b += c[2] * basis;
        }
      }
      const o = 4 * (x + y * width);
      out[o] = linearToSrgb(r);
      out[o + 1] = linearToSrgb(g);
      out[o + 2] = linearToSrgb(b);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Average colour of a BlurHash as '#rrggbb' (cheap placeholder background). */
export function blurhashAverageColor(hash: string): string {
  validateBlurhash(hash);
  const v = decode83(hash.slice(2, 6));
  return `#${v.toString(16).padStart(6, '0')}`;
}

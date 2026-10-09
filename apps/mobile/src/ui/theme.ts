import { colors as tokenColors, tints } from '@dumpr/ui-tokens';
import { useColorScheme } from 'react-native';
import type { CrewTint, RingColor } from '../data/types';

export type Scheme = 'light' | 'dark';

/** Current colour scheme ('light' when the OS reports none). */
export function useScheme(): Scheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

/** Semantic colours as hex strings, for places Tailwind classes cannot reach (SVG, native props). */
export function useColors() {
  return tokenColors(useScheme());
}

export type ThemeColors = ReturnType<typeof useColors>;

/** Tint hex for a Crew tint in the given scheme. */
export function tintHex(tint: CrewTint, scheme: Scheme): string {
  return tints[tint][scheme];
}

/** Always-ink surface (Welcome, camera, viewer): ink background, light text. */
export const INK = '#16141B';
export const INK_TEXT = '#F4F3F6';
export const FLASH = '#D4FF3F';
export const SHUTTER = '#FF6B2C';

/** Saturated ring colours for avatars (the pastel tints are too faint for a ring). */
export const RING_HEX: Record<RingColor, string> = {
  lime: '#D4FF3F',
  lilac: '#C3A9FF',
  sky: '#8AD3FF',
  peach: '#FFB48A',
};

/**
 * Static class strings (Tailwind scans source text, so these must stay literal).
 * Background of a tinted surface in light + dark.
 */
export const TINT_BG: Record<CrewTint, string> = {
  lilac: 'bg-tint-lilac dark:bg-tint-lilac-dark',
  lime: 'bg-tint-lime dark:bg-tint-lime-dark',
  sky: 'bg-tint-sky dark:bg-tint-sky-dark',
  peach: 'bg-tint-peach dark:bg-tint-peach-dark',
  pink: 'bg-tint-pink dark:bg-tint-pink-dark',
  mint: 'bg-tint-mint dark:bg-tint-mint-dark',
};

/** Stable "random" tint from a string (same person, same colour on every screen). */
export function tintFor(seed: string): CrewTint {
  const order: CrewTint[] = ['lilac', 'sky', 'peach', 'pink', 'mint', 'lime'];
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return order[h % order.length] as CrewTint;
}

/** Minimum touch target in dp (design-system §5). */
export const MIN_TARGET = 44;
export const PRESS_SCALE = 0.96;
export const PRESS_MS = 80;

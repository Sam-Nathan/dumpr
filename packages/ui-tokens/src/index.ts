import tokens from '../tokens.json';

export type ColorScheme = 'light' | 'dark';
export type TintName = keyof typeof tokens.tint;

export { tokens };

/** Semantic colour set for a scheme. Dark text colours are exposed as ink/ink2/ink3 like light. */
export function colors(scheme: ColorScheme) {
  if (scheme === 'light') return tokens.color.light;
  const { text, text2, text3, ...rest } = tokens.color.dark;
  return { ...rest, ink: text, ink2: text2, ink3: text3 };
}

/** Soft background tints for tiles / avatars, `{ light, dark }` per tint name. */
export const tints = tokens.tint;

/** Font family names (Google Fonts). On native use the loaded per-weight names from apps/mobile/src/lib/fonts.ts. */
export const fonts = tokens.font;

export const radius = tokens.radius;

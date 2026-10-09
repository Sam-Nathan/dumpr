// The publishable (anon) key is public by design (RLS protects data), so defaults are committed.
// NOTE: EXPO_PUBLIC_* must be accessed as literal `process.env.X` so Metro can inline them.
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://evxufdovegjrlwpxfmhl.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_D3N0JdBcmyy8QTkB86MF1Q_S7CHrh-r';

/** Public website origin, used to build invite links (https://dumpr.app/r/<code>). */
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://dumpr.app';

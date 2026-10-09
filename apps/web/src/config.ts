// The publishable (anon) key is public by design (RLS protects data), so defaults are committed.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://evxufdovegjrlwpxfmhl.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_D3N0JdBcmyy8QTkB86MF1Q_S7CHrh-r';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dumpr.app';

// TODO: replace with the real store listings once the apps are published.
export const PLAY_STORE_URL =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL ||
  'https://play.google.com/store/apps/details?id=app.dumpr';
export const APP_STORE_URL =
  process.env.NEXT_PUBLIC_APP_STORE_URL || 'https://apps.apple.com/app/dumpr/id0000000000';

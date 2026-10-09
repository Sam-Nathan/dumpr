// The publishable (anon) key is public by design (RLS protects data), so defaults are committed.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://evxufdovegjrlwpxfmhl.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_D3N0JdBcmyy8QTkB86MF1Q_S7CHrh-r';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dumpr.app';

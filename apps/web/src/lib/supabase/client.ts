import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@dumpr/db';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config';

/** Supabase client for Client Components (browser). */
export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}

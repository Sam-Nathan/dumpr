import { createServerClient } from '@supabase/ssr';
import type { Database } from '@dumpr/db';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config';

/** Supabase client for Server Components, Route Handlers and Server Actions (cookie session). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component: cookies are read-only there; a proxy refreshes sessions.
        }
      },
    },
  });
}

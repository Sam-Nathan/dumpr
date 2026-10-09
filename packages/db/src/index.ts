import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';
import type { Database } from './types.ts';

export type { Database } from './types.ts';
export type DumprClient = SupabaseClient<Database>;

/** Thin typed wrapper around supabase-js `createClient`. */
export function createDumprClient(
  url: string,
  key: string,
  options?: SupabaseClientOptions<'public'>,
): DumprClient {
  return createClient<Database>(url, key, options);
}

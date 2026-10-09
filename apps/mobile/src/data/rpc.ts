import { supabase } from '../lib/supabase';
import { toAppError } from '../lib/errors';

/**
 * Call a Postgres RPC. Throws `AppError { code }` (P0001 snake codes such as `invite_expired`,
 * network failures as `network`) so screens map `error.code` to copy via `errorCopy()`.
 */
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  let result;
  try {
    result = await supabase.rpc(name, args ?? {});
  } catch (e) {
    throw toAppError(e);
  }
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}

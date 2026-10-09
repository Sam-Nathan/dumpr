import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

// Functions are deployed with verify_jwt = false and authenticate here, so both the legacy anon JWT
// and the new sb_publishable_ keys work as the apikey.

export interface AuthedContext {
  userId: string;
  /** Anonymous (guest) session: is_anonymous claim. */
  isGuest: boolean;
  /** RLS as the caller: every query sees exactly what the user may see. */
  userClient: SupabaseClient;
  /** Service role: bypasses RLS. Only after an explicit permission check. */
  admin: SupabaseClient;
}

const url = () => Deno.env.get('SUPABASE_URL')!;
const anonKey = () => Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

let adminSingleton: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  adminSingleton ??= createClient(url(), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminSingleton;
}

export function bearer(req: Request): string {
  return (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

export async function requireUser(req: Request, opts: { allowGuest?: boolean } = {}): Promise<AuthedContext> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'not_authenticated', 'Sign in to continue');
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'not_authenticated', 'Your session has expired. Please sign in again');
  const isGuest = Boolean((data.user as { is_anonymous?: boolean }).is_anonymous);
  if (isGuest && !opts.allowGuest) throw new HttpError(403, 'guest_not_allowed', 'Create an account to do this');
  const userClient = createClient(url(), anonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: data.user.id, isGuest, userClient, admin };
}

/** For cron-invoked functions: constant-time compare of x-cron-secret with CRON_SECRET. */
export function requireCron(req: Request): void {
  const expected = Deno.env.get('CRON_SECRET') ?? '';
  const got = req.headers.get('x-cron-secret') ?? '';
  if (!expected || got.length !== expected.length) throw new HttpError(401, 'not_authenticated');
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw new HttpError(401, 'not_authenticated');
}

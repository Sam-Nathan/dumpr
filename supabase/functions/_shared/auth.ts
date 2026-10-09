import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError, isUuid } from './http.ts';

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

/** The identity inside a verified access token. */
export interface Identity {
  userId: string;
  isGuest: boolean;
}

/**
 * Identity from VERIFIED JWT claims (the signature / expiry check happens in `auth.getClaims`). A signed token
 * that is not a signed-in user's access token (the anon / service-role keys, an expired token) is rejected:
 * it needs `role = authenticated`, a UUID `sub` and an `exp` in the future. `is_anonymous` marks guests.
 */
export function identityFromClaims(claims: Record<string, unknown> | null | undefined, nowS = Math.floor(Date.now() / 1000)): Identity {
  const sub = claims?.sub;
  const exp = claims?.exp;
  if (
    !claims ||
    claims.role !== 'authenticated' ||
    typeof sub !== 'string' ||
    !isUuid(sub) ||
    typeof exp !== 'number' ||
    exp <= nowS
  ) {
    throw new HttpError(401, 'not_authenticated', 'Your session has expired. Please sign in again');
  }
  return { userId: sub.toLowerCase(), isGuest: claims.is_anonymous === true };
}

export async function requireUser(req: Request, opts: { allowGuest?: boolean } = {}): Promise<AuthedContext> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'not_authenticated', 'Sign in to continue');
  const admin = adminClient();
  // getClaims verifies the signature locally against the project's cached JWKS (asymmetric signing keys) and checks
  // exp: no round trip to the Auth server. Legacy HS256 secrets make supabase-js fall back to a getUser() call.
  const { data, error } = await admin.auth.getClaims(token);
  if (error || !data) throw new HttpError(401, 'not_authenticated', 'Your session has expired. Please sign in again');
  const { userId, isGuest } = identityFromClaims(data.claims as unknown as Record<string, unknown>);
  if (isGuest && !opts.allowGuest) throw new HttpError(403, 'guest_not_allowed', 'Create an account to do this');
  const userClient = createClient(url(), anonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId, isGuest, userClient, admin };
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

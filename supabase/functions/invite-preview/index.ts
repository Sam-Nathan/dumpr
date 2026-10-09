// invite-preview: preview of an invite for the web landing page, OG card and app A4. Works without a session.
// Calls the invite_preview RPC with the caller's own token when the request carries one (so viewer-specific
// rules such as the Surprise honoree's not_found hold), otherwise as anon; then signs the cover thumb and
// facepile avatars. Responses computed for a signed-in user are never cached.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, HttpError, serve } from '../_shared/http.ts';
import { r2Config } from '../_shared/env.ts';
import { createR2 } from '../_shared/r2.ts';
import {
  cacheControlFor,
  CODE_RE,
  COVER_TTL_S,
  decoratePreview,
  type InvitePreview,
  userAccessToken,
} from './logic.ts';

const handler = serve(async (req) => {
  const code = new URL(req.url).searchParams.get('code') ?? '';
  if (!CODE_RE.test(code)) throw new HttpError(400, 'invalid_input', 'code is required');

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const client = (token: string | null) =>
    createClient(url, anonKey, {
      global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      auth: { persistSession: false, autoRefreshToken: false },
    });
  let token = userAccessToken(req.headers.get('authorization'), anonKey);
  let res = await client(token).rpc('invite_preview', { p_code: code.toLowerCase() });
  if (res.error && token && res.status === 401) {
    // expired / invalid session: a preview is public, answer it as anon
    token = null;
    res = await client(null).rpc('invite_preview', { p_code: code.toLowerCase() });
  }
  const { data, error } = res;
  if (error) throw error;
  const preview = (data ?? { status: 'not_found' }) as InvitePreview;

  const cfg = r2Config();
  const r2 = cfg ? createR2(cfg) : null;
  const body = await decoratePreview(preview, r2 ? (k) => r2.presignGet(k, { expiresIn: COVER_TTL_S }) : null);

  // Signed URLs live 1 h; the anonymous response is cached for 60 s so they stay fresh for every consumer.
  const notFound = preview.status === 'not_found';
  return new Response(JSON.stringify(body), {
    status: notFound ? 404 : 200,
    headers: {
      ...corsHeaders(req),
      'content-type': 'application/json',
      'cache-control': cacheControlFor(token !== null),
      vary: 'origin, authorization',
    },
  });
}, ['GET']);

Deno.serve(handler);

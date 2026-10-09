// invite-preview: public (no auth) preview of an invite for the web landing page, OG card and app A4.
// Calls the invite_preview RPC as the anon role (so viewer-specific fields are always false and the
// response is safe to cache), then signs the cover thumb and facepile avatars.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, HttpError, serve } from '../_shared/http.ts';
import { r2Config } from '../_shared/env.ts';
import { createR2 } from '../_shared/r2.ts';
import { CODE_RE, COVER_TTL_S, decoratePreview, type InvitePreview } from './logic.ts';

const handler = serve(async (req) => {
  const code = new URL(req.url).searchParams.get('code') ?? '';
  if (!CODE_RE.test(code)) throw new HttpError(400, 'invalid_input', 'code is required');

  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.rpc('invite_preview', { p_code: code.toLowerCase() });
  if (error) throw error;
  const preview = (data ?? { status: 'not_found' }) as InvitePreview;

  const cfg = r2Config();
  const r2 = cfg ? createR2(cfg) : null;
  const body = await decoratePreview(preview, r2 ? (k) => r2.presignGet(k, { expiresIn: COVER_TTL_S }) : null);

  // Signed URLs live 1 h; the response is cached for 60 s so they stay fresh for every consumer.
  const notFound = preview.status === 'not_found';
  return new Response(JSON.stringify(body), {
    status: notFound ? 404 : 200,
    headers: {
      ...corsHeaders(req),
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60',
    },
  });
}, ['GET']);

Deno.serve(handler);

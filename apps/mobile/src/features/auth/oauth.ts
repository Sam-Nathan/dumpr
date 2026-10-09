import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { AppError, toAppError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'google' | 'apple';

/** The redirect registered in Supabase Auth > URL configuration (dumpr://auth/callback, exp://.../--/auth/callback in Expo Go). */
export function oauthRedirectUrl(): string {
  return Linking.createURL('auth/callback');
}

function readParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parsed = Linking.parse(url);
  for (const [k, v] of Object.entries(parsed.queryParams ?? {})) {
    if (typeof v === 'string') out[k] = v;
  }
  // Errors may come back in the fragment.
  const hash = url.split('#')[1];
  if (hash) {
    for (const pair of hash.split('&')) {
      const [k, v] = pair.split('=');
      if (k && v !== undefined) out[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return out;
}

/**
 * Google / Apple through the Supabase web OAuth flow (PKCE): opens an auth session in the browser,
 * then exchanges `?code=` for a session. Works on Android and iOS, and in Expo Go.
 * Resolves `false` when the person closed the browser (not an error).
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<boolean> {
  const redirectTo = oauthRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw toAppError(error);
  if (!data?.url) throw new AppError('auth_failed');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false;

  const params = readParams(result.url);
  if (params.error) throw new AppError('auth_failed', params.error_description ?? params.error);
  const code = params.code;
  if (!code) throw new AppError('auth_failed');
  const exchanged = await supabase.auth.exchangeCodeForSession(code);
  if (exchanged.error) throw toAppError(exchanged.error);
  return true;
}

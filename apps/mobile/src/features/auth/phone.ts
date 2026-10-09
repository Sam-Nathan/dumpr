import { toAppError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

/** Sends the SMS code (MSG91 via the Supabase Send-SMS hook). Throws AppError (rate_limited, sms_failed...). */
export async function sendPhoneOtp(e164: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
  if (error) throw toAppError(error);
}

/** Verifies the 6-digit code; on success the auth listener receives the session. */
export async function verifyPhoneOtp(e164: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: 'sms' });
  if (error) throw toAppError(error);
}

/** Guest session (only offered when arriving with an invite that allows guests). */
export async function continueAsGuest(): Promise<void> {
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw toAppError(error);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

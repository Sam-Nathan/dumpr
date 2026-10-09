/** Auth gate decision, pure so it is unit-tested. */

export interface GateProfile {
  display_name: string;
  handle: string | null;
  is_guest: boolean;
}

/** Names the `auth.users` trigger gives people before they finish profile setup (architecture §6). */
const DEFAULT_NAMES = new Set(['new user', 'guest', '']);

/** True when a signed-in, non-guest person still has to complete A3. */
export function needsProfileSetup(profile: GateProfile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.is_guest) return false;
  const name = profile.display_name.trim().toLowerCase();
  return !profile.handle || DEFAULT_NAMES.has(name);
}

export type AuthGateState = 'loading' | 'signed-out' | 'needs-profile' | 'ready' | 'error';

export function resolveGate(input: {
  authReady: boolean;
  hasSession: boolean;
  isGuest: boolean;
  profileLoading: boolean;
  profileError: boolean;
  profile: GateProfile | null | undefined;
}): AuthGateState {
  if (!input.authReady) return 'loading';
  if (!input.hasSession) return 'signed-out';
  if (input.isGuest) return 'ready';
  if (input.profile) return needsProfileSetup(input.profile) ? 'needs-profile' : 'ready';
  if (input.profileLoading) return 'loading';
  return input.profileError ? 'error' : 'loading';
}

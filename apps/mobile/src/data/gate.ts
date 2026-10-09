import { useProfile } from './profile';
import { type AuthGateState, resolveGate } from './profileGate';
import { useSession } from './session';

/** Root auth gate: loading | signed-out | needs-profile | ready | error. */
export function useAuthGate(): { state: AuthGateState; retry: () => void } {
  const { session, isGuest, isLoading } = useSession();
  const profile = useProfile();
  const state = resolveGate({
    authReady: !isLoading,
    hasSession: !!session,
    isGuest,
    profileLoading: profile.isLoading || profile.isFetching,
    profileError: profile.isError,
    profile: profile.data,
  });
  return { state, retry: () => void profile.refetch() };
}

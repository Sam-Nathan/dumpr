import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { clearMediaCaches } from './media';
import { queryClient } from './queryClient';
import { supabase } from '../lib/supabase';

interface AuthStore {
  session: Session | null;
  /** False until Supabase has restored (or not) the persisted session. */
  ready: boolean;
}

export const useAuthStore = create<AuthStore>(() => ({ session: null, ready: false }));

let started = false;

/** Subscribe once to auth changes. Called at import time; idempotent. */
export function startAuthListener(): void {
  if (started) return;
  started = true;
  supabase.auth.onAuthStateChange((event, session) => {
    // Never await supabase calls inside this callback (it holds the auth lock): only set state.
    useAuthStore.setState({ session, ready: true });
    if (event === 'SIGNED_OUT') {
      queryClient.clear();
      clearMediaCaches();
    }
  });
}

startAuthListener();

export interface SessionState {
  session: Session | null;
  user: User | null;
  /** Anonymous (guest) account: can join, view and add photos, nothing else. */
  isGuest: boolean;
  /** True until the persisted session has been restored. */
  isLoading: boolean;
}

/** Current auth state, kept live via `onAuthStateChange`. */
export function useSession(): SessionState {
  const session = useAuthStore((s) => s.session);
  const ready = useAuthStore((s) => s.ready);
  const user = session?.user ?? null;
  return { session, user, isGuest: user?.is_anonymous === true, isLoading: !ready };
}

/** Non-hook read for imperative code. */
export function getSessionSnapshot(): Session | null {
  return useAuthStore.getState().session;
}

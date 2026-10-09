import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * An invite the person opened before they had an account. Survives the sign-up flow and app
 * restarts, so after A2 + A3 they land in the Roll (flow 01 "Pending invite? yes -> A4 -> B3").
 */
export interface PendingInvite {
  code: string;
  kind: 'roll' | 'crew';
  /** Roll or Crew name, for the A3 banner ("Kabir invited you to Goa '26"). */
  title: string | null;
  hostName: string | null;
  /** The invite lets guests in: A2 then offers "Continue as guest". */
  allowGuests: boolean;
}

interface PendingInviteStore {
  pending: PendingInvite | null;
  /** Set once sign-up is finished: the root gate then opens A4, which joins automatically. */
  autoJoin: boolean;
  /** Invite codes the person declined (A4 shows "You declined ..." until they reopen it). */
  declined: Record<string, true>;
  setPending: (p: PendingInvite) => void;
  setAutoJoin: (v: boolean) => void;
  clear: () => void;
  decline: (code: string) => void;
  undecline: (code: string) => void;
}

export const usePendingInvite = create<PendingInviteStore>()(
  persist(
    (set) => ({
      pending: null,
      autoJoin: false,
      declined: {},
      setPending: (pending) => set({ pending, autoJoin: false }),
      setAutoJoin: (autoJoin) => set({ autoJoin }),
      clear: () => set({ pending: null, autoJoin: false }),
      decline: (code) => set((s) => ({ declined: { ...s.declined, [code]: true } })),
      undecline: (code) =>
        set((s) => {
          const { [code]: _drop, ...rest } = s.declined;
          return { declined: rest };
        }),
    }),
    {
      name: 'dumpr.pending-invite',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

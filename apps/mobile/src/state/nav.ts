import { useEffect, useRef } from 'react';
import { create } from 'zustand';

export type MainTab = 'crews' | 'inbox';

interface NavStore {
  /** Inbox badge = unread chats + pending invites. Written by the inbox track. */
  inboxBadge: number;
  setInboxBadge: (n: number) => void;
  /** Incremented when the active tab is tapped again ("tab re-tap scrolls to top"). */
  retap: { tab: MainTab; n: number };
  notifyRetap: (tab: MainTab) => void;
}

export const useNavStore = create<NavStore>((set, get) => ({
  inboxBadge: 0,
  setInboxBadge: (n) => set({ inboxBadge: Math.max(0, Math.floor(n)) }),
  retap: { tab: 'crews', n: 0 },
  notifyRetap: (tab) => set({ retap: { tab, n: get().retap.n + 1 } }),
}));

/** Run `callback` (e.g. scrollToTop) whenever the user re-taps this tab in the nav pill. */
export function useNavRetap(tab: MainTab, callback: () => void): void {
  const retap = useNavStore((s) => s.retap);
  const first = useRef(retap.n);
  const cb = useRef(callback);
  cb.current = callback;
  useEffect(() => {
    if (retap.n !== first.current && retap.tab === tab) cb.current();
    first.current = retap.n;
  }, [retap, tab]);
}

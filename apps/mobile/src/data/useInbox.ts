import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { inboxBadgeCount } from '../features/inbox/activityCopy';
import { toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useNavStore } from '../state/nav';
import { rpc } from './rpc';
import { useSession } from './session';
import type { ActivityEvent, InboxThread } from './types-cf';

export const inboxThreadsKey = ['inbox-threads'] as const;
export const activityKey = ['activity'] as const;
export const activityUnreadKey = ['activity-unread'] as const;

const PAGE = 30;
const ACTIVITY_SELECT =
  'id, recipient_id, actor_id, crew_id, roll_id, photo_id, kind, payload, created_at, read_at, actor:profiles!actor_id(display_name, avatar_key, ring_color)';

/** C6 Chats: one row per Crew / Roll thread (`inbox_threads()`). */
export function useInboxThreads() {
  const { user } = useSession();
  return useQuery({
    queryKey: inboxThreadsKey,
    enabled: !!user,
    staleTime: 15_000,
    queryFn: () => rpc<InboxThread[]>('inbox_threads'),
  });
}

/** C6 Activity: own `activity_events`, newest first, keyset-paged on the identity id. */
export function useActivity() {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: activityKey,
    enabled: !!user,
    staleTime: 15_000,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }): Promise<ActivityEvent[]> => {
      let q = supabase
        .from('activity_events')
        .select(ACTIVITY_SELECT)
        .order('id', { ascending: false })
        .limit(PAGE);
      if (pageParam !== null) q = q.lt('id', pageParam);
      const { data, error } = await q;
      if (error) throw toAppError(error);
      return (data ?? []) as unknown as ActivityEvent[];
    },
    getNextPageParam: (last) =>
      last.length >= PAGE ? (last[last.length - 1]?.id ?? null) : undefined,
  });
}

/** Number of unread activity events (cheap head count). */
export function useUnreadActivityCount() {
  const { user } = useSession();
  return useQuery({
    queryKey: activityUnreadKey,
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('activity_events')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (error) throw toAppError(error);
      return count ?? 0;
    },
  });
}

export function flattenActivity(data: InfiniteData<ActivityEvent[]> | undefined): ActivityEvent[] {
  return data ? data.pages.flat() : [];
}

function patchActivity(qc: QueryClient, fn: (e: ActivityEvent) => ActivityEvent): void {
  qc.setQueryData<InfiniteData<ActivityEvent[]>>(activityKey, (old) =>
    old ? { ...old, pages: old.pages.map((p) => p.map(fn)) } : old,
  );
}

/** Marks events read (all when `ids` is omitted) and updates the caches optimistically. */
export async function markActivityRead(qc: QueryClient, ids?: number[]): Promise<void> {
  const now = new Date().toISOString();
  const set = ids ? new Set(ids) : null;
  patchActivity(qc, (e) => (e.read_at || (set && !set.has(e.id)) ? e : { ...e, read_at: now }));
  qc.setQueryData<number>(activityUnreadKey, (n) =>
    n === undefined ? n : set ? Math.max(0, n - set.size) : 0,
  );
  try {
    await rpc<void>('mark_activity_read', { p_ids: ids ?? null });
  } finally {
    void qc.invalidateQueries({ queryKey: activityUnreadKey });
  }
}

/** Marks every thread with unread messages as read. */
export async function markAllThreadsRead(
  qc: QueryClient,
  threads: readonly InboxThread[],
): Promise<void> {
  const unread = threads.filter((t) => t.unread_count > 0);
  qc.setQueryData<InboxThread[]>(inboxThreadsKey, (old) =>
    old?.map((t) => (t.unread_count > 0 ? { ...t, unread_count: 0 } : t)),
  );
  await Promise.all(
    unread.map((t) => rpc<void>('mark_thread_read', { p_thread_key: t.thread_key })),
  );
  void qc.invalidateQueries({ queryKey: inboxThreadsKey });
  void qc.invalidateQueries({ queryKey: ['home-feed'] });
}

/** Removes one event from the Activity cache (after Join / Decline / Approve ...). */
export function dropActivity(qc: QueryClient, id: number): void {
  qc.setQueryData<InfiniteData<ActivityEvent[]>>(activityKey, (old) =>
    old ? { ...old, pages: old.pages.map((p) => p.filter((e) => e.id !== id)) } : old,
  );
}

// ---------------------------------------------------------------- decisions

export interface JoinOutcome {
  status: string;
  crew_id: string;
  roll_id: string | null;
}

export function respondDirectInvite(id: string, accept: boolean) {
  return rpc<JoinOutcome>('respond_direct_invite', { p_id: id, p_accept: accept });
}

export function decideJoinRequest(id: string, approve: boolean) {
  return rpc<void>('decide_join_request', { p_id: id, p_approve: approve });
}

export function decideRemovalRequest(id: string, approve: boolean) {
  return rpc<void>('decide_removal_request', { p_id: id, p_approve: approve });
}

// ---------------------------------------------------------------- badge + realtime

/**
 * Keeps the nav pill badge (unread chats + unread activity) fresh and subscribes to realtime
 * inserts: new activity for me, new messages in my threads. Mount once inside the main layout.
 */
export function useInboxBadgeSync(): void {
  const { user } = useSession();
  const qc = useQueryClient();
  const threads = useInboxThreads();
  const unread = useUnreadActivityCount();
  const setBadge = useNavStore((s) => s.setInboxBadge);
  const unreadThreads = (threads.data ?? []).filter((t) => t.unread_count > 0 && !t.muted).length;
  const unreadActivity = unread.data ?? 0;

  useEffect(() => {
    setBadge(inboxBadgeCount(unreadThreads, unreadActivity));
  }, [setBadge, unreadThreads, unreadActivity]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user) return undefined;
    const bump = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: inboxThreadsKey });
      }, 800);
    };
    const channel = supabase
      .channel(`inbox:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_events',
          filter: `recipient_id=eq.${user.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: activityKey });
          void qc.invalidateQueries({ queryKey: activityUnreadKey });
        },
      )
      // RLS limits message inserts to threads this person can read.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, bump)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void supabase.removeChannel(channel);
    };
  }, [user, qc]);
}

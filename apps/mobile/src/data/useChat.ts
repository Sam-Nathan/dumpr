import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { prependMessage, toggleReaction, type ThreadRef } from '../features/chat/messages';
import { toAppError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { inboxThreadsKey } from './useInbox';
import { rpc } from './rpc';
import { useSession } from './session';
import type { ReactionKind } from './types';
import type { ChatMessage, CrewOverviewLite, PendingMessage, RollHeaderLite } from './types-cf';

export const messagesKey = (threadKey: string) => ['messages', threadKey] as const;

const PAGE = 40;
export const MESSAGE_SELECT =
  'id, crew_id, roll_id, thread_key, author_id, client_id, body, photo_id, reply_to_id, kind, deleted_at, created_at, author:profiles!author_id(display_name, avatar_key, ring_color), reactions:message_reactions(user_id, kind), photo:photos!photo_id(id, sort_at, roll:rolls!photos_roll_id_fkey(name))';

type Pages = InfiniteData<ChatMessage[], string | null>;

/** Newest-first pages of a thread, paginating older messages with `created_at < oldest`. */
export function useMessages(threadKey: string | null) {
  const { user } = useSession();
  return useInfiniteQuery({
    queryKey: messagesKey(threadKey ?? ''),
    enabled: !!user && !!threadKey,
    staleTime: 10_000,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ChatMessage[]> => {
      let q = supabase
        .from('messages')
        .select(MESSAGE_SELECT)
        .eq('thread_key', threadKey as string)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const { data, error } = await q;
      if (error) throw toAppError(error);
      return (data ?? []) as unknown as ChatMessage[];
    },
    getNextPageParam: (last) =>
      last.length >= PAGE ? (last[last.length - 1]?.created_at ?? null) : undefined,
  });
}

/** Header info for a thread: name, tint, member count (Crew) or crew name (Roll). */
export function useThreadInfo(ref: ThreadRef | null) {
  const crew = useQuery({
    queryKey: ['crew', ref?.id ?? ''],
    enabled: ref?.kind === 'crew',
    queryFn: () => rpc<CrewOverviewLite>('crew_overview', { p_crew_id: ref?.id }),
  });
  const roll = useQuery({
    queryKey: ['roll-header', ref?.id ?? ''],
    enabled: ref?.kind === 'roll',
    queryFn: () => rpc<RollHeaderLite>('roll_header', { p_roll_id: ref?.id }),
  });
  if (ref?.kind === 'crew') {
    const d = crew.data;
    return {
      isLoading: crew.isLoading,
      error: crew.error,
      refetch: crew.refetch,
      info: d
        ? {
            title: d.crew.name,
            subtitle: `${d.members.length} ${d.members.length === 1 ? 'member' : 'members'} · Crew chat`,
            tint: d.crew.tint,
            crewId: d.crew.id,
            rollId: null as string | null,
            deleted: !!d.crew.deleted_at,
            rolls: d.rolls,
            members: d.members,
          }
        : null,
    };
  }
  const d = roll.data;
  return {
    isLoading: roll.isLoading,
    error: roll.error,
    refetch: roll.refetch,
    info: d
      ? {
          title: d.roll.name,
          subtitle: `${d.crew.name} · Roll chat`,
          tint: d.crew.tint,
          crewId: d.roll.crew_id,
          rollId: d.roll.id as string | null,
          deleted: !!d.crew.deleted_at,
          rolls: [
            {
              id: d.roll.id,
              name: d.roll.name,
              photo_count: d.photo_count,
              sealed: d.sealed,
              live: false,
              last_activity_at: '',
            },
          ],
          members: [] as CrewOverviewLite['members'],
        }
      : null,
  };
}

// ---------------------------------------------------------------- optimistic sends

interface PendingStore {
  byThread: Record<string, PendingMessage[]>;
  /** Messages the viewer reported: hidden for them straight away. */
  hidden: Set<string>;
  add: (p: PendingMessage) => void;
  setStatus: (threadKey: string, clientId: string, status: PendingMessage['status']) => void;
  remove: (threadKey: string, clientId: string) => void;
  hide: (id: string) => void;
}

export const usePendingStore = create<PendingStore>((set, get) => ({
  byThread: {},
  hidden: new Set(),
  add: (p) =>
    set({
      byThread: { ...get().byThread, [p.threadKey]: [...(get().byThread[p.threadKey] ?? []), p] },
    }),
  setStatus: (threadKey, clientId, status) =>
    set({
      byThread: {
        ...get().byThread,
        [threadKey]: (get().byThread[threadKey] ?? []).map((p) =>
          p.clientId === clientId ? { ...p, status } : p,
        ),
      },
    }),
  remove: (threadKey, clientId) =>
    set({
      byThread: {
        ...get().byThread,
        [threadKey]: (get().byThread[threadKey] ?? []).filter((p) => p.clientId !== clientId),
      },
    }),
  hide: (id) => set({ hidden: new Set([...get().hidden, id]) }),
}));

export interface SendArgs {
  ref: ThreadRef;
  threadKey: string;
  crewId: string;
  meId: string;
  body: string | null;
  photoId?: string | null;
  replyToId?: string | null;
  /** 'photo' for a photo attached from the Roll; 'text' (default) also covers reply-to-photo. */
  kind?: 'text' | 'photo';
}

async function insertPending(
  qc: QueryClient,
  p: PendingMessage,
  crewId: string,
  ref: ThreadRef,
  meId: string,
) {
  const store = usePendingStore.getState();
  store.setStatus(p.threadKey, p.clientId, 'sending');
  const { data, error } = await supabase
    .from('messages')
    .insert({
      crew_id: crewId,
      roll_id: ref.kind === 'roll' ? ref.id : null,
      author_id: meId,
      client_id: p.clientId,
      body: p.body,
      photo_id: p.photoId,
      reply_to_id: p.replyToId,
      kind: p.kind,
    })
    .select(MESSAGE_SELECT)
    .single();

  let row = data as unknown as ChatMessage | null;
  if (error) {
    // Idempotent retry: the first attempt did reach the server.
    if (error.code === '23505') {
      const again = await supabase
        .from('messages')
        .select(MESSAGE_SELECT)
        .eq('client_id', p.clientId)
        .maybeSingle();
      row = (again.data as unknown as ChatMessage | null) ?? null;
    }
    if (!row) {
      store.setStatus(p.threadKey, p.clientId, 'failed');
      throw toAppError(error);
    }
  }
  if (row) {
    qc.setQueryData<Pages>(messagesKey(p.threadKey), (old) =>
      old ? { ...old, pages: prependMessage(old.pages, row as ChatMessage) } : old,
    );
  }
  store.remove(p.threadKey, p.clientId);
  void qc.invalidateQueries({ queryKey: inboxThreadsKey });
}

/** Sends with an optimistic bubble; a failure leaves a red-clock bubble with Retry. */
export async function sendChatMessage(qc: QueryClient, a: SendArgs): Promise<void> {
  const pending: PendingMessage = {
    clientId: Crypto.randomUUID().toLowerCase(),
    threadKey: a.threadKey,
    body: a.body,
    photoId: a.photoId ?? null,
    replyToId: a.replyToId ?? null,
    kind: a.kind ?? (a.photoId && !a.body ? 'photo' : 'text'),
    createdAt: new Date().toISOString(),
    status: 'sending',
  };
  usePendingStore.getState().add(pending);
  await insertPending(qc, pending, a.crewId, a.ref, a.meId).catch(() => undefined);
}

export async function retrySend(
  qc: QueryClient,
  threadKey: string,
  clientId: string,
  ctx: { ref: ThreadRef; crewId: string; meId: string },
): Promise<void> {
  const p = (usePendingStore.getState().byThread[threadKey] ?? []).find(
    (x) => x.clientId === clientId,
  );
  if (!p) return;
  await insertPending(qc, p, ctx.crewId, ctx.ref, ctx.meId).catch(() => undefined);
}

export function discardPending(threadKey: string, clientId: string): void {
  usePendingStore.getState().remove(threadKey, clientId);
}

// ---------------------------------------------------------------- reactions / read / report

/** One reaction per person: optimistic, then upsert / delete `message_reactions`. */
export async function reactToMessage(
  qc: QueryClient,
  threadKey: string,
  messageId: string,
  meId: string,
  kind: ReactionKind,
): Promise<void> {
  let removing = false;
  qc.setQueryData<Pages>(messagesKey(threadKey), (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((page) =>
        page.map((m) => {
          if (m.id !== messageId) return m;
          removing = m.reactions.some((r) => r.user_id === meId && r.kind === kind);
          return { ...m, reactions: toggleReaction(m.reactions, meId, kind) };
        }),
      ),
    };
  });
  const res = removing
    ? await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', meId)
    : await supabase
        .from('message_reactions')
        .upsert(
          { message_id: messageId, user_id: meId, kind },
          { onConflict: 'message_id,user_id' },
        );
  if (res.error) {
    void qc.invalidateQueries({ queryKey: messagesKey(threadKey) });
    throw toAppError(res.error);
  }
}

export async function markThreadRead(qc: QueryClient, threadKey: string): Promise<void> {
  qc.setQueryData<{ thread_key: string; unread_count: number }[]>(inboxThreadsKey, (old) =>
    old?.map((t) => (t.thread_key === threadKey ? { ...t, unread_count: 0 } : t)),
  );
  try {
    await rpc<void>('mark_thread_read', { p_thread_key: threadKey });
  } catch {
    // reading state is best effort
  }
  void qc.invalidateQueries({ queryKey: inboxThreadsKey });
  void qc.invalidateQueries({ queryKey: ['home-feed'] });
}

export async function reportMessage(messageId: string, reason: string): Promise<void> {
  await rpc('report', { p_target: 'message', p_target_id: messageId, p_reason: reason });
  usePendingStore.getState().hide(messageId);
}

// ---------------------------------------------------------------- realtime

/** Appends messages inserted by others in this thread (filtered by `thread_key`). */
export function useChatRealtime(
  threadKey: string | null,
  qc: QueryClient,
  onNew?: () => void,
): void {
  const cb = useRef(onNew);
  cb.current = onNew;
  useEffect(() => {
    if (!threadKey) return undefined;
    const channel = supabase
      .channel(`chat:${threadKey}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_key=eq.${threadKey}`,
        },
        (payload) => {
          const id = (payload.new as { id?: string } | null)?.id;
          if (!id) return;
          void supabase
            .from('messages')
            .select(MESSAGE_SELECT)
            .eq('id', id)
            .maybeSingle()
            .then(({ data }) => {
              if (!data) return;
              qc.setQueryData<Pages>(messagesKey(threadKey), (old) =>
                old
                  ? { ...old, pages: prependMessage(old.pages, data as unknown as ChatMessage) }
                  : old,
              );
              cb.current?.();
            });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [threadKey, qc]);
}

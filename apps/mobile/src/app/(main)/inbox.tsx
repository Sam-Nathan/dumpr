import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/data/session';
import {
  dropActivity,
  decideJoinRequest,
  decideRemovalRequest,
  flattenActivity,
  markActivityRead,
  markAllThreadsRead,
  respondDirectInvite,
  useActivity,
  useInboxThreads,
  useUnreadActivityCount,
} from '@/data/useInbox';
import type { ActivityEvent, InboxThread } from '@/data/types-cf';
import { ActivityRow, type ActivityRowState } from '@/features/inbox/ActivityRow';
import {
  sectionActivity,
  unreadActivityCount,
  type ActivityAction,
  type ActivityView,
} from '@/features/inbox/activityCopy';
import { messagePreview } from '@/features/chat/messages';
import { joinedHref } from '@/features/invites';
import { friendlyMessage, toAppError } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { useNavRetap } from '@/state/nav';
import {
  Button,
  EdgeState,
  edge,
  Icon,
  PressableScale,
  Segmented,
  Skeleton,
  TINT_BG,
  Text,
  useColors,
  useNavClearance,
} from '@/ui';

type Tab = 'chats' | 'activity';
type Row =
  | { type: 'section'; key: string; title: string }
  | { type: 'event'; key: string; view: ActivityView; event: ActivityEvent }
  | { type: 'thread'; key: string; thread: InboxThread };

/**
 * C6 Inbox & activity. Chats: one row per Crew / Roll thread with tint and unread count.
 * Activity: invites (Join / Decline), join requests, batched uploads, reveals, removals...
 */
export default function Inbox() {
  const insets = useSafeAreaInsets();
  const clearance = useNavClearance();
  const qc = useQueryClient();
  const { isGuest } = useSession();
  const list = useRef<{ scrollToOffset: (o: { offset: number; animated: boolean }) => void }>(null);
  useNavRetap('inbox', () => list.current?.scrollToOffset({ offset: 0, animated: true }));

  const [tab, setTab] = useState<Tab>('chats');
  const [rowState, setRowState] = useState<Record<number, ActivityRowState>>({});
  const threads = useInboxThreads();
  const activity = useActivity();
  const unread = useUnreadActivityCount();
  const events = useMemo(() => flattenActivity(activity.data), [activity.data]);
  const unreadThreads = (threads.data ?? []).filter((t) => t.unread_count > 0).length;
  const unreadActs = unread.data ?? unreadActivityCount(events);

  const patch = (id: number, p: ActivityRowState | null) =>
    setRowState((s) => {
      const next = { ...s };
      if (p) next[id] = { ...next[id], ...p };
      else delete next[id];
      return next;
    });

  const rows = useMemo<Row[]>(() => {
    if (tab === 'chats') {
      return (threads.data ?? []).map((t) => ({
        type: 'thread' as const,
        key: t.thread_key,
        thread: t,
      }));
    }
    const byId = new Map(events.map((e) => [e.id, e]));
    return sectionActivity(events).flatMap((s) => [
      { type: 'section' as const, key: `s:${s.title}`, title: s.title },
      ...s.items.map((v) => ({
        type: 'event' as const,
        key: `e:${v.id}`,
        view: v,
        event: byId.get(v.id) as ActivityEvent,
      })),
    ]);
  }, [tab, threads.data, events]);

  const limeId = useMemo(() => {
    for (const r of rows)
      if (r.type === 'event' && r.view.actions.some((a) => a.primary)) return r.view.id;
    return null;
  }, [rows]);

  const openEvent = (e: ActivityEvent, v: ActivityView) => {
    if (e.read_at === null) void markActivityRead(qc, [e.id]).catch(() => undefined);
    if (v.href) router.push(v.href);
  };

  const act = async (e: ActivityEvent, v: ActivityView, a: ActivityAction) => {
    const p = e.payload;
    const code = typeof p.code === 'string' ? p.code : null;
    if (a.id === 'preview' && code) return router.push(`/invite/${code}`);
    if (a.id === 'open' || a.id === 'download') return v.href ? router.push(v.href) : undefined;
    if (a.id === 'ask_link') return patch(e.id, { asked: true });
    patch(e.id, { busy: a.id, error: undefined });
    try {
      if (a.id === 'join' || a.id === 'decline') {
        const id = String(p.direct_invite_id ?? '');
        const res = await respondDirectInvite(id, a.id === 'join');
        void qc.invalidateQueries({ queryKey: ['home-feed'] });
        void markActivityRead(qc, [e.id]).catch(() => undefined);
        dropActivity(qc, e.id);
        if (a.id === 'join') router.push(joinedHref(res));
      } else if (a.id === 'approve' || a.id === 'deny') {
        await decideJoinRequest(String(p.request_id ?? ''), a.id === 'approve');
        void markActivityRead(qc, [e.id]).catch(() => undefined);
        dropActivity(qc, e.id);
      } else if (a.id === 'remove_photo' || a.id === 'keep_photo') {
        await decideRemovalRequest(String(p.request_id ?? ''), a.id === 'remove_photo');
        void markActivityRead(qc, [e.id]).catch(() => undefined);
        dropActivity(qc, e.id);
        void qc.invalidateQueries({ queryKey: ['roll-photos'] });
      }
      patch(e.id, null);
    } catch (err) {
      const c = toAppError(err).code;
      if (c === 'invite_expired' || c === 'invite_revoked' || c === 'invite_not_found') {
        patch(e.id, { busy: undefined, expired: true });
      } else {
        patch(e.id, { busy: undefined, error: friendlyMessage(err) });
      }
    }
  };

  const markAll = async () => {
    await Promise.all([
      markActivityRead(qc).catch(() => undefined),
      markAllThreadsRead(qc, threads.data ?? []).catch(() => undefined),
    ]);
  };

  const active = tab === 'chats' ? threads : activity;
  const empty =
    !active.isLoading && !active.isError && rows.filter((r) => r.type !== 'section').length === 0;
  const refreshing = (threads.isRefetching || activity.isRefetching) && !active.isLoading;

  const emptyState = (
    <View className="mt-8">
      {isGuest && tab === 'chats' ? (
        <EdgeState
          icon="chat"
          tone="lilac"
          title="Chats need an account"
          body="Guests can view and add photos. Sign up with your number to chat with a Crew."
        />
      ) : (
        <EdgeState
          icon="chat"
          tone="sky"
          title="Quiet in here"
          body={
            tab === 'chats'
              ? 'Chats from your Crews and Rolls show up here. Start a Crew to get the conversation going.'
              : 'Invites, uploads, reactions and reveals from your Crews show up here.'
          }
          primary={
            isGuest
              ? undefined
              : { label: 'Start a Crew', onPress: () => router.push('/sheets/create') }
          }
          primaryVariant="strong"
        />
      )}
    </View>
  );

  const err = active.error ? edge.fromError(active.error) : null;

  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      <FlashList
        ref={list as never}
        data={rows}
        keyExtractor={(r) => r.key}
        getItemType={(r) => r.type}
        extraData={rowState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void threads.refetch();
              void activity.refetch();
              void unread.refetch();
            }}
          />
        }
        onEndReached={() => {
          if (tab === 'activity' && activity.hasNextPage && !activity.isFetchingNextPage)
            void activity.fetchNextPage();
        }}
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: clearance,
          paddingHorizontal: 16,
        }}
        ListHeaderComponent={
          <View>
            <View className="mt-2 flex-row items-end justify-between">
              <Text variant="display" heading>
                Inbox
              </Text>
              {unreadThreads + unreadActs > 0 ? (
                <Button
                  label="Mark all read"
                  variant="tertiary"
                  size="sm"
                  onPress={() => void markAll()}
                />
              ) : null}
            </View>
            <View className="mb-3 mt-4">
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'chats', label: 'Chats', count: unreadThreads },
                  { value: 'activity', label: 'Activity', count: unreadActs },
                ]}
              />
            </View>
            {active.isLoading ? <InboxSkeleton /> : null}
            {err ? (
              <EdgeState
                icon={err.icon}
                tone={err.tone}
                title={err.title}
                body={err.body}
                primary={{ label: 'Try again', onPress: () => void active.refetch() }}
                primaryVariant="strong"
              />
            ) : null}
            {empty ? emptyState : null}
          </View>
        }
        renderItem={({ item }) => {
          if (item.type === 'section') {
            return (
              <Text variant="stamp" tone="tertiary" heading className="mb-1 mt-4 text-[11px]">
                {item.title}
              </Text>
            );
          }
          if (item.type === 'thread') return <ChatRow thread={item.thread} />;
          return (
            <ActivityRow
              view={item.view}
              actorAvatarKey={item.event.actor?.avatar_key}
              actorRing={item.event.actor?.ring_color}
              limeActionId={limeId}
              state={rowState[item.view.id]}
              onPress={() => openEvent(item.event, item.view)}
              onAction={(a) => void act(item.event, item.view, a)}
            />
          );
        }}
      />
    </View>
  );
}

function InboxSkeleton() {
  return (
    <View className="gap-4 pt-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} className="flex-row items-center gap-3">
          <Skeleton width={48} height={48} radius={14} />
          <View className="flex-1 gap-2">
            <Skeleton width="55%" height={15} />
            <Skeleton width="80%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

function ChatRow({ thread: t }: { thread: InboxThread }) {
  const colors = useColors();
  const preview = t.last_message_at
    ? `${t.last_author_name ? `${t.last_author_name}: ` : ''}${messagePreview({
        body: t.last_message_body,
        kind: t.last_message_kind ?? 'text',
        photo_id: t.last_message_photo_id,
      })}`
    : t.kind === 'crew'
      ? 'No messages yet. Say hi.'
      : 'No messages yet.';
  const unread = t.unread_count > 0;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${t.title}${t.kind === 'roll' ? `, Roll in ${t.crew_name}` : ', Crew'}. ${preview}${unread ? `. ${t.unread_count} unread` : ''}`}
      onPress={() => router.push(`/chat/${t.thread_key}`)}
      haptics={false}
      scaleTo={0.99}
      className="min-h-[68px] flex-row items-center gap-3 border-b border-line py-2.5 dark:border-line-dark"
    >
      <View className={`h-12 w-12 items-center justify-center rounded-[14px] ${TINT_BG[t.tint]}`}>
        <Icon name={t.kind === 'crew' ? 'users' : 'image'} size={22} color={colors.ink} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text variant="heading" tone="default" numberOfLines={1} className="flex-shrink">
            {t.title}
          </Text>
          {t.kind === 'roll' ? (
            <Text variant="caption" numberOfLines={1} className="flex-shrink-0">
              · {t.crew_name}
            </Text>
          ) : null}
          {t.muted ? <Icon name="bellOff" size={14} color={colors.ink3} /> : null}
        </View>
        <Text
          variant="body"
          numberOfLines={1}
          tone={unread ? 'default' : 'secondary'}
          className={unread ? 'font-body-semibold' : ''}
        >
          {preview}
        </Text>
      </View>
      <View className="items-end gap-1.5">
        <Text variant="caption">{formatRelative(t.last_message_at ?? t.last_activity_at)}</Text>
        {unread ? (
          <View className="min-w-[22px] items-center rounded-pill bg-ink px-1.5 py-0.5 dark:bg-flash">
            <Text
              variant="stamp"
              tone="inverse"
              className="text-[11px] leading-[14px] dark:text-ink"
            >
              {t.unread_count > 99 ? '99+' : t.unread_count}
            </Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

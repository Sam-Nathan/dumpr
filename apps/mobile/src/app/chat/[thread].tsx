import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfile } from '@/data/profile';
import { useSession } from '@/data/session';
import { REACTIONS, type ReactionKind } from '@/data/types';
import {
  discardPending,
  markThreadRead,
  reactToMessage,
  reportMessage,
  retrySend,
  sendChatMessage,
  useChatRealtime,
  useMessages,
  usePendingStore,
  useThreadInfo,
} from '@/data/useChat';
import { MessageBubble } from '@/features/chat/MessageBubble';
import { PhotoPickerModal } from '@/features/chat/PhotoPickerModal';
import {
  cleanBody,
  mergeMessages,
  messagePreview,
  parseThreadKey,
  starterPrompts,
  type DisplayMessage,
} from '@/features/chat/messages';
import { signOut } from '@/features/auth';
import { friendlyMessage, toAppError } from '@/lib/errors';
import {
  BottomModal,
  Button,
  Chip,
  confirmDialog,
  EdgeState,
  edge,
  Glyph,
  goBack,
  Icon,
  IconButton,
  PhotoTile,
  PressableScale,
  ReactionChip,
  Skeleton,
  TINT_BG,
  Text,
  toast,
  useColors,
} from '@/ui';

/**
 * C5 Crew / Roll chat. Thread key `c:<crewId>` or `r:<rollId>`; newest at the bottom, older messages
 * paginate up; realtime appends; optimistic sends with a red clock + Retry when they fail.
 */
export default function ChatScreen() {
  const params = useLocalSearchParams<{ thread?: string; photoId?: string }>();
  const ref = parseThreadKey(params.thread);
  if (!ref) {
    return (
      <View className="flex-1 bg-paper dark:bg-paper-dark">
        <EdgeState
          layout="screen"
          icon="search"
          tone="sky"
          title="We can't find that chat"
          body="The link may be incomplete. Your chats are in the Inbox."
          primary={{ label: 'Open Inbox', onPress: () => router.replace('/inbox') }}
          secondary={{ label: 'Go home', onPress: () => router.replace('/') }}
        />
      </View>
    );
  }
  const threadKey = `${ref.kind === 'crew' ? 'c' : 'r'}:${ref.id}`;
  return <Chat threadKey={threadKey} ref0={ref} replyPhotoId={params.photoId} />;
}

function Chat({
  threadKey,
  ref0: ref,
  replyPhotoId,
}: {
  threadKey: string;
  ref0: NonNullable<ReturnType<typeof parseThreadKey>>;
  replyPhotoId?: string;
}) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { user, isGuest } = useSession();
  const profile = useProfile();
  const meId = user?.id ?? '';
  const thread = useThreadInfo(ref);
  const messages = useMessages(isGuest ? null : threadKey);
  const pending = usePendingStore((s) => s.byThread[threadKey]);
  const hidden = usePendingStore((s) => s.hidden);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  const [attach, setAttach] = useState<string | null>(null);
  const [replyPhoto, setReplyPhoto] = useState<string | null>(replyPhotoId ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actions, setActions] = useState<DisplayMessage | null>(null);
  const input = useRef<TextInput>(null);

  const info = thread.info;
  const me = useMemo(
    () => ({
      id: meId,
      author: profile.data
        ? {
            display_name: profile.data.display_name,
            avatar_key: profile.data.avatar_key,
            ring_color: profile.data.ring_color,
          }
        : null,
    }),
    [meId, profile.data],
  );

  const server = useMemo(() => messages.data?.pages.flat() ?? [], [messages.data]);
  const display = useMemo(
    () => (info ? mergeMessages(server, pending ?? [], me, ref, info.crewId, hidden) : []),
    [server, pending, me, ref, info, hidden],
  );
  const byId = useMemo(() => new Map(display.map((m) => [m.id, m])), [display]);

  const markRead = useCallback(() => {
    if (!isGuest) void markThreadRead(qc, threadKey);
  }, [qc, threadKey, isGuest]);
  useFocusEffect(
    useCallback(() => {
      markRead();
      return undefined;
    }, [markRead]),
  );
  useChatRealtime(isGuest ? null : threadKey, qc, markRead);

  const canSend = !!info && !info.deleted && !isGuest;
  const hasContent = !!cleanBody(text) || !!attach;

  const send = () => {
    if (!info || !hasContent) return;
    const body = cleanBody(text);
    const photoId = attach ?? replyPhoto;
    void sendChatMessage(qc, {
      ref,
      threadKey,
      crewId: info.crewId,
      meId,
      body,
      photoId,
      replyToId: replyTo && !replyTo.id.startsWith('pending:') ? replyTo.id : null,
      kind: attach ? 'photo' : 'text',
    });
    setText('');
    setReplyTo(null);
    setAttach(null);
    setReplyPhoto(null);
  };

  const react = (m: DisplayMessage, kind: ReactionKind) => {
    if (m.id.startsWith('pending:')) return;
    reactToMessage(qc, threadKey, m.id, meId, kind).catch((e) =>
      toast.show({ message: friendlyMessage(e) }),
    );
  };

  const report = async (m: DisplayMessage) => {
    const ok = await confirmDialog({
      title: 'Report this message?',
      body: "It's hidden for you straight away and the hosts of this Crew will take a look.",
      confirmLabel: 'Report',
    });
    if (!ok) return;
    try {
      await reportMessage(m.id, 'reported from chat');
      toast.show({ message: 'Reported. We hid it for you.' });
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    }
  };

  // ---------------------------------------------------------------- states
  const err = thread.error ?? messages.error;
  const code = err ? toAppError(err).code : null;

  const tintCls = info ? TINT_BG[info.tint] : 'bg-line dark:bg-line-dark';
  const header = (
    <View className={tintCls} style={{ paddingTop: insets.top }}>
      <View className="min-h-[64px] flex-row items-center gap-3 px-4 py-2">
        <IconButton icon="back" label="Back" variant="soft" onPress={goBack} />
        <View className="flex-1">
          {info ? (
            <>
              <Text
                variant="title"
                heading
                numberOfLines={1}
                className="text-[22px] leading-[25px]"
              >
                {info.title}
              </Text>
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {info.subtitle}
              </Text>
            </>
          ) : (
            <View className="gap-1.5">
              <Skeleton width={150} height={20} />
              <Skeleton width={110} height={12} />
            </View>
          )}
        </View>
        {info && ref.kind === 'roll' ? (
          <IconButton
            icon="image"
            label="Open the Roll"
            variant="soft"
            onPress={() => router.push(`/roll/${ref.id}`)}
          />
        ) : null}
      </View>
    </View>
  );

  let body: React.ReactNode;
  if (isGuest) {
    body = (
      <EdgeState
        layout="screen"
        icon="chat"
        tone="lilac"
        title="Chat needs an account"
        body="Guests can view and add photos. Sign up with your number to chat with the Crew. Photos you added as a guest stay in the Roll."
        primary={{
          label: 'Sign up to chat',
          onPress: async () => {
            const ok = await confirmDialog({
              title: 'Leave this guest account?',
              body: "You'll sign up with your number next. Photos you added as a guest stay in the Roll.",
              confirmLabel: 'Continue',
              destructive: false,
            });
            if (ok) await signOut();
          },
        }}
        secondary={{ label: 'Back', onPress: goBack }}
      />
    );
  } else if (code === 'not_a_member' || code === 'forbidden') {
    const c = edge.removedFromCrew('this Crew');
    body = (
      <EdgeState
        layout="screen"
        icon={c.icon}
        tone={c.tone}
        title={c.title}
        body="You can't see this chat any more. Anything you added stays in the Rolls."
        primary={{ label: 'Go home', onPress: () => router.replace('/') }}
      />
    );
  } else if (err && !info) {
    const c = edge.fromError(err);
    body = (
      <EdgeState
        layout="screen"
        icon={c.icon}
        tone={c.tone}
        title={c.title}
        body={c.body}
        primary={{ label: 'Try again', onPress: () => void thread.refetch() }}
        secondary={{ label: 'Back', onPress: goBack }}
      />
    );
  } else if (!info || messages.isLoading) {
    body = (
      <View className="flex-1 justify-end gap-3 p-4">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} className={i % 2 ? 'items-end' : 'items-start'}>
            <Skeleton width={i % 2 ? 180 : 230} height={44} radius={20} />
          </View>
        ))}
      </View>
    );
  } else if (messages.isError && display.length === 0) {
    const c = edge.fromError(messages.error);
    body = (
      <EdgeState
        layout="screen"
        icon={c.icon}
        tone={c.tone}
        title={c.title}
        body={c.body}
        primary={{ label: 'Try again', onPress: () => void messages.refetch() }}
        secondary={{ label: 'Back', onPress: goBack }}
      />
    );
  } else if (display.length === 0) {
    const prompts = starterPrompts(ref.kind, info.title);
    body = (
      <View className="flex-1 items-center justify-center px-6">
        <View className="mb-4 h-16 w-16 items-center justify-center rounded-card bg-tint-lilac dark:bg-tint-lilac-dark">
          <Icon name="chat" size={30} color={colors.ink} />
        </View>
        <Text variant="title" heading className="text-center">
          Say hi to the {ref.kind === 'crew' ? 'Crew' : 'Roll'}
        </Text>
        <Text variant="body" className="mt-2 text-center">
          Nobody has written yet. Start with one of these, or type your own.
        </Text>
        <View className="mt-5 items-center gap-2">
          {prompts.map((p) => (
            <Chip
              key={p}
              label={p}
              onPress={() => {
                setText(p);
                input.current?.focus();
              }}
            />
          ))}
        </View>
      </View>
    );
  } else {
    body = (
      <FlatList
        inverted
        data={display}
        keyExtractor={(m) => m.client_id || m.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: 12 }}
        onEndReachedThreshold={0.4}
        onEndReached={() =>
          messages.hasNextPage && !messages.isFetchingNextPage && void messages.fetchNextPage()
        }
        ListFooterComponent={
          messages.isFetchingNextPage ? (
            <View className="py-3">
              <ActivityIndicator color={colors.ink3} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            meId={meId}
            byId={byId}
            onLongPress={setActions}
            onReact={react}
            onRetry={(m) =>
              void retrySend(qc, threadKey, m.client_id, { ref, crewId: info.crewId, meId })
            }
            onDiscard={(m) => discardPending(threadKey, m.client_id)}
          />
        )}
      />
    );
  }

  const showComposer = !isGuest && !!info && !err;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-paper dark:bg-paper-dark"
    >
      {header}
      <View className="flex-1">{body}</View>

      {showComposer ? (
        <View
          className="border-t border-line bg-paper px-3 pt-2 dark:border-line-dark dark:bg-paper-dark"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          {replyTo ? (
            <View className="mb-2 flex-row items-center rounded-input bg-surface px-3 py-2 dark:bg-surface-dark">
              <Glyph name="reply" size={16} color={colors.ink3} />
              <Text variant="caption" className="mx-2 flex-1" numberOfLines={1}>
                Replying to {replyTo.author?.display_name ?? 'a message'}: {messagePreview(replyTo)}
              </Text>
              <IconButton
                icon="close"
                label="Cancel reply"
                variant="ghost"
                size={32}
                onPress={() => setReplyTo(null)}
              />
            </View>
          ) : null}
          {attach || replyPhoto ? (
            <View className="mb-2 flex-row items-center rounded-input bg-surface p-2 dark:bg-surface-dark">
              <View style={{ width: 44 }}>
                <PhotoTile photoId={(attach ?? replyPhoto) as string} radius={8} />
              </View>
              <Text variant="caption" className="mx-3 flex-1">
                {attach ? 'Photo from the Roll' : 'Replying to a photo'}
              </Text>
              <IconButton
                icon="close"
                label="Remove photo"
                variant="ghost"
                size={32}
                onPress={() => {
                  setAttach(null);
                  setReplyPhoto(null);
                }}
              />
            </View>
          ) : null}
          {info?.deleted ? (
            <Text variant="caption" className="pb-2 text-center">
              This Crew was deleted, so the chat is read-only.
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <IconButton
              icon="plus"
              label="Attach a photo from a Roll"
              variant="soft"
              disabled={!canSend}
              onPress={() => setPickerOpen(true)}
            />
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              editable={canSend}
              multiline
              maxLength={2000}
              placeholder={`Message ${info?.title ?? ''}`}
              placeholderTextColor={colors.ink3}
              accessibilityLabel={`Message ${info?.title ?? ''}`}
              maxFontSizeMultiplier={2}
              className="max-h-[120px] min-h-[44px] flex-1 rounded-[22px] bg-surface px-4 py-2.5 font-body-medium text-[16px] text-ink dark:bg-surface-dark dark:text-ink-dark"
            />
            {hasContent ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Send message"
                onPress={send}
                className="h-11 w-11 items-center justify-center rounded-pill bg-flash"
              >
                <Glyph name="send" size={20} color="#16141B" />
              </PressableScale>
            ) : null}
          </View>
        </View>
      ) : null}

      <PhotoPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        rolls={(info?.rolls ?? []).map((r) => ({ id: r.id, name: r.name, sealed: r.sealed }))}
        initialRollId={ref.kind === 'roll' ? ref.id : undefined}
        onPick={(id) => {
          setAttach(id);
          setReplyPhoto(null);
        }}
      />

      <BottomModal visible={!!actions} onClose={() => setActions(null)} title="React or reply">
        {actions ? (
          <View className="gap-4 pb-2">
            <View className="flex-row flex-wrap gap-2">
              {REACTIONS.map((k) => (
                <ReactionChip
                  key={k}
                  kind={k}
                  selected={actions.reactions.some((r) => r.user_id === meId && r.kind === k)}
                  onPress={() => {
                    react(actions, k);
                    setActions(null);
                  }}
                />
              ))}
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Reply"
                variant="secondary"
                icon="chat"
                onPress={() => {
                  setReplyTo(actions);
                  setActions(null);
                  input.current?.focus();
                }}
              />
              {actions.author_id !== meId ? (
                <Button
                  label="Report"
                  variant="destructive"
                  onPress={() => {
                    const m = actions;
                    setActions(null);
                    void report(m);
                  }}
                />
              ) : null}
            </View>
          </View>
        ) : null}
      </BottomModal>
    </KeyboardAvoidingView>
  );
}

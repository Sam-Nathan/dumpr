import { router } from 'expo-router';
import { View } from 'react-native';
import type { ReactionKind } from '@/data/types';
import {
  dayHeading,
  messagePreview,
  summarizeReactions,
  type DisplayMessage,
} from '@/features/chat/messages';
import { formatStamp } from '@/lib/format';
import {
  Avatar,
  Glyph,
  Icon,
  PhotoTile,
  PressableScale,
  ReactionChip,
  Text,
  useColors,
} from '@/ui';

export interface BubbleProps {
  message: DisplayMessage;
  meId: string;
  /** Lookup for reply quotes (loaded messages only). */
  byId: ReadonlyMap<string, DisplayMessage>;
  onLongPress: (m: DisplayMessage) => void;
  onReact: (m: DisplayMessage, kind: ReactionKind) => void;
  onRetry: (m: DisplayMessage) => void;
  onDiscard: (m: DisplayMessage) => void;
}

/** One chat row: day separator, author name + avatar on the first of a run, bubble, reactions. */
export function MessageBubble({
  message: m,
  meId,
  byId,
  onLongPress,
  onReact,
  onRetry,
  onDiscard,
}: BubbleProps) {
  const colors = useColors();
  const mine = m.author_id === meId;
  const reply = m.reply_to_id ? byId.get(m.reply_to_id) : undefined;
  const reactions = summarizeReactions(m.reactions, meId);
  const name = m.author?.display_name ?? 'Someone';

  if (m.kind === 'system') {
    return (
      <View className="my-2 items-center">
        {m.showDay ? <DayLabel iso={m.created_at} /> : null}
        <View className="rounded-pill bg-surface px-4 py-2 dark:bg-surface-dark">
          <Text variant="caption" tone="default" className="font-body-semibold">
            {m.body ?? ''}
          </Text>
        </View>
      </View>
    );
  }

  const photoBlock = m.photo_id ? (
    <PressableScale
      accessibilityRole="imagebutton"
      accessibilityLabel={`Photo${m.photo?.roll ? ` in ${m.photo.roll.name}` : ''}. Open`}
      onPress={() => router.push(`/photo/${m.photo_id}`)}
      haptics={false}
      scaleTo={0.98}
    >
      <View style={{ width: m.kind === 'photo' ? 220 : 120 }}>
        <PhotoTile photoId={m.photo_id} radius={14} label="Photo in this chat" />
      </View>
    </PressableScale>
  ) : null;

  return (
    <View className="px-3">
      {m.showDay ? <DayLabel iso={m.created_at} /> : null}
      <View className={`mt-1 flex-row items-end ${mine ? 'justify-end' : 'justify-start'}`}>
        {!mine ? (
          <View className="mr-2 w-8 self-start pt-5">
            {m.showAuthor ? (
              <Avatar name={name} avatarKey={m.author?.avatar_key} ring="none" size={32} />
            ) : null}
          </View>
        ) : null}
        <View className="max-w-[78%]">
          {!mine && m.showAuthor ? (
            <Text variant="caption" className="mb-1 ml-1 font-body-semibold">
              {name}
            </Text>
          ) : null}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${mine ? 'You' : name}: ${messagePreview(m)}. Long press for reactions and reply`}
            onLongPress={() => onLongPress(m)}
            delayLongPress={280}
            haptics={false}
            scaleTo={0.99}
            wrapperStyle={{ minHeight: 0, alignItems: mine ? 'flex-end' : 'flex-start' }}
            className={`rounded-[20px] ${
              mine ? 'bg-ink dark:bg-line-dark' : 'bg-surface dark:bg-surface-dark'
            } ${m.pending === 'sending' ? 'opacity-60' : ''} ${m.kind === 'photo' ? 'p-1.5' : 'px-4 py-2.5'}`}
          >
            {m.reply_to_id ? (
              <View
                className={`mb-2 rounded-[12px] border-l-[3px] border-tint-lilac px-2.5 py-1.5 ${
                  mine ? 'bg-white/10' : 'bg-ink/[0.05] dark:bg-ink-dark/10'
                }`}
                style={{ borderLeftColor: '#B79BFF' }}
              >
                <Text variant="caption" tone={mine ? 'inverse' : 'default'} numberOfLines={2}>
                  {reply
                    ? `${reply.author?.display_name ?? 'Someone'}: ${messagePreview(reply)}`
                    : 'Replying to a message'}
                </Text>
              </View>
            ) : null}
            {photoBlock}
            {m.kind === 'photo' && m.photo ? (
              <View className="mt-1.5 flex-row items-center justify-between px-1.5 pb-0.5">
                <Text
                  variant="caption"
                  tone={mine ? 'inverse' : 'tertiary'}
                  numberOfLines={1}
                  className="flex-1 pr-2"
                >
                  {m.photo.roll ? `in ${m.photo.roll.name}` : 'Photo'}
                </Text>
                {m.photo.sort_at ? (
                  <Text variant="stamp" className="text-[11px]">
                    {formatStamp(m.photo.sort_at, { time: false })}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {m.body ? (
              <Text
                variant="body"
                tone={mine ? 'inverse' : 'default'}
                className={m.photo_id ? 'mt-2' : ''}
              >
                {m.body}
              </Text>
            ) : null}
          </PressableScale>

          {reactions.length > 0 ? (
            <View
              className={`-mt-2 flex-row flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start pl-2'}`}
            >
              {reactions.map((r) => (
                <ReactionChip
                  key={r.kind}
                  kind={r.kind}
                  count={r.n}
                  selected={r.mine}
                  onPress={() => onReact(m, r.kind)}
                />
              ))}
            </View>
          ) : null}

          {m.pending === 'failed' ? (
            <View
              className="mt-1 flex-row items-center justify-end gap-2"
              accessibilityLiveRegion="polite"
            >
              <Icon name="clock" size={14} color={colors.danger} />
              <Text variant="caption" tone="danger">
                Not sent
              </Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Retry sending"
                onPress={() => onRetry(m)}
              >
                <Text variant="caption" tone="default" className="font-body-bold underline">
                  Retry
                </Text>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Discard message"
                onPress={() => onDiscard(m)}
              >
                <Glyph name="minus" size={14} color={colors.ink3} />
              </PressableScale>
            </View>
          ) : m.pending === 'sending' ? (
            <View className="mt-1 flex-row items-center justify-end gap-1">
              <Icon name="clock" size={12} color={colors.ink3} />
              <Text variant="caption">Sending…</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function DayLabel({ iso }: { iso: string }) {
  return (
    <View className="my-3 items-center">
      <Text variant="stamp" tone="tertiary" className="text-[11px]">
        {dayHeading(iso).toUpperCase()}
      </Text>
    </View>
  );
}

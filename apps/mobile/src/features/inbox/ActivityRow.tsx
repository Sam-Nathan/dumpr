import { View } from 'react-native';
import { Avatar, Button, Glyph, PhotoTile, PressableScale, Text } from '@/ui';
import type { ActivityView, ActivityAction } from './activityCopy';

export interface ActivityRowState {
  busy?: ActivityAction['id'];
  error?: string;
  /** The invite link is no longer valid. */
  expired?: boolean;
  /** Hint after "Ask for a new link". */
  asked?: boolean;
}

export function ActivityRow({
  view,
  actorAvatarKey,
  actorRing,
  limeActionId,
  state,
  onPress,
  onAction,
}: {
  view: ActivityView;
  actorAvatarKey?: string | null;
  actorRing?: 'lime' | 'lilac' | 'sky' | 'peach';
  /** The one row whose main action is lime. */
  limeActionId: number | null;
  state?: ActivityRowState;
  onPress: () => void;
  onAction: (a: ActivityAction) => void;
}) {
  const reveal = view.look === 'reveal';
  const expired = state?.expired;
  const segments = expired
    ? [{ text: `${view.actorName}'s link has expired.`, bold: false }]
    : view.segments;
  const actions: ActivityAction[] = expired
    ? [{ id: 'ask_link', label: 'Ask for a new link' }]
    : view.actions;

  const text = (
    <Text variant="body" tone="default">
      {segments.map((s, i) => (
        <Text key={i} variant="body" tone="default" className={s.bold ? 'font-body-bold' : ''}>
          {s.text}
        </Text>
      ))}
      <Text variant="caption"> · {view.time}</Text>
    </Text>
  );

  return (
    <View
      className={`my-1 rounded-card px-3 py-3 ${reveal ? 'bg-flash' : ''} ${
        !reveal ? 'border-b border-line dark:border-line-dark' : ''
      }`}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={
          segments.map((s) => s.text).join('') + `, ${view.time}${view.unread ? ', new' : ''}`
        }
        onPress={onPress}
        haptics={false}
        scaleTo={0.99}
        disabled={!view.href}
      >
        <View className="flex-row items-start gap-3">
          {reveal ? (
            <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-ink">
              <Glyph name="sparkle" size={22} color="#D4FF3F" />
            </View>
          ) : (
            <Avatar
              name={view.actorName}
              avatarKey={actorAvatarKey}
              ring={actorRing ?? 'none'}
              size={44}
            />
          )}
          <View className="flex-1">
            <Text variant="body" tone={reveal ? 'onFlash' : 'default'} numberOfLines={4}>
              {text}
            </Text>
          </View>
          {view.thumbPhotoIds.length > 0 ? (
            <View className="flex-row" style={{ width: 28 + 22 * view.thumbPhotoIds.length }}>
              {view.thumbPhotoIds.map((id, i) => (
                <View key={id} style={{ width: 44, marginLeft: i === 0 ? 0 : -22 }}>
                  <PhotoTile photoId={id} radius={10} label="Photo" />
                </View>
              ))}
            </View>
          ) : null}
          {view.unread && !reveal ? (
            <View
              accessibilityLabel="Unread"
              className="mt-2 h-2.5 w-2.5 rounded-pill bg-shutter"
            />
          ) : null}
        </View>
      </PressableScale>

      {actions.length > 0 ? (
        <View className="mt-2 flex-row flex-wrap items-center gap-2 pl-14">
          {actions.map((a, i) => {
            const isMain = a.primary && !expired;
            const variant = isMain
              ? limeActionId === view.id
                ? 'primary'
                : 'strong'
              : i === 0
                ? 'secondary'
                : 'tertiary';
            return (
              <Button
                key={a.id}
                label={a.label}
                size="sm"
                variant={variant}
                loading={state?.busy === a.id}
                disabled={!!state?.busy}
                onPress={() => onAction(a)}
              />
            );
          })}
        </View>
      ) : null}
      {state?.error ? (
        <Text
          variant="caption"
          tone="danger"
          className="mt-1 pl-14"
          accessibilityLiveRegion="polite"
        >
          {state.error}
        </Text>
      ) : null}
      {state?.asked ? (
        <Text variant="caption" className="mt-1 pl-14">
          Ask {view.actorName} to send you a fresh link. We will show it here when it arrives.
        </Text>
      ) : null}
    </View>
  );
}

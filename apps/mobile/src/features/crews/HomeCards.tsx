import { router } from 'expo-router';
import { View } from 'react-native';
import type { HomeLiveRoll, PendingDirectInvite } from '@/data/types-b';
import { formatStamp } from '@/lib/format';
import { Avatar, Button, DumpStack, Icon, PressableScale, Stamp, Text, TINT_BG, SHUTTER } from '@/ui';
import { useNow } from '../rolls/useNow';

/** Pending in-app invite: "Tanvi invited you to Mood Indigo '26" with Join / Decline. */
export function InviteCard({
  invite,
  busy,
  onJoin,
  onDecline,
}: {
  invite: PendingDirectInvite;
  busy: boolean;
  onJoin: () => void;
  onDecline: () => void;
}) {
  const who = invite.inviter?.display_name ?? 'Someone';
  const target = invite.roll?.name ?? invite.crew.name;
  return (
    <View className="rounded-card border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark">
      <View className="flex-row items-center gap-3">
        <Avatar name={who} avatarKey={invite.inviter?.avatar_key} size={44} />
        <View className="flex-1">
          <Text variant="body" tone="default" className="font-body-semibold">
            {who} invited you to {target}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {invite.roll ? `Roll in ${invite.crew.name}` : 'Crew'}
          </Text>
        </View>
        <Button label="Join" variant="primary" size="sm" loading={busy} onPress={onJoin} />
      </View>
      <View className="mt-1 flex-row">
        <Button
          label="Decline"
          variant="tertiary"
          size="sm"
          disabled={busy}
          onPress={onDecline}
        />
      </View>
    </View>
  );
}

/** "LIVE NOW" banner: ink, with a ticking stamp. */
export function LiveBanner({ roll, lime }: { roll: HomeLiveRoll; lime: boolean }) {
  const now = useNow(1000);
  return (
    <View className="flex-row items-center gap-3 rounded-card bg-ink p-4">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Live now: ${roll.name} in ${roll.crew_name}. Open Roll`}
        onPress={() => router.push(`/roll/${roll.id}`)}
        wrapperStyle={{ flex: 1 }}
      >
        <View className="flex-row items-center gap-2">
          <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: SHUTTER }} />
          <Text variant="stamp" className="text-[11px]">
            LIVE NOW · {roll.crew_name}
          </Text>
        </View>
        <Text variant="heading" tone="inverse" className="mt-1 text-[18px] leading-[22px]" numberOfLines={2}>
          {roll.name}
        </Text>
        <Stamp text={formatStamp(now, { seconds: true })} size={11} />
      </PressableScale>
      <Button
        label="Shoot"
        icon="camera"
        variant={lime ? 'primary' : 'secondary'}
        onDark={!lime}
        size="sm"
        onPress={() => router.push({ pathname: '/camera', params: { rollId: roll.id } })}
      />
    </View>
  );
}

export function OfflineBanner() {
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-2 rounded-pill bg-ink/[0.07] px-4 py-2.5 dark:bg-ink-dark/10"
    >
      <Icon name="alert" size={16} color={SHUTTER} />
      <Text variant="caption" tone="secondary" className="flex-1 font-body-semibold">
        Showing saved photos. Pull down to try again.
      </Text>
    </View>
  );
}

/** Empty state for a new user: never an empty list. */
export function StartCrewCard({
  canCreate,
  onStart,
  onLink,
}: {
  canCreate: boolean;
  onStart: () => void;
  onLink: () => void;
}) {
  return (
    <View className={`overflow-hidden rounded-card p-5 ${TINT_BG.lilac}`}>
      <Text variant="title" heading>
        {canCreate ? 'Start a Crew' : 'Join your first Crew'}
      </Text>
      <Text variant="body" className="mt-1">
        {canCreate
          ? 'One place for your people and every photo from every plan.'
          : 'Open a link a friend sent you to see their photos here.'}
      </Text>
      <View className="my-2 w-full">
        <DumpStack
          aspectRatio={2}
          cardAspect={0.9}
          cards={[{ art: 'beach' }, { art: 'sunset' }, { art: 'party' }]}
        />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {canCreate ? <Button label="Start a Crew" variant="strong" onPress={onStart} /> : null}
        <Button label="Got a link?" icon="link" variant="secondary" onPress={onLink} />
      </View>
    </View>
  );
}


import { router } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfile } from '@/data/profile';
import { useSession } from '@/data/session';
import { useHomeFeed, useRespondDirectInvite } from '@/data/useHome';
import { CrewCard, CrewCardSkeleton } from '@/features/crews/CrewCard';
import { InviteCard, LiveBanner, OfflineBanner, StartCrewCard } from '@/features/crews/HomeCards';
import { joinedHref } from '@/features/invites/api';
import { InviteLinkSheet } from '@/features/invites/InviteLinkSheet';
import { friendlyMessage, isRetryable, toAppError } from '@/lib/errors';
import { useNavRetap, useNavStore } from '@/state/nav';
import {
  Avatar,
  Button,
  EdgeState,
  edge,
  haptic,
  IconButton,
  PressableScale,
  Text,
  toast,
  useNavClearance,
} from '@/ui';

/** B1 Home · Crews: invites, live Rolls, Crew cards in their tint. One lime button: Join (or Shoot). */
export default function Home() {
  const insets = useSafeAreaInsets();
  const clearance = useNavClearance();
  const profile = useProfile();
  const { isGuest } = useSession();
  const feed = useHomeFeed();
  const respond = useRespondDirectInvite();
  const net = useNetworkState();
  const inboxBadge = useNavStore((s) => s.inboxBadge);
  const [linkOpen, setLinkOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  useNavRetap('crews', () => scroll.current?.scrollTo({ y: 0, animated: true }));

  const data = feed.data;
  const offline =
    net.isConnected === false ||
    net.isInternetReachable === false ||
    (feed.isError && !!data && isRetryable(feed.error));
  const name = profile.data?.display_name ?? '';

  const refresh = async () => {
    setRefreshing(true);
    try {
      await feed.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const answer = async (id: string, accept: boolean, label: string) => {
    setAnswering(id);
    try {
      const res = await respond.mutateAsync({ id, accept });
      if (!accept) {
        toast.show({ message: `Declined ${label}` });
      } else if (res.status === 'requested') {
        toast.show({ message: `Requested. We'll tell you when a host says yes.` });
      } else {
        haptic.success();
        router.push(joinedHref(res));
      }
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    } finally {
      setAnswering(null);
    }
  };

  const crews = data?.crews ?? [];
  const invites = data?.pending_invites ?? [];
  const live = data?.live_rolls ?? [];
  const showStart = !!data && crews.length === 0;
  const loading = feed.isPending && !data;
  const failed = feed.isError && !data;

  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      <ScrollView
        ref={scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: clearance + 16,
          paddingHorizontal: 16,
          gap: 12,
        }}
      >
        <View className="flex-row items-center justify-between">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="You: profile and settings"
            onPress={() => router.push('/you')}
          >
            <Avatar
              name={name}
              avatarKey={profile.data?.avatar_key}
              ring={profile.data?.ring_color ?? 'lime'}
              size={48}
            />
          </PressableScale>
          <View className="flex-row items-center gap-2">
            <View>
              <IconButton
                icon="bell"
                label={inboxBadge > 0 ? `Inbox, ${inboxBadge} new` : 'Inbox'}
                onPress={() => router.push('/inbox')}
              />
              {inboxBadge > 0 ? (
                <View className="absolute right-1.5 top-1.5 h-3 w-3 rounded-pill border-2 border-paper bg-shutter dark:border-paper-dark" />
              ) : null}
            </View>
            {!isGuest ? (
              <Button
                label="New"
                icon="plus"
                variant="strong"
                size="sm"
                onPress={() => router.push('/sheets/create')}
              />
            ) : null}
          </View>
        </View>

        <Text variant="display" heading className="mt-1">
          Crews
        </Text>

        {offline ? <OfflineBanner /> : null}

        {failed ? (
          <EdgeState
            {...edge.fromError(feed.error)}
            icon={isRetryable(toAppError(feed.error)) ? 'alert' : 'info'}
            primary={{ label: 'Try again', onPress: () => void feed.refetch() }}
            secondary={{ label: 'Got a link?', onPress: () => setLinkOpen(true) }}
            primaryVariant="strong"
          />
        ) : null}

        {loading ? (
          <>
            <CrewCardSkeleton tint="lilac" />
            <CrewCardSkeleton tint="lime" />
            <CrewCardSkeleton tint="sky" />
          </>
        ) : null}

        {invites.map((inv) => (
          <InviteCard
            key={inv.id}
            invite={inv}
            busy={answering === inv.id}
            onJoin={() => void answer(inv.id, true, inv.roll?.name ?? inv.crew.name)}
            onDecline={() => void answer(inv.id, false, inv.roll?.name ?? inv.crew.name)}
          />
        ))}

        {live.slice(0, 2).map((r) => (
          <LiveBanner key={r.id} roll={r} lime={invites.length === 0 && live[0]?.id === r.id} />
        ))}

        {crews.map((c) => (
          <CrewCard key={c.id} crew={c} />
        ))}

        {showStart ? (
          <StartCrewCard
            canCreate={!isGuest}
            onStart={() => router.push('/sheets/create')}
            onLink={() => setLinkOpen(true)}
          />
        ) : null}

        {crews.length > 0 ? (
          <View className="items-center">
            <Button
              label="Got a link?"
              variant="tertiary"
              icon="link"
              onPress={() => setLinkOpen(true)}
            />
          </View>
        ) : null}
      </ScrollView>
      <InviteLinkSheet visible={linkOpen} onClose={() => setLinkOpen(false)} />
    </View>
  );
}

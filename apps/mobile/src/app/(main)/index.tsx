import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfile } from '@/data/profile';
import { useSession } from '@/data/session';
import { InviteLinkSheet } from '@/features/invites/InviteLinkSheet';
import { useNavRetap } from '@/state/nav';
import { Avatar, Button, DumpStack, PressableScale, Text, useNavClearance } from '@/ui';

/**
 * B1 Home · Crews — placeholder from the foundation.
 * TODO(track B): home_feed() (query key ['home-feed']): Snaps rail, invite cards, "Live now" banner,
 * Crew cards in their tint with dump stack + facepile; skeleton cards; offline banner.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const clearance = useNavClearance();
  const profile = useProfile();
  const { isGuest } = useSession();
  const [linkOpen, setLinkOpen] = useState(false);
  const scroll = useRef<ScrollView>(null);
  useNavRetap('crews', () => scroll.current?.scrollTo({ y: 0, animated: true }));

  const name = profile.data?.display_name ?? '';
  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: clearance, paddingHorizontal: 16 }}
      >
        <View className="flex-row items-center justify-between">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="You: profile and settings"
            onPress={() => router.push('/you')}
          >
            <Avatar name={name} avatarKey={profile.data?.avatar_key} ring={profile.data?.ring_color ?? 'lime'} size={48} />
          </PressableScale>
          {!isGuest ? (
            <Button label="New" icon="plus" variant="strong" size="sm" onPress={() => router.push('/sheets/create')} />
          ) : null}
        </View>
        <Text variant="display" heading className="mt-4">
          Crews
        </Text>

        {/* Empty state: never an empty list (B1). */}
        <View className="mt-5 overflow-hidden rounded-card bg-tint-lilac p-5 dark:bg-tint-lilac-dark">
          <Text variant="title">Start a Crew</Text>
          <Text variant="body" className="mt-1">
            One place for your people and every photo from every plan.
          </Text>
          <View className="my-2 w-full">
            <DumpStack aspectRatio={2} cardAspect={0.9} cards={[{ art: 'beach' }, { art: 'sunset' }, { art: 'party' }]} />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {!isGuest ? (
              <Button label="Start a Crew" variant="strong" onPress={() => router.push('/sheets/create')} />
            ) : null}
            <Button label="Got a link?" icon="link" variant="secondary" onPress={() => setLinkOpen(true)} />
          </View>
        </View>
      </ScrollView>
      <InviteLinkSheet visible={linkOpen} onClose={() => setLinkOpen(false)} />
    </View>
  );
}

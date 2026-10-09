import { useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavRetap } from '@/state/nav';
import { EdgeState, Text, useNavClearance } from '@/ui';

/**
 * C6 Inbox & activity — placeholder from the foundation.
 * TODO(track C+F): segmented Chats | Activity (['inbox-threads'], ['activity']), Mark all read,
 * invite rows with Join / Decline, skeleton rows; set the pill badge with useNavStore.setInboxBadge.
 */
export default function Inbox() {
  const insets = useSafeAreaInsets();
  const clearance = useNavClearance();
  const scroll = useRef<ScrollView>(null);
  useNavRetap('inbox', () => scroll.current?.scrollTo({ y: 0, animated: true }));
  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: clearance, paddingHorizontal: 16 }}
      >
        <Text variant="display" heading className="mt-12">
          Inbox
        </Text>
        <View className="mt-6">
          <EdgeState
            icon="chat"
            tone="sky"
            title="Quiet in here"
            body="Chats and activity from your Crews will show up here."
          />
        </View>
      </ScrollView>
    </View>
  );
}

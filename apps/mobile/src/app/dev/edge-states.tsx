import { router } from 'expo-router';
import { Linking, View } from 'react-native';
import { type EdgeContent, EdgeState, edge, Screen, Text, toast } from '@/ui';

const noop = () => toast.show({ message: 'Demo action' });

/** F6 catalogue: every EdgeState preset used by routes (dev only; reached from You in __DEV__). */
export default function EdgeStatesDemo() {
  const items: { content: EdgeContent; primary?: () => void; secondary?: () => void }[] = [
    { content: edge.inviteExpired('Tanvi'), primary: noop, secondary: () => router.replace('/') },
    { content: edge.inviteRevoked('Kabir'), primary: noop, secondary: () => router.replace('/') },
    { content: edge.inviteFull('Kabir'), primary: noop, secondary: () => router.replace('/') },
    { content: edge.inviteNotFound(), primary: noop, secondary: () => router.replace('/') },
    {
      content: edge.inviteDeclined("Mood Indigo '26"),
      primary: noop,
      secondary: () => router.replace('/'),
    },
    { content: edge.requested("Goa '26"), primary: noop },
    {
      content: edge.permissionDenied('photos'),
      primary: () => void Linking.openSettings(),
      secondary: noop,
    },
    {
      content: edge.permissionDenied('camera'),
      primary: () => void Linking.openSettings(),
      secondary: noop,
    },
    {
      content: edge.permissionDenied('notifications'),
      primary: () => void Linking.openSettings(),
      secondary: noop,
    },
    { content: edge.uploadsFailed(3), primary: noop },
    { content: edge.photoRemoved('Diya'), primary: noop },
    {
      content: edge.crewDeleted('Goa Gang', 'Aarav'),
      primary: noop,
      secondary: () => router.replace('/'),
    },
    { content: edge.removedFromCrew('Goa Gang', 'Aarav'), primary: () => router.replace('/') },
    { content: edge.offline(), primary: noop },
    {
      content: edge.fromError({ code: 'P0001', message: 'uploads_disabled' }),
      primary: noop,
      secondary: noop,
    },
  ];
  return (
    <Screen scroll header={{ back: true, title: 'Edge states' }}>
      <Text variant="stamp" tone="tertiary" className="mt-2">
        ONE PATTERN FOR EVERY DEAD END
      </Text>
      <Text variant="title" className="mb-4 mt-1">
        Say what happened, offer one way out
      </Text>
      <View className="gap-3">
        {items.map(({ content, primary, secondary }, i) => (
          <EdgeState
            key={i}
            icon={content.icon}
            tone={content.tone}
            title={content.title}
            body={content.body}
            primary={
              content.primaryLabel && primary
                ? { label: content.primaryLabel, onPress: primary }
                : undefined
            }
            secondary={
              content.secondaryLabel && secondary
                ? { label: content.secondaryLabel, onPress: secondary }
                : undefined
            }
          />
        ))}
      </View>
    </Screen>
  );
}

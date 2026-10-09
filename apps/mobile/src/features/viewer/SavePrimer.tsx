import { View } from 'react-native';
import { Button, EdgeState, edge, Icon, ModalSheet, Text, useColors } from '@/ui';

/** Shown right before the OS asks to save photos (A6 pattern: what we do, what we never do). */
export function SavePrimer({
  visible,
  denied,
  onAllow,
  onClose,
  onOpenSettings,
}: {
  visible: boolean;
  denied: boolean;
  onAllow: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const colors = useColors();
  const bullets = [
    { icon: 'download' as const, text: 'Photos save to your gallery only when you tap Save.' },
    { icon: 'lock' as const, text: 'Dumpr never reads the rest of your library to do this.' },
    { icon: 'share' as const, text: 'Rather not? Share sends the photo without saving it.' },
  ];
  const c = edge.permissionDenied('photos');
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={denied ? c.title : 'Let Dumpr save photos'}
      footer={
        denied ? undefined : (
          <View className="gap-1">
            <Button label="Allow saving" variant="primary" size="lg" onPress={onAllow} />
            <Button label="Not now" variant="tertiary" fullWidth onPress={onClose} />
          </View>
        )
      }
    >
      {denied ? (
        <EdgeState
          icon={c.icon}
          tone={c.tone}
          title="Saving is off"
          body="You can still share the photo, or allow saving in Settings."
          primary={{ label: 'Open Settings', onPress: onOpenSettings }}
          secondary={{ label: 'Not now', onPress: onClose }}
        />
      ) : (
        <View className="gap-3">
          <Text variant="body">Your phone will ask next. Here's exactly what that means.</Text>
          {bullets.map((b) => (
            <View key={b.text} className="flex-row items-start gap-3">
              <Icon name={b.icon} size={20} color={colors.ink} />
              <Text variant="body" className="flex-1">
                {b.text}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ModalSheet>
  );
}

import { Modal, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CrewTint } from '@/data/types';
import { Button, IconButton, Text, TINT_BG } from '@/ui';
import { displayLink } from './links';

/** QR on a white card (always ink on white so every scanner reads it, in dark mode too). */
export function QrCode({ value, size }: { value: string; size: number }) {
  return (
    <View className="rounded-[20px] bg-white p-3">
      <QRCode value={value} size={size} color="#16141B" backgroundColor="#FFFFFF" ecl="M" quietZone={0} />
    </View>
  );
}

export function QrSkeletonCard({ size }: { size: number }) {
  return (
    <View
      className="rounded-[20px] bg-white/70 dark:bg-white/10"
      style={{ width: size + 24, height: size + 24 }}
    />
  );
}

/** Full-screen QR in the Crew tint, for someone standing next to you. */
export function QrFullScreen({
  visible,
  onClose,
  value,
  title,
  tint,
}: {
  visible: boolean;
  onClose: () => void;
  value: string;
  title: string;
  tint: CrewTint;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const size = Math.min(width - 96, 320);
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View className={`flex-1 items-center justify-center px-6 ${TINT_BG[tint]}`}>
        <View className="absolute right-4" style={{ top: insets.top + 8 }}>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        <Text variant="stamp" tone="tertiary" className="mb-2 text-[12px]">
          SCAN TO JOIN
        </Text>
        <Text variant="title" heading className="mb-6 text-center">
          {title}
        </Text>
        <QrCode value={value} size={size} />
        <Text variant="stamp" tone="default" className="mt-6 text-[14px] normal-case">
          {displayLink(value)}
        </Text>
        <View className="mt-6">
          <Button label="Done" variant="strong" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

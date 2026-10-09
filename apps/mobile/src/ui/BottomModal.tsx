import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface BottomModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Sticky footer (the modal's primary action). */
  footer?: ReactNode;
  /** Wrap children in a ScrollView. Default true. */
  scroll?: boolean;
  /** Fraction of the screen height the modal may use. Default 0.85. */
  maxHeight?: `${number}%`;
}

/**
 * In-screen bottom sheet (RN Modal) for pickers and small confirmations that do not need their own
 * route (route sheets use `useSheetOptions` + `SheetContent`). Android back / backdrop tap close it.
 */
export function BottomModal({
  visible,
  onClose,
  title,
  children,
  footer,
  scroll = true,
  maxHeight = '85%',
}: BottomModalProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" accessibilityLabel="Close" onPress={onClose} />
        <View
          accessibilityViewIsModal
          className="rounded-t-sheet bg-paper px-5 pt-4 dark:bg-paper-dark"
          style={{ maxHeight, paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {title ? (
            <View className="mb-3 flex-row items-center justify-between">
              <Text variant="title" heading className="flex-1 pr-3">
                {title}
              </Text>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </View>
          ) : null}
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ flexGrow: 0 }}
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
          {footer ? <View className="mt-4">{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

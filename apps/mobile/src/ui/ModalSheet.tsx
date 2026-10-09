import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface ModalSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Small mono line above the title. */
  eyebrow?: string;
  children: ReactNode;
  /** Sticky footer (the sheet's primary action). */
  footer?: ReactNode;
  /** Wrap the body in a ScrollView. Default true. */
  scroll?: boolean;
  /** Close button in the corner. Default true. */
  closeButton?: boolean;
  /** Max height as a share of the screen. Default 0.92. */
  maxHeight?: `${number}%`;
}

/**
 * In-screen bottom sheet (RN Modal): for pickers and menus that belong to a screen (member list,
 * action menu, date range, reaction picker). Route-level sheets use `SheetContent` instead.
 * Android back and a backdrop tap dismiss it.
 */
export function ModalSheet({
  visible,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  scroll = true,
  closeButton = true,
  maxHeight = '92%',
}: ModalSheetProps) {
  const insets = useSafeAreaInsets();
  const body = (
    <View className="px-5 pb-4">
      {children}
    </View>
  );
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <Pressable className="flex-1" accessibilityLabel="Close" onPress={onClose} />
        <View
          className="rounded-t-sheet bg-paper pt-3 dark:bg-paper-dark"
          style={{ paddingBottom: footer ? 0 : Math.max(insets.bottom, 16), maxHeight }}
        >
          <View className="mb-2 items-center">
            <View className="h-1.5 w-10 rounded-pill bg-line dark:bg-line-dark" />
          </View>
          {title || closeButton ? (
            <View className="mb-2 flex-row items-start justify-between px-5">
              <View className="flex-1 pr-3 pt-1">
                {eyebrow ? (
                  <Text variant="stamp" tone="tertiary" className="mb-1 text-[11px]">
                    {eyebrow}
                  </Text>
                ) : null}
                {title ? (
                  <Text variant="title" heading>
                    {title}
                  </Text>
                ) : null}
              </View>
              {closeButton ? <IconButton icon="close" label="Close" onPress={onClose} /> : null}
            </View>
          ) : null}
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={{ flexGrow: 0 }}
            >
              {body}
            </ScrollView>
          ) : (
            body
          )}
          {footer ? (
            <View className="px-5 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

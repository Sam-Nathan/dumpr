import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton } from './IconButton';
import { goBack } from './navigation';
import { Text } from './Text';
import { useColors } from './theme';

/**
 * Detent presets for formSheet routes (fractions of the screen height, ascending).
 * 'auto' sizes the sheet to its content (short sheets such as Invite / Download confirm).
 */
export const SHEET_DETENTS = {
  auto: 'fitToContents',
  half: [0.5],
  halfAndFull: [0.5, 1],
  tall: [0.75],
  full: [1],
} as const;

export type SheetDetents = keyof typeof SHEET_DETENTS;

/**
 * Options for an expo-router `presentation: 'formSheet'` route. Spread into `<Stack.Screen options>`
 * (see `src/app/_layout.tsx`):  grabber visible, 32 px corners, dimmed backdrop.
 */
export function useSheetOptions(detents: SheetDetents = 'halfAndFull') {
  const colors = useColors();
  const allowed = SHEET_DETENTS[detents];
  return {
    headerShown: false,
    presentation: 'formSheet' as const,
    sheetAllowedDetents: (allowed === 'fitToContents' ? 'fitToContents' : [...allowed]) as
      | number[]
      | 'fitToContents',
    sheetGrabberVisible: true,
    sheetCornerRadius: 32,
    sheetInitialDetentIndex: 0,
    sheetExpandsWhenScrolledToEdge: true,
    contentStyle: { backgroundColor: colors.paper },
  };
}

export interface SheetContentProps {
  title?: string;
  /** Small mono line above the title. */
  eyebrow?: string;
  /** Close button in the corner (sheets also dismiss by swipe and Android back). Default true. */
  closeButton?: boolean;
  right?: ReactNode;
  children: ReactNode;
  /** Sticky footer (the sheet's primary action). */
  footer?: ReactNode;
  scroll?: boolean;
}

/** Body wrapper for sheet routes: title row, padding, optional sticky footer. */
export function SheetContent({
  title,
  eyebrow,
  closeButton = true,
  right,
  children,
  footer,
  scroll = true,
}: SheetContentProps) {
  const insets = useSafeAreaInsets();
  const inner = (
    <View className="px-5 pb-4 pt-5">
      {title || closeButton ? (
        <View className="mb-4 flex-row items-start justify-between">
          <View className="flex-1 pr-3">
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
          {right ?? (closeButton ? <IconButton icon="close" label="Close" onPress={goBack} /> : null)}
        </View>
      ) : null}
      {children}
    </View>
  );
  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
      {footer ? (
        <View className="px-5 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

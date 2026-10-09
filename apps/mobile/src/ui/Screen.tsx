import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header, type HeaderProps } from './Header';
import { useBackHandler } from './navigation';
import { INK } from './theme';

export interface ScreenProps {
  children: ReactNode;
  /** Header props; omit for a screen with no header (Home, Welcome). */
  header?: HeaderProps;
  /** Wrap children in a ScrollView. */
  scroll?: boolean;
  /** 16 px gutters (design: "screen gutter 16-20"). Default true. */
  padded?: boolean;
  /** Always-dark surface (Welcome, camera, viewer): ink background. */
  dark?: boolean;
  /** Bottom content inset in addition to the safe area (e.g. NavPill clearance). */
  bottomInset?: number;
  /** Sticky footer pinned above the keyboard / home indicator (primary action lives here). */
  footer?: ReactNode;
  /** Android hardware back override: return true when handled, false for default pop. */
  onHardwareBack?: () => boolean;
  /** Dismiss keyboard on drag / tap while scrolling. Default true. */
  keyboardAware?: boolean;
  testID?: string;
}

/**
 * Screen scaffold: safe area, paper background, optional header and sticky footer. Android back
 * pops one level by default (expo-router); pass `onHardwareBack` to intercept it for a step or mode.
 */
export function Screen({
  children,
  header,
  scroll = false,
  padded = true,
  dark = false,
  bottomInset = 0,
  footer,
  onHardwareBack,
  keyboardAware = true,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  useBackHandler(onHardwareBack ?? (() => false), !!onHardwareBack);

  const gutter = padded ? 'px-4' : '';
  const body = scroll ? (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: bottomInset + (footer ? 16 : insets.bottom + 16) }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={keyboardAware ? 'on-drag' : 'none'}
      showsVerticalScrollIndicator={false}
    >
      <View className={gutter}>{children}</View>
    </ScrollView>
  ) : (
    <View className={`flex-1 ${gutter}`}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      testID={testID}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className={`flex-1 ${dark ? '' : 'bg-paper dark:bg-paper-dark'}`}
      style={dark ? { backgroundColor: INK } : undefined}
    >
      <View style={{ paddingTop: insets.top }} />
      {header ? <Header {...header} inverse={header.inverse ?? dark} /> : null}
      {body}
      {footer ? (
        <View className={`${gutter} pt-3`} style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

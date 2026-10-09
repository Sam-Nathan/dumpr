import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainTab } from '../state/nav';
import { haptic } from './haptics';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { INK, INK_TEXT, SHUTTER, useScheme } from './theme';

/** Pill height and distance from the bottom safe area (use for list `contentContainerStyle`). */
export const NAV_PILL_HEIGHT = 76;
export const NAV_PILL_GAP = 12;

/** Bottom padding that keeps scroll content clear of the floating pill. */
export function useNavClearance(): number {
  return useSafeAreaInsets().bottom + NAV_PILL_GAP + NAV_PILL_HEIGHT + 16;
}

export interface NavPillProps {
  active: MainTab;
  /** Unread chats + pending invites. */
  inboxBadge?: number;
  onCrews: () => void;
  onInbox: () => void;
  /** Tap = open the camera. */
  onShutter: () => void;
  /** Reserved for the P2 quick Snap (hold). Unused at MVP. */
  onShutterLongPress?: () => void;
}

/**
 * Floating nav pill: Crews · Shutter · Inbox. Three slots only; everything else is one level down
 * (flows.md §2). The big lime ring is the shutter: tap = camera.
 */
export function NavPill({
  active,
  inboxBadge = 0,
  onCrews,
  onInbox,
  onShutter,
  onShutterLongPress,
}: NavPillProps) {
  const insets = useSafeAreaInsets();
  const dark = useScheme() === 'dark';
  const activeSurface = 'bg-ink dark:bg-ink-dark';
  const glyph = (isActive: boolean) => (isActive ? (dark ? INK : INK_TEXT) : dark ? INK_TEXT : INK);

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center"
      style={{ bottom: insets.bottom + NAV_PILL_GAP }}
    >
      <View
        accessibilityRole="tablist"
        className="flex-row items-center rounded-pill bg-surface px-3 dark:bg-surface-dark"
        style={{
          height: NAV_PILL_HEIGHT,
          gap: 14,
          shadowColor: '#16141B',
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        }}
      >
        <PressableScale
          accessibilityRole="tab"
          accessibilityLabel="Crews"
          accessibilityState={{ selected: active === 'crews' }}
          onPress={onCrews}
          className={`h-[52px] w-[52px] items-center justify-center rounded-pill ${active === 'crews' ? activeSurface : ''}`}
        >
          <Icon name="users" size={24} color={glyph(active === 'crews')} />
        </PressableScale>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Camera"
          accessibilityHint="Opens the camera"
          onPress={() => {
            haptic.heavy();
            onShutter();
          }}
          onLongPress={onShutterLongPress}
          haptics={false}
          scaleTo={0.92}
          className="h-[68px] w-[68px] items-center justify-center rounded-pill bg-flash"
        >
          <View
            className="h-[40px] w-[40px] rounded-pill"
            style={{ borderWidth: 4, borderColor: INK }}
          />
        </PressableScale>

        <PressableScale
          accessibilityRole="tab"
          accessibilityLabel={inboxBadge > 0 ? `Inbox, ${inboxBadge} new` : 'Inbox'}
          accessibilityState={{ selected: active === 'inbox' }}
          onPress={onInbox}
          className={`h-[52px] w-[52px] items-center justify-center rounded-pill ${active === 'inbox' ? activeSurface : ''}`}
        >
          <Icon name="chat" size={24} color={glyph(active === 'inbox')} />
          {inboxBadge > 0 ? (
            <View
              className="absolute right-1 top-1 min-w-[16px] items-center justify-center rounded-pill px-1"
              style={{ backgroundColor: SHUTTER, height: 16 }}
            >
              <Text variant="stamp" tone="inverse" className="text-[10px] leading-[14px]">
                {inboxBadge > 9 ? '9+' : inboxBadge}
              </Text>
            </View>
          ) : null}
        </PressableScale>
      </View>
    </View>
  );
}

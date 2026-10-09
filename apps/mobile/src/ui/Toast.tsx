import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { NAV_PILL_HEIGHT, NAV_PILL_GAP } from './NavPill';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastInput {
  message: string;
  /** One action at most (e.g. Undo). Toasts never carry decisions. */
  action?: ToastAction;
  /** Default 5000 ms (design-system §8). */
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastStore {
  current: ToastItem | null;
  show: (t: ToastInput) => number;
  hide: (id?: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set, get) => ({
  current: null,
  show: (t) => {
    const id = nextId++;
    set({ current: { ...t, id } });
    return id;
  },
  hide: (id) => {
    const cur = get().current;
    if (!cur || (id !== undefined && cur.id !== id)) return;
    set({ current: null });
  },
}));

/**
 * Global toast: `toast.show({ message: "Posted 3 to Goa '26", action: { label: 'Undo', onPress } })`.
 * Bottom, above the nav pill, 5 s, one action max. NEVER use it for errors that need a decision
 * (use Dialog or an EdgeState / inline message instead).
 */
export const toast = {
  show: (t: ToastInput) => useToastStore.getState().show(t),
  hide: (id?: number) => useToastStore.getState().hide(id),
};

/** Mount once in the root layout. */
export function ToastHost() {
  const current = useToastStore((s) => s.current);
  const hide = useToastStore((s) => s.hide);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!current) return undefined;
    AccessibilityInfo.announceForAccessibility(current.message);
    const timer = setTimeout(() => hide(current.id), current.durationMs ?? 5000);
    return () => clearTimeout(timer);
  }, [current, hide]);

  if (!current) return null;
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center px-4"
      style={{ bottom: insets.bottom + NAV_PILL_GAP + NAV_PILL_HEIGHT + 12 }}
    >
      <Animated.View
        key={current.id}
        entering={FadeInDown.duration(160)}
        exiting={FadeOutDown.duration(120)}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        className="min-h-[48px] w-full max-w-[480px] flex-row items-center justify-between rounded-input bg-ink py-1 pl-4 pr-2 dark:bg-surface-dark"
        style={{
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        <Text variant="body" tone="inverse" className="flex-1 pr-2" numberOfLines={2}>
          {current.message}
        </Text>
        {current.action ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={current.action.label}
            onPress={() => {
              current.action?.onPress();
              hide(current.id);
            }}
            className="px-3"
          >
            <Text variant="heading" tone="flash">
              {current.action.label}
            </Text>
          </PressableScale>
        ) : null}
      </Animated.View>
    </View>
  );
}

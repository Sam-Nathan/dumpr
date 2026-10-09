import * as Haptics from 'expo-haptics';

/** Haptics are garnish (flows.md cross-platform table): never awaited, never required, never throw. */
function safe(fn: () => Promise<void>) {
  try {
    void fn().catch(() => undefined);
  } catch {
    /* unsupported device */
  }
}

export const haptic = {
  /** Light tap on buttons / chips. */
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Selection tick (toggles, steppers). */
  select: () => safe(() => Haptics.selectionAsync()),
  /** Shutter, join, reveal. */
  heavy: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

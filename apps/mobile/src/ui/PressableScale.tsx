import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { haptic } from './haptics';
import { MIN_TARGET, PRESS_MS, PRESS_SCALE } from './theme';

export interface PressableScaleProps extends Omit<
  PressableProps,
  'style' | 'children' | 'className'
> {
  /** Classes for the visible surface (background, radius, padding, size). */
  className?: string;
  /** Layout style for the touch area wrapper (flex, alignSelf, margin). */
  wrapperStyle?: StyleProp<ViewStyle>;
  /** Style for the visible (scaling) surface, e.g. aspectRatio or a fixed size. */
  style?: StyleProp<ViewStyle>;
  /** Light haptic on press-in (garnish). Default true. */
  haptics?: boolean;
  /** Scale on press. Default 0.96. */
  scaleTo?: number;
  children?: ReactNode;
}

/**
 * Base pressable for the whole kit: scales to 0.96 over 80 ms (design-system §5), grows its hit area to
 * at least 44 x 44 and adds a light haptic. Everything tappable should build on this.
 */
export function PressableScale({
  className,
  wrapperStyle,
  style: surfaceStyle,
  haptics = true,
  scaleTo = PRESS_SCALE,
  children,
  onPressIn,
  onPressOut,
  disabled,
  hitSlop,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      disabled={disabled}
      hitSlop={hitSlop ?? 6}
      style={[
        { minHeight: MIN_TARGET, minWidth: MIN_TARGET, justifyContent: 'center' },
        wrapperStyle,
      ]}
      onPressIn={(e) => {
        scale.value = withTiming(scaleTo, { duration: PRESS_MS });
        if (haptics) haptic.tap();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withTiming(1, { duration: PRESS_MS });
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View className={className} style={[surfaceStyle, animated]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

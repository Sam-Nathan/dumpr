import { useEffect, useState } from 'react';
import { type DimensionValue, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Corner radius (default 10 = tile). Use 999 for circles / pills. */
  radius?: number;
  style?: ViewStyle;
  /** Tailwind classes for the base fill (e.g. a tint) instead of the neutral line colour. */
  className?: string;
}

/** Shimmering placeholder block. Static when the OS asks to reduce motion. */
export function Skeleton({ width = '100%', height = 16, radius = 10, style, className }: SkeletonProps) {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    x.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [reduce, x]);

  const band = useAnimatedStyle(() => ({
    transform: [{ translateX: -w + x.value * (w * 2) }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      className={`overflow-hidden ${className ?? 'bg-line dark:bg-line-dark'}`}
      style={[{ width, height, borderRadius: radius }, style]}
    >
      {reduce || w === 0 ? null : (
        <Animated.View
          className="bg-white/40 dark:bg-white/10"
          style={[{ position: 'absolute', top: 0, bottom: 0, width: w * 0.6 }, band]}
        />
      )}
    </View>
  );
}

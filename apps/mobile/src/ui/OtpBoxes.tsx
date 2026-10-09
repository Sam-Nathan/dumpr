import { useEffect, useRef } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { sanitizeOtp } from '../lib/phone';
import { haptic } from './haptics';
import { Text } from './Text';

export interface OtpBoxesProps {
  value: string;
  onChange: (value: string) => void;
  /** Fired once when all boxes are filled. */
  onComplete?: (code: string) => void;
  length?: number;
  /** Paints the boxes in the error colour. */
  error?: boolean;
  /** Increment to play the shake (wrong code). */
  shakeKey?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * OTP entry: N boxes driven by ONE hidden input, so paste, backspace, the iOS one-time-code
 * suggestion and Android SMS Retriever autofill (`autoComplete="sms-otp"`) all work, and focus
 * "auto-advances" naturally. Shakes when `shakeKey` changes.
 */
export function OtpBoxes({
  value,
  onChange,
  onComplete,
  length = 6,
  error,
  shakeKey = 0,
  disabled,
  autoFocus = true,
}: OtpBoxesProps) {
  const ref = useRef<TextInput>(null);
  const x = useSharedValue(0);
  const lastComplete = useRef('');

  useEffect(() => {
    if (shakeKey === 0) return;
    haptic.error();
    x.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 80 }),
      withTiming(-8, { duration: 70 }),
      withTiming(8, { duration: 70 }),
      withTiming(0, { duration: 50 }),
    );
  }, [shakeKey, x]);

  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const handle = (text: string) => {
    const clean = sanitizeOtp(text, length);
    onChange(clean);
    if (clean.length === length && lastComplete.current !== clean) {
      lastComplete.current = clean;
      onComplete?.(clean);
    }
    if (clean.length < length) lastComplete.current = '';
  };

  const active = Math.min(value.length, length - 1);
  return (
    <Animated.View style={shake}>
      <Pressable
        accessibilityLabel={`Enter the ${length}-digit code`}
        accessibilityHint="Opens the keyboard"
        onPress={() => ref.current?.focus()}
      >
        <View className="flex-row justify-between gap-2" pointerEvents="none">
          {Array.from({ length }).map((_, i) => {
            const char = value[i] ?? '';
            const isActive = i === active && !disabled && value.length < length;
            return (
              <View
                key={i}
                className={`h-14 flex-1 items-center justify-center rounded-input border bg-surface dark:bg-surface-dark ${
                  error
                    ? 'border-danger dark:border-danger-dark'
                    : isActive
                      ? 'border-2 border-ink dark:border-flash'
                      : 'border-line dark:border-line-dark'
                } ${isActive && !error ? 'bg-flash/10' : ''}`}
              >
                <Text variant="title" tone="default" className="font-mono-bold text-[24px]">
                  {char}
                </Text>
              </View>
            );
          })}
        </View>
      </Pressable>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={handle}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length * 2}
        caretHidden
        contextMenuHidden={false}
        importantForAutofill="yes"
        accessibilityLabel="One-time code"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0.02 }}
      />
    </Animated.View>
  );
}

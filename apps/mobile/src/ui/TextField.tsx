import { forwardRef, type ReactNode, useState } from 'react';
import { TextInput, type TextInputProps, View } from 'react-native';
import { Text } from './Text';
import { useColors } from './theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'className'> {
  label?: string;
  /** Muted hint after the label ("Birthday · optional"). */
  labelHint?: string;
  /** Error text (replaces helper). Never blames the user. */
  error?: string | null;
  helper?: string;
  /** Right accessory, e.g. a "✓ Available" status or a clear button. */
  right?: ReactNode;
  /** Left accessory, e.g. a country chip or an "@" prefix. */
  left?: ReactNode;
  testID?: string;
}

/**
 * Labelled text input: 52 px tall, 14 px radius, ink border while focused (as in the A2/A3 mockups).
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, labelHint, error, helper, right, left, onFocus, onBlur, editable = true, ...input },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const colors = useColors();
  const border = error
    ? 'border-danger dark:border-danger-dark'
    : focused
      ? 'border-ink dark:border-ink-dark'
      : 'border-line dark:border-line-dark';
  return (
    <View>
      {label ? (
        <Text variant="caption" tone="secondary" className="mb-1.5 font-body-semibold">
          {label}
          {labelHint ? <Text variant="caption"> · {labelHint}</Text> : null}
        </Text>
      ) : null}
      <View
        className={`min-h-[52px] flex-row items-center rounded-input border bg-surface px-4 dark:bg-surface-dark ${border} ${editable ? '' : 'opacity-60'}`}
      >
        {left ? <View className="mr-2">{left}</View> : null}
        <TextInput
          ref={ref}
          editable={editable}
          accessibilityLabel={input.accessibilityLabel ?? label}
          placeholderTextColor={colors.ink3}
          selectionColor={colors.ink}
          maxFontSizeMultiplier={2}
          className="min-h-[52px] flex-1 font-body-medium text-[16px] text-ink dark:text-ink-dark"
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
        />
        {right ? <View className="ml-2">{right}</View> : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" className="mt-1.5" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" className="mt-1.5">
          {helper}
        </Text>
      ) : null}
    </View>
  );
});

import { View } from 'react-native';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Greyed out; pair with `Segmented.disabledReason` text near the control. */
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Fill the container width (default true). */
  fullWidth?: boolean;
  accessibilityLabel?: string;
}

/** Pill segmented control (Crew | Roll, Live · When trip ends · Next morning). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  fullWidth = true,
  accessibilityLabel,
}: SegmentedProps<T>) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className={`flex-row rounded-pill bg-ink/[0.06] p-1 dark:bg-ink-dark/10 ${fullWidth ? '' : 'self-start'}`}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <PressableScale
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected, disabled: !!o.disabled }}
            disabled={o.disabled}
            haptics={false}
            onPress={() => onChange(o.value)}
            wrapperStyle={{ flex: fullWidth ? 1 : undefined, minHeight: 40 }}
            className={`h-10 items-center justify-center rounded-pill px-4 ${
              selected ? 'bg-ink dark:bg-ink-dark' : ''
            } ${o.disabled ? 'opacity-40' : ''}`}
          >
            <Text
              variant="caption"
              tone={selected ? 'inverse' : 'default'}
              className={`font-body-bold text-[14px] ${selected ? 'dark:text-ink' : ''}`}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

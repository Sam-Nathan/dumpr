import { View } from 'react-native';
import { haptic } from './haptics';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Count badge after the label ("Chats 3"). Hidden when 0 / undefined. */
  count?: number;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  testID?: string;
}

/** Pill segmented control (Chats | Activity, Original | High). The selected segment is a raised pill. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testID,
}: SegmentedProps<T>) {
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      className="h-12 flex-row rounded-pill bg-ink/[0.07] p-1 dark:bg-ink-dark/10"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <PressableScale
            key={o.value}
            accessibilityRole="tab"
            accessibilityLabel={o.count ? `${o.label}, ${o.count} new` : o.label}
            accessibilityState={{ selected }}
            haptics={false}
            scaleTo={0.98}
            onPress={() => {
              if (!selected) {
                haptic.select();
                onChange(o.value);
              }
            }}
            wrapperStyle={{ flex: 1, minHeight: 40 }}
            className={`h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-pill ${
              selected ? 'bg-surface dark:bg-surface-dark' : ''
            }`}
          >
            <Text
              variant="heading"
              tone={selected ? 'default' : 'secondary'}
              className="text-[15px]"
            >
              {o.label}
            </Text>
            {o.count ? (
              <View className="min-w-[20px] items-center rounded-pill bg-shutter px-1.5 py-0.5">
                <Text
                  variant="stamp"
                  tone="onFlash"
                  className="text-[11px] leading-[13px] text-white"
                >
                  {o.count > 99 ? '99+' : o.count}
                </Text>
              </View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

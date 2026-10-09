import type { ReactNode } from 'react';
import { Switch, View } from 'react-native';
import { haptic } from './haptics';
import { Text } from './Text';
import { useScheme } from './theme';

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}

/** Ink / lime switch. */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: ToggleProps) {
  const dark = useScheme() === 'dark';
  return (
    <Switch
      accessibilityLabel={accessibilityLabel}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        haptic.select();
        onValueChange(v);
      }}
      trackColor={{ false: dark ? '#3A3842' : '#D9D6DE', true: dark ? '#D4FF3F' : '#16141B' }}
      thumbColor={value && dark ? '#16141B' : value ? '#D4FF3F' : '#FFFFFF'}
      ios_backgroundColor={dark ? '#3A3842' : '#D9D6DE'}
    />
  );
}

export interface ToggleRowProps extends Omit<ToggleProps, 'accessibilityLabel'> {
  accessibilityLabel?: string;
  title: string;
  subtitle?: string;
  /** Why it is disabled (shown instead of the subtitle). Disabled switches always carry one. */
  disabledReason?: string;
  left?: ReactNode;
}

/** Settings row: title + helper on the left, switch on the right. */
export function ToggleRow({
  title,
  subtitle,
  disabledReason,
  left,
  accessibilityLabel,
  ...rest
}: ToggleRowProps) {
  const helper = rest.disabled && disabledReason ? disabledReason : subtitle;
  return (
    <View
      className={`min-h-[56px] flex-row items-center gap-3 py-2 ${rest.disabled ? 'opacity-60' : ''}`}
    >
      {left}
      <View className="flex-1">
        <Text variant="heading" className="text-[16px]">
          {title}
        </Text>
        {helper ? <Text variant="caption">{helper}</Text> : null}
      </View>
      <Toggle accessibilityLabel={accessibilityLabel ?? title} {...rest} />
    </View>
  );
}

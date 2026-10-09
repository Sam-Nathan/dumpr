import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { useColors } from './theme';

export interface SettingsRowProps {
  title: string;
  subtitle?: string;
  /** Right side: a value text, a ToggleSwitch, a Button... */
  trailing?: ReactNode;
  /** Show a chevron (a tappable row that opens something). */
  chevron?: boolean;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Draw a divider above (use on every row but the first in a group). */
  divider?: boolean;
  accessibilityHint?: string;
}

/** One row of a settings group (use inside `SettingsGroup`). */
export function SettingsRow({
  title,
  subtitle,
  trailing,
  chevron,
  onPress,
  destructive,
  disabled,
  divider,
  accessibilityHint,
}: SettingsRowProps) {
  const colors = useColors();
  const body = (
    <View
      className={`min-h-[56px] flex-row items-center justify-between gap-3 px-4 py-2.5 ${
        divider ? 'border-t border-line dark:border-line-dark' : ''
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <View className="flex-1">
        <Text
          variant="body"
          tone={destructive ? 'danger' : 'default'}
          className="font-body-semibold"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" className="mt-0.5">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View className="flex-shrink-0 flex-row items-center">{trailing}</View> : null}
      {chevron ? <Icon name="chevronRight" size={18} color={colors.ink3} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      haptics={false}
      scaleTo={0.99}
    >
      {body}
    </PressableScale>
  );
}

/** Rounded card holding `SettingsRow`s. */
export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-card border border-line bg-surface dark:border-line-dark dark:bg-surface-dark">
      {children}
    </View>
  );
}

/** Mono caps label above a group ("INVITES", "ACCOUNT"). */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="stamp" tone="tertiary" heading className="mb-2 mt-6 px-1 text-[11px]">
      {children}
    </Text>
  );
}

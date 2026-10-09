import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { INK, INK_TEXT, useScheme } from './theme';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Custom leading node (an Avatar) instead of an icon. */
  left?: ReactNode;
  /** Trailing node; a chevron is shown when the row is pressable and nothing is given. */
  right?: ReactNode;
  onPress?: () => void;
  /** Red title (leave, delete). */
  destructive?: boolean;
  disabled?: boolean;
  /** Hairline under the row. Default true. */
  divider?: boolean;
  accessibilityLabel?: string;
}

/** Standard tappable list / menu row (icon, title, caption, chevron). */
export function ListRow({
  title,
  subtitle,
  icon,
  left,
  right,
  onPress,
  destructive,
  disabled,
  divider = true,
  accessibilityLabel,
}: ListRowProps) {
  const dark = useScheme() === 'dark';
  const color = dark ? INK_TEXT : INK;
  const body = (
    <View
      className={`min-h-[56px] flex-row items-center gap-3 py-2 ${
        divider ? 'border-b border-line dark:border-line-dark' : ''
      } ${disabled ? 'opacity-40' : ''}`}
    >
      {left ?? (icon ? <Icon name={icon} size={22} color={destructive ? '#B42318' : color} /> : null)}
      <View className="flex-1">
        <Text variant="heading" tone={destructive ? 'danger' : 'default'} className="text-[16px]">
          {title}
        </Text>
        {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevronRight" size={18} color={color} /> : null)}
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      haptics={false}
      scaleTo={0.98}
      onPress={onPress}
      wrapperStyle={{ minHeight: 56 }}
    >
      {body}
    </PressableScale>
  );
}

import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { INK, INK_TEXT, useScheme } from './theme';

export type ChipTone = 'outline' | 'ink' | 'lime' | 'tint';

export interface ChipProps {
  label: string;
  /** Optional count shown after the label ("Sangeet 312"). */
  count?: number | string;
  selected?: boolean;
  onPress?: () => void;
  tone?: ChipTone;
  /** Monospace label (tags like #maggi-at-3am, codes). */
  mono?: boolean;
  icon?: IconName;
  disabled?: boolean;
  /** For always-dark surfaces (Welcome): light outline and text. */
  onDark?: boolean;
  /** Extra trailing node (e.g. a remove icon). */
  trailing?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

const BASE = 'h-8 flex-row items-center gap-1.5 rounded-pill px-3.5';

const SURFACE: Record<ChipTone, string> = {
  outline: 'border border-ink/20 dark:border-ink-dark/25',
  ink: 'bg-ink dark:bg-ink-dark',
  lime: 'bg-flash',
  tint: 'bg-tint-lime dark:bg-tint-lime-dark',
};

/**
 * Chip: filter / tag / suggestion. `selected` flips an outline chip to ink (and ink to lime) so
 * state never relies on colour alone: selected chips also expose `accessibilityState.selected`.
 */
export function Chip({
  label,
  count,
  selected = false,
  onPress,
  tone = 'outline',
  mono = false,
  icon,
  disabled,
  onDark = false,
  trailing,
  accessibilityLabel,
  testID,
}: ChipProps) {
  const dark = useScheme() === 'dark';
  const effective: ChipTone = selected
    ? tone === 'outline'
      ? 'ink'
      : tone === 'ink'
        ? 'lime'
        : tone
    : tone;
  const onInk = effective === 'ink';
  const darkOutline = onDark && effective === 'outline';
  const textTone = effective === 'lime' ? 'onFlash' : onInk ? 'inverse' : 'default';
  // 'ink' flips to light surface in dark mode, so its text must flip too.
  const labelTone = darkOutline ? 'inverse' : onInk && dark ? 'onFlash' : textTone;
  const iconColor = darkOutline
    ? INK_TEXT
    : effective === 'lime' || (onInk && dark)
      ? INK
      : onInk
        ? INK_TEXT
        : dark
          ? INK_TEXT
          : INK;

  const content = (
    <View
      className={`${BASE} ${darkOutline ? 'border border-white/25' : SURFACE[effective]} ${disabled ? 'opacity-40' : ''}`}
    >
      {icon ? <Icon name={icon} size={14} color={iconColor} /> : null}
      <Text
        variant="caption"
        tone={labelTone}
        className={`${mono ? 'font-mono' : 'font-body-semibold'} text-[13px]`}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <Text
          variant="caption"
          tone={onInk && !dark ? 'flash' : labelTone}
          className="font-mono-bold text-[12px]"
        >
          {count}
        </Text>
      ) : null}
      {trailing}
    </View>
  );

  if (!onPress) return content;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (count !== undefined ? `${label} ${count}` : label)}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
    >
      {content}
    </PressableScale>
  );
}

import { View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { INK, INK_TEXT, useScheme } from './theme';

export type IconButtonVariant = 'soft' | 'ink' | 'flash' | 'ghost' | 'onDark';

export interface IconButtonProps {
  icon: IconName;
  /** Required: icon-only controls need a spoken label. */
  label: string;
  onPress?: () => void;
  variant?: IconButtonVariant;
  /** Visual diameter. The touch target is always >= 44. Default 44. */
  size?: number;
  disabled?: boolean;
  testID?: string;
}

const SURFACE: Record<IconButtonVariant, string> = {
  soft: 'bg-ink/[0.06] dark:bg-ink-dark/10',
  ink: 'bg-ink dark:bg-ink-dark',
  flash: 'bg-flash',
  ghost: '',
  onDark: 'bg-white/15',
};

/** Round icon button (back, close, share, add member...). */
export function IconButton({
  icon,
  label,
  onPress,
  variant = 'soft',
  size = 44,
  disabled,
  testID,
}: IconButtonProps) {
  const dark = useScheme() === 'dark';
  const color =
    variant === 'ink'
      ? dark
        ? INK
        : INK_TEXT
      : variant === 'flash'
        ? INK
        : variant === 'onDark'
          ? INK_TEXT
          : dark
            ? INK_TEXT
            : INK;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      wrapperStyle={{ alignItems: 'center' }}
      className={`rounded-pill ${SURFACE[variant]} ${disabled ? 'opacity-40' : ''}`}
    >
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={Math.round(size * 0.5)} color={color} />
      </View>
    </PressableScale>
  );
}

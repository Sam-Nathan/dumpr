import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text, type TextTone } from './Text';
import { INK, INK_TEXT, useScheme } from './theme';

export type ButtonVariant = 'primary' | 'strong' | 'secondary' | 'tertiary' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /** primary = the ONE lime button per screen. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /**
   * Why the button is disabled. Required by the design: "never a silent grey button". Shown beside
   * (inline buttons) or beneath (full-width buttons) the control whenever `disabled`.
   */
  disabledReason?: string;
  icon?: IconName;
  /** Render secondary / tertiary for always-dark surfaces (Welcome, camera). */
  onDark?: boolean;
  /** Stretch to the container width. Default true for lg, false otherwise. */
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID?: string;
}

const SURFACE: Record<ButtonVariant, string> = {
  primary: 'bg-flash',
  strong: 'bg-ink dark:bg-ink-dark',
  secondary: 'border border-ink/15 bg-surface dark:border-ink-dark/20 dark:bg-surface-dark',
  tertiary: '',
  destructive: '',
};

const LABEL_TONE: Record<ButtonVariant, TextTone> = {
  primary: 'onFlash',
  strong: 'inverse',
  secondary: 'default',
  tertiary: 'secondary',
  destructive: 'danger',
};

const HEIGHT: Record<ButtonSize, string> = { sm: 'h-11 px-5', md: 'h-12 px-6', lg: 'h-14 px-8' };

/**
 * Button hierarchy (design-system §5): primary (lime, one per screen) / strong (ink) / secondary
 * (outline) / tertiary (text) / destructive (danger text). Disabled = 40 % opacity + a reason.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  disabledReason,
  icon,
  onDark = false,
  fullWidth,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const scheme = useScheme();
  const full = fullWidth ?? size === 'lg';
  const inactive = disabled || loading;
  const iconColor =
    onDark && (variant === 'secondary' || variant === 'tertiary')
      ? INK_TEXT
      : variant === 'primary'
      ? INK
      : variant === 'strong'
        ? scheme === 'dark'
          ? INK
          : INK_TEXT
        : variant === 'destructive'
          ? scheme === 'dark'
            ? '#FF8A73'
            : '#B42318'
          : scheme === 'dark'
            ? INK_TEXT
            : INK;
  const spinner: ReactNode = (
    <ActivityIndicator
      size="small"
      color={variant === 'strong' && scheme === 'dark' ? INK : variant === 'primary' ? INK : iconColor}
    />
  );
  const textOnly = variant === 'tertiary' || variant === 'destructive';
  const surface =
    onDark && variant === 'secondary'
      ? 'border border-white/25'
      : SURFACE[variant];
  const labelTone: TextTone =
    onDark && (variant === 'secondary' || variant === 'tertiary') ? 'inverse' : LABEL_TONE[variant];
  const reason = disabled && disabledReason ? disabledReason : null;

  return (
    <View
      className={full ? 'w-full' : reason ? 'flex-row items-center gap-3 self-start' : 'self-start'}
    >
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy: loading }}
        disabled={inactive}
        onPress={onPress}
        wrapperStyle={full ? { width: '100%' } : undefined}
        className={`${HEIGHT[size]} ${textOnly ? '' : 'rounded-pill'} ${surface} flex-row items-center justify-center gap-2 ${
          inactive ? 'opacity-40' : ''
        }`}
      >
        {loading ? (
          spinner
        ) : (
          <>
            {icon ? <Icon name={icon} size={18} color={iconColor} /> : null}
            <Text
              variant="heading"
              tone={labelTone}
              className={size === 'lg' ? 'text-[17px]' : 'text-[15px]'}
              numberOfLines={1}
            >
              {label}
            </Text>
          </>
        )}
      </PressableScale>
      {reason ? (
        <Text variant="caption" className={full ? 'mt-2 text-center' : 'flex-shrink'}>
          {reason}
        </Text>
      ) : null}
    </View>
  );
}


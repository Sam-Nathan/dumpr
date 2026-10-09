import type { ReactNode } from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

export type TextVariant =
  | 'displayXl'
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'caption'
  | 'stamp';

export type TextTone =
  | 'default'
  | 'secondary'
  | 'tertiary'
  | 'danger'
  | 'success'
  | 'shutter'
  | 'flash'
  /** Always-light text for always-dark surfaces (Welcome, camera, viewer). */
  | 'inverse'
  /** Always-ink text for lime / tinted surfaces. */
  | 'onFlash';

/** Sizes from tokens.json `type`. Display sizes cap font scaling at 1.3x (design-system §3.2). */
const VARIANT: Record<TextVariant, string> = {
  displayXl: 'font-display-extrabold text-[72px] leading-[65px] tracking-[-2px]',
  display: 'font-display-extrabold text-[40px] leading-[40px] tracking-[-1px]',
  title: 'font-display-extrabold text-[26px] leading-[29px] tracking-[-0.5px]',
  heading: 'font-display text-[17px] leading-[20px]',
  body: 'font-body-medium text-[15px] leading-[22px]',
  caption: 'font-body-medium text-[13px] leading-[18px]',
  stamp: 'font-mono-bold text-[12px] leading-[16px] uppercase tracking-[0.5px]',
};

const TONE: Record<TextTone, string> = {
  default: 'text-ink dark:text-ink-dark',
  secondary: 'text-ink2 dark:text-ink2-dark',
  tertiary: 'text-ink3 dark:text-ink3-dark',
  danger: 'text-danger dark:text-danger-dark',
  success: 'text-[#2F6B12] dark:text-flash',
  shutter: 'text-shutter dark:text-shutter-dark',
  flash: 'text-flash',
  inverse: 'text-ink-dark',
  onFlash: 'text-ink',
};

/** Tone each variant uses when `tone` is not given. */
const DEFAULT_TONE: Record<TextVariant, TextTone> = {
  displayXl: 'default',
  display: 'default',
  title: 'default',
  heading: 'default',
  body: 'secondary',
  caption: 'tertiary',
  stamp: 'shutter',
};

const MAX_SCALE: Record<TextVariant, number> = {
  displayXl: 1.3,
  display: 1.3,
  title: 1.3,
  heading: 2,
  body: 2,
  caption: 2,
  stamp: 1.5,
};

export interface TextProps extends Omit<RNTextProps, 'children'> {
  variant?: TextVariant;
  tone?: TextTone;
  /** Mark as a screen/section heading for screen readers. */
  heading?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * Typography primitive. Always use this instead of RN `Text` so type scale, fonts, tone and dark mode
 * stay consistent. `body` defaults to ink-2 and `caption` to ink-3 as in the design.
 */
export function Text({
  variant = 'body',
  tone,
  heading,
  className,
  children,
  maxFontSizeMultiplier,
  ...rest
}: TextProps) {
  const cls = `${VARIANT[variant]} ${TONE[tone ?? DEFAULT_TONE[variant]]}${className ? ` ${className}` : ''}`;
  return (
    <RNText
      className={cls}
      accessibilityRole={heading ? 'header' : rest.accessibilityRole}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_SCALE[variant]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

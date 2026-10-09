import type { ReactNode } from 'react';
import { View } from 'react-native';
import { IconButton } from './IconButton';
import { goBack } from './navigation';
import { Text } from './Text';

export interface HeaderProps {
  title?: string;
  /** Small mono line above the title (e.g. "STEP 1 OF 2"). */
  eyebrow?: string;
  /** Show a back button. Default false. */
  back?: boolean;
  /** Custom back action (defaults to pop one level, falling back to Home). */
  onBack?: () => void;
  /** Use a close (x) icon instead of back (modals). */
  close?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  /** Light text for always-dark screens. */
  inverse?: boolean;
}

/** Top bar: back/close, centred title, right slot. Back always pops one level. */
export function Header({ title, eyebrow, back, onBack, close, left, right, inverse }: HeaderProps) {
  const showLeft = back || close;
  return (
    <View className="min-h-[52px] flex-row items-center justify-between px-4 py-1">
      <View className="min-w-[44px] items-start">
        {left ??
          (showLeft ? (
            <IconButton
              icon={close ? 'close' : 'back'}
              label={close ? 'Close' : 'Back'}
              variant={inverse ? 'onDark' : 'soft'}
              onPress={onBack ?? goBack}
            />
          ) : null)}
      </View>
      <View className="flex-1 items-center px-2">
        {eyebrow ? (
          <Text variant="stamp" tone={inverse ? 'inverse' : 'tertiary'} className="text-[11px]">
            {eyebrow}
          </Text>
        ) : null}
        {title ? (
          <Text variant="heading" tone={inverse ? 'inverse' : 'default'} heading numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      <View className="min-w-[44px] items-end">{right}</View>
    </View>
  );
}

import { View } from 'react-native';
import type { CrewTint } from '../data/types';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { FLASH, INK, INK_TEXT, TINT_BG, useScheme } from './theme';

export type EdgeTone = CrewTint | 'neutral' | 'ink';

export interface EdgeAction {
  label: string;
  onPress: () => void;
  loading?: boolean;
}

export interface EdgeContent {
  icon: IconName;
  tone: EdgeTone;
  title: string;
  body: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}

export interface EdgeStateProps extends Omit<EdgeContent, 'primaryLabel' | 'secondaryLabel'> {
  /** The one fix. Lime. */
  primary?: EdgeAction;
  /** The one escape ("Go home", "Pick manually"). Text button. */
  secondary?: EdgeAction;
  /** 'card' = compact row used inline (A6 denied, lists); 'screen' = centred full-screen dead end. */
  layout?: 'card' | 'screen';
  /** Lime primary is skipped when another lime button already owns the screen. */
  primaryVariant?: 'primary' | 'strong' | 'secondary';
}

function IconChip({ icon, tone, big }: { icon: IconName; tone: EdgeTone; big?: boolean }) {
  const dark = useScheme() === 'dark';
  const surface =
    tone === 'ink'
      ? 'bg-ink dark:bg-surface-dark'
      : tone === 'neutral'
        ? 'bg-ink/[0.07] dark:bg-ink-dark/10'
        : TINT_BG[tone];
  const color = tone === 'ink' ? FLASH : dark ? INK_TEXT : INK;
  const size = big ? 64 : 44;
  return (
    <View
      className={`items-center justify-center ${big ? 'rounded-card' : 'rounded-input'} ${surface}`}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={big ? 30 : 22} color={color} />
    </View>
  );
}

/**
 * F6 edge state: ONE pattern for every dead end. Illustration chip, headline, one sentence, one
 * primary action, one escape. Say what happened, offer one way out, never blame the user, name the
 * person when a person did it.
 */
export function EdgeState({
  icon,
  tone,
  title,
  body,
  primary,
  secondary,
  layout = 'card',
  primaryVariant = 'primary',
}: EdgeStateProps) {
  const actions = (
    <View
      className={
        layout === 'screen' ? 'mt-6 w-full gap-1' : 'mt-3 flex-row flex-wrap items-center gap-x-2'
      }
    >
      {primary ? (
        <Button
          label={primary.label}
          onPress={primary.onPress}
          loading={primary.loading}
          variant={primaryVariant}
          size={layout === 'screen' ? 'lg' : 'sm'}
          fullWidth={layout === 'screen'}
        />
      ) : null}
      {secondary ? (
        <Button
          label={secondary.label}
          onPress={secondary.onPress}
          variant="tertiary"
          size={layout === 'screen' ? 'md' : 'sm'}
          fullWidth={layout === 'screen'}
        />
      ) : null}
    </View>
  );

  if (layout === 'screen') {
    return (
      <View className="flex-1 items-center justify-center px-6" accessibilityRole="alert">
        <IconChip icon={icon} tone={tone} big />
        <Text variant="title" heading className="mt-5 text-center">
          {title}
        </Text>
        <Text variant="body" className="mt-2 max-w-[320px] text-center">
          {body}
        </Text>
        {actions}
      </View>
    );
  }
  return (
    <View
      accessibilityRole="alert"
      className="flex-row gap-3 rounded-card border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark"
    >
      <IconChip icon={icon} tone={tone} />
      <View className="flex-1">
        <Text variant="heading" heading>
          {title}
        </Text>
        <Text variant="body" className="mt-0.5">
          {body}
        </Text>
        {actions}
      </View>
    </View>
  );
}

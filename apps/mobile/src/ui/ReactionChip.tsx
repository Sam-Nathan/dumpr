import { View } from 'react-native';
import type { ReactionKind } from '../data/types';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { useScheme } from './theme';

export interface ReactionChipProps {
  kind: ReactionKind;
  count?: number;
  /** The viewer has reacted with this word. */
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
}

/**
 * Reactions are WORDS, not emoji (design-system §6): ICONIC · LMAO · CRYING · HEART · SAME. ICONIC
 * is the lime one, the others are ink; unselected-with-zero reads as an outline.
 */
export function ReactionChip({
  kind,
  count,
  selected = false,
  onPress,
  onLongPress,
  disabled,
}: ReactionChipProps) {
  const dark = useScheme() === 'dark';
  const lime = kind === 'ICONIC' || selected;
  const hasCount = (count ?? 0) > 0;
  const filled = lime || hasCount;
  const surface = lime
    ? 'bg-flash'
    : hasCount
      ? 'bg-ink dark:bg-ink-dark'
      : 'border border-ink/20 dark:border-ink-dark/25';
  const labelTone = lime ? 'onFlash' : hasCount ? (dark ? 'onFlash' : 'inverse') : 'default';

  const body = (
    <View className={`h-8 flex-row items-center gap-1.5 rounded-pill px-3 ${surface}`}>
      <Text variant="stamp" tone={labelTone} className="text-[12px]">
        {kind}
      </Text>
      {hasCount ? (
        <Text
          variant="stamp"
          tone={lime ? 'onFlash' : dark ? 'onFlash' : 'flash'}
          className="text-[12px]"
        >
          {count}
        </Text>
      ) : null}
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${kind}${hasCount ? ` ${count}` : ''}`}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      scaleTo={filled ? 0.94 : 0.96}
    >
      {body}
    </PressableScale>
  );
}

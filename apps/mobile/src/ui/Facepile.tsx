import { View } from 'react-native';
import type { RingColor } from '../data/types';
import { Avatar } from './Avatar';
import { Text } from './Text';

export interface FacepilePerson {
  name: string;
  avatarKey?: string | null;
  avatarUrl?: string | null;
  ring?: RingColor | 'none';
}

export interface FacepileProps {
  people: readonly FacepilePerson[];
  /** Total members when `people` is only a sample (renders "+N" for the rest). */
  total?: number;
  /** Faces shown before "+N". Default 3 ("DI AR KS +3"). */
  max?: number;
  size?: number;
}

/** Overlapping avatars with a "+N" remainder chip. */
export function Facepile({ people, total, max = 3, size = 32 }: FacepileProps) {
  const shown = people.slice(0, max);
  const extra = Math.max(0, (total ?? people.length) - shown.length);
  const overlap = Math.round(size * 0.28);
  const label = `${total ?? people.length} people${shown.length ? `, including ${shown.map((p) => p.name).join(', ')}` : ''}`;
  return (
    <View
      accessible
      accessibilityLabel={label}
      className="flex-row items-center"
      style={{ paddingLeft: overlap }}
    >
      {shown.map((p, i) => (
        <View
          key={`${p.name}-${i}`}
          className="rounded-pill bg-paper p-0.5 dark:bg-paper-dark"
          style={{ marginLeft: -overlap, zIndex: shown.length - i }}
        >
          <Avatar
            name={p.name}
            uri={p.avatarUrl}
            avatarKey={p.avatarKey}
            size={size}
            ring={p.ring ?? 'none'}
          />
        </View>
      ))}
      {extra > 0 ? (
        <View
          className="items-center justify-center rounded-pill bg-ink/[0.07] dark:bg-ink-dark/15"
          style={{ width: size, height: size, marginLeft: -overlap, zIndex: 0 }}
        >
          <Text variant="caption" tone="secondary" className="font-body-bold text-[12px]">
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

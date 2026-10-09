import { Image } from 'expo-image';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSignedUrl } from '@/data/media';
import type { CrewRollSummary } from '@/data/types-b';
import { formatDateRange, pluralize } from '@/lib/format';
import { Icon, PressableScale, Text, TINT_BG, INK, FLASH } from '@/ui';
import type { CrewTint } from '@/data/types';
import { photoIdFromKey } from '../rolls/keys';

/** Large Roll card: cover, name, "12–15 Mar · 142 photos", LIVE / sealed badges. */
export function RollCard({ roll, tint }: { roll: CrewRollSummary; tint: CrewTint }) {
  const coverId = photoIdFromKey(roll.cover_thumb_key);
  const url = useSignedUrl(roll.sealed ? null : coverId, 'thumb');
  const range = formatDateRange(roll.starts_on, roll.ends_on);
  const meta = [range, pluralize(roll.photo_count, 'photo')].filter(Boolean).join(' · ');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${roll.name}, ${meta}${roll.live ? ', live now' : ''}${roll.sealed ? ', sealed' : ''}`}
      onPress={() => router.push(`/roll/${roll.id}`)}
      className="overflow-hidden rounded-card border border-line bg-surface dark:border-line-dark dark:bg-surface-dark"
    >
      <View style={{ aspectRatio: 1.7 }} className={roll.sealed ? 'bg-ink' : TINT_BG[tint]}>
        {roll.sealed ? (
          <View className="flex-1 items-center justify-center">
            <Icon name="lock" size={34} color={FLASH} />
          </View>
        ) : (
          <Image
            source={url ? { uri: url, cacheKey: `${coverId}:thumb` } : undefined}
            recyclingKey={coverId ?? undefined}
            contentFit="cover"
            transition={140}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            accessibilityIgnoresInvertColors
          />
        )}
        <View className="absolute left-3 top-3 flex-row gap-2">
          {roll.live ? (
            <View className="rounded-pill bg-ink px-2.5 py-1">
              <Text variant="stamp" className="text-[11px]">
                LIVE NOW
              </Text>
            </View>
          ) : null}
          {roll.sealed ? (
            <View className="rounded-pill bg-flash px-2.5 py-1">
              <Text variant="stamp" tone="onFlash" className="text-[11px]">
                SEALED
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View className="p-4">
        <Text variant="title" heading numberOfLines={2}>
          {roll.name}
        </Text>
        <Text variant="caption" className="mt-1">
          {meta}
        </Text>
      </View>
    </PressableScale>
  );
}

export function NewRollCard({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="New Roll for the next plan"
      onPress={onPress}
      className="h-[72px] flex-row items-center justify-center gap-2 rounded-card border border-dashed border-ink/30 dark:border-ink-dark/30"
    >
      <Icon name="plus" size={18} color={INK} />
      <Text variant="heading" className="text-[16px]">
        New Roll for the next plan
      </Text>
    </PressableScale>
  );
}

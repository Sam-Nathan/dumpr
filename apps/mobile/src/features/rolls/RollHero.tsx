import { Image } from 'expo-image';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignedUrl } from '@/data/media';
import type { RollHeader } from '@/data/types-b';
import { formatDateRange, pluralize } from '@/lib/format';
import { Facepile, IconButton, Skeleton, Text, TINT_BG, goBack } from '@/ui';
import { photoIdFromKey } from './keys';

function creditLine(names: string[], extra: number): string {
  if (names.length === 0) return '';
  const first = names.map((n) => n.split(/\s+/)[0] ?? n).slice(0, 2);
  return `Photos by ${first.join(', ')}${extra > 0 ? ` +${extra}` : ''}`;
}

/** Cover hero: crew-tinted, title, "Udaipur · 21–24 Nov · 1,204 photos · 6 members", credits. */
export function RollHero({
  header,
  memberCount,
  onShare,
  onMore,
  sharing,
}: {
  header: RollHeader | undefined;
  memberCount?: number;
  onShare?: () => void;
  onMore?: () => void;
  sharing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const coverId = photoIdFromKey(header?.roll.cover_thumb_key);
  const cover = useSignedUrl(header?.sealed ? null : coverId, 'thumb');
  const tint = header?.crew.tint ?? 'lilac';
  const roll = header?.roll;
  const meta = roll
    ? [
        roll.location_name,
        formatDateRange(roll.starts_on, roll.ends_on),
        header?.sealed ? null : pluralize(header?.photo_count ?? 0, 'photo'),
        memberCount ? pluralize(memberCount, 'member') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const contributors = header?.contributors ?? [];
  const shown = contributors.slice(0, 5);
  const extra = Math.max(0, contributors.length - 2);

  return (
    <View className={`rounded-b-sheet px-4 pb-4 ${TINT_BG[tint]}`} style={{ paddingTop: insets.top + 8 }}>
      <View className="flex-row items-center justify-between">
        <IconButton icon="back" label="Back" onPress={goBack} />
        {header ? (
          <View className="flex-row items-center gap-2">
            {header.my.is_guest ? null : (
              <IconButton
                icon="share"
                label="Share invite link"
                disabled={sharing}
                onPress={onShare}
              />
            )}
            <IconButton icon="more" label="More" onPress={onMore} />
          </View>
        ) : null}
      </View>

      <View className="mt-3 flex-row items-end gap-3">
        <View className="flex-1">
          {roll ? (
            <>
              <Text variant="stamp" tone="tertiary" className="mb-1 text-[11px]" numberOfLines={1}>
                {header?.crew.name.toUpperCase()}
              </Text>
              <Text variant="display" heading numberOfLines={3}>
                {roll.name}
              </Text>
              {meta ? (
                <Text variant="caption" tone="secondary" className="mt-1.5">
                  {meta}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <Skeleton width="70%" height={40} radius={10} className="bg-white/50 dark:bg-white/10" />
              <View className="mt-2">
                <Skeleton width="50%" height={14} radius={7} className="bg-white/50 dark:bg-white/10" />
              </View>
            </>
          )}
        </View>
        {cover ? (
          <Image
            source={{ uri: cover, cacheKey: `${coverId}:thumb` }}
            contentFit="cover"
            transition={140}
            style={{ width: 72, height: 72, borderRadius: 16 }}
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>

      {shown.length > 0 ? (
        <View className="mt-3 flex-row items-center gap-3">
          <Facepile
            size={28}
            max={4}
            total={contributors.length}
            people={shown.map((c) => ({ name: c.display_name, avatarKey: c.avatar_key, ring: c.ring_color }))}
          />
          <Text variant="caption" tone="secondary" className="flex-shrink">
            {creditLine(shown.map((c) => c.display_name), extra)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

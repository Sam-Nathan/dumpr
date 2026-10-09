import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { useSignedUrls } from '@/data/media';
import type { HomeCrew } from '@/data/types-b';
import { formatRelative, pluralize } from '@/lib/format';
import { DumpStack, Facepile, PressableScale, Skeleton, Text, TINT_BG, type StackCard } from '@/ui';
import { photoIdFromKey } from '../rolls/keys';

/** Crew card on Home: in its tint, dump stack of recent thumbs, facepile, unread chip. */
export function CrewCard({ crew }: { crew: HomeCrew }) {
  const ids = useMemo(
    () => crew.stack.map((k) => photoIdFromKey(k)).filter((x): x is string => !!x),
    [crew.stack],
  );
  const items = useMemo(
    () => ids.map((photoId) => ({ photoId, variant: 'thumb' as const })),
    [ids],
  );
  const urls = useSignedUrls(items);
  const cards: StackCard[] = ids.length
    ? ids.map((id) => ({ uri: urls[`${id}:thumb`], cacheKey: `${id}:thumb` })).reverse()
    : [{ art: 'beach' }, { art: 'sunset' }];

  const deleted = !!crew.deleted_at;
  const activity = crew.last_activity_at ? formatRelative(crew.last_activity_at) : '';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${crew.name}, ${pluralize(crew.member_count, 'member')}${
        crew.unread_count > 0 ? `, ${crew.unread_count} new` : ''
      }`}
      onPress={() => router.push(`/crew/${crew.id}`)}
      className={`overflow-hidden rounded-card p-5 ${TINT_BG[crew.tint]}`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text variant="title" heading numberOfLines={2}>
            {crew.name}
          </Text>
          <Text variant="caption" tone="secondary" className="mt-1">
            {pluralize(crew.member_count, 'member')}
            {deleted
              ? ' · Deleted'
              : activity && activity !== 'now'
                ? ` · active ${activity}`
                : ' · active now'}
          </Text>
        </View>
        <Facepile
          size={30}
          max={3}
          total={crew.member_count}
          people={crew.facepile.map((p) => ({
            name: p.display_name,
            avatarKey: p.avatar_key,
            ring: p.ring_color,
          }))}
        />
      </View>
      <View className="mt-2">
        <DumpStack aspectRatio={1.7} cardAspect={1.1} cards={cards} animated={false} />
        {crew.unread_count > 0 ? (
          <View className="absolute right-0 top-1 rounded-pill bg-flash px-3 py-1.5">
            <Text variant="stamp" tone="onFlash" className="text-[12px]">
              {crew.unread_count > 99 ? '99+' : crew.unread_count} new
            </Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

export function CrewCardSkeleton({ tint }: { tint: HomeCrew['tint'] }) {
  return (
    <View className={`overflow-hidden rounded-card p-5 ${TINT_BG[tint]}`}>
      <Skeleton width="55%" height={26} radius={8} className="bg-white/50 dark:bg-white/10" />
      <View className="mt-2">
        <Skeleton width="35%" height={14} radius={7} className="bg-white/50 dark:bg-white/10" />
      </View>
      <View className="mt-4">
        <Skeleton height={150} radius={18} className="bg-white/40 dark:bg-white/[0.07]" />
      </View>
    </View>
  );
}

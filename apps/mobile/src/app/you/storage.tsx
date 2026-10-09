import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useMyStorage } from '@/data/useStorage';
import { cacheBytes, clearCache } from '@/features/storage/cache';
import { cacheLabel, planLine, storageBar } from '@/features/storage/math';
import { clearFinishedUploads } from '@/features/uploads';
import { formatBytes } from '@/lib/format';
import {
  Button,
  EdgeState,
  edge,
  Icon,
  Screen,
  SettingsGroup,
  SettingsRow,
  Skeleton,
  Text,
  toast,
  useColors,
} from '@/ui';

/**
 * F4 Storage: usage bar by Crew, plan line, "Free up space on this phone", cache, upload quality and
 * the retention promise. The plan limit comes from the server (`my_storage().limit_bytes`); until the
 * owner configures one the screen says "No limit yet".
 */
export default function StorageScreen() {
  const storage = useMyStorage();
  const colors = useColors();
  const [cache, setCache] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  const measure = useCallback(() => {
    setTimeout(() => setCache(cacheBytes()), 0);
  }, []);
  useEffect(measure, [measure]);

  const s = storage.data;
  const bar = s ? storageBar(s) : null;
  const err = storage.error ? edge.fromError(storage.error) : null;

  return (
    <Screen scroll header={{ title: 'Storage', back: true }}>
      {storage.isLoading ? (
        <View className="mt-4 gap-3">
          <Skeleton width={180} height={44} />
          <Skeleton height={14} radius={7} />
          <Skeleton height={20} />
          <Skeleton height={20} />
          <Text variant="caption">Calculating sizes…</Text>
        </View>
      ) : err ? (
        <View className="mt-4">
          <EdgeState
            icon={err.icon}
            tone={err.tone}
            title={err.title}
            body={err.body}
            primary={{ label: 'Try again', onPress: () => void storage.refetch() }}
            primaryVariant="strong"
          />
        </View>
      ) : s && bar ? (
        <View className="mt-2">
          <View className="flex-row flex-wrap items-baseline gap-x-2">
            <Text variant="display" heading className="text-[40px]">
              {formatBytes(s.used_bytes)}
            </Text>
            <Text variant="body">{planLine(s.limit_bytes)}</Text>
          </View>

          <View
            className="mt-3 h-3 flex-row overflow-hidden rounded-pill bg-ink/10 dark:bg-ink-dark/15"
            accessibilityRole="progressbar"
            accessibilityLabel={`${formatBytes(s.used_bytes)} used`}
          >
            {bar.segments.map((seg) => (
              <View
                key={seg.key}
                style={{ width: `${Math.max(seg.fraction * 100, 1)}%`, backgroundColor: seg.color }}
              />
            ))}
          </View>

          <View className="mt-4 gap-2.5">
            {bar.segments.length === 0 ? (
              <Text variant="body">
                Nothing uploaded yet. Your photos will show up here by Crew.
              </Text>
            ) : (
              bar.segments.map((seg) => (
                <View key={seg.key} className="flex-row items-center gap-3">
                  <View
                    className="h-3.5 w-3.5 rounded-[4px]"
                    style={{ backgroundColor: seg.color }}
                  />
                  <Text variant="body" tone="default" className="flex-1" numberOfLines={1}>
                    {seg.label}
                  </Text>
                  <Text variant="stamp" tone="default" className="text-[13px]">
                    {formatBytes(seg.bytes)}
                  </Text>
                </View>
              ))
            )}
          </View>

          {bar.nearLimit ? (
            <View className="mt-4 flex-row gap-3 rounded-card bg-tint-peach p-4 dark:bg-tint-peach-dark">
              <Icon name="alert" size={20} color={colors.ink} />
              <Text variant="body" tone="default" className="flex-1">
                {bar.full
                  ? 'Your storage is full. New uploads wait safely on your phone until there is room.'
                  : 'You are close to your limit. Uploads will wait on your phone when it is full.'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View className="mt-6 rounded-card bg-flash p-5">
        <Text variant="title" heading tone="onFlash" className="text-[22px] leading-[25px]">
          Free up space on this phone
        </Text>
        <Text variant="body" tone="onFlash" className="mt-2">
          Photos you shoot in Dumpr are safe in your Rolls. Clear the finished upload records here;
          you can delete your phone's own copies from your gallery whenever you like.
        </Text>
        <View className="mt-4">
          <Button
            label="Clear upload cache"
            variant="strong"
            size="lg"
            onPress={() => {
              clearFinishedUploads();
              toast.show({ message: 'Upload cache cleared' });
            }}
          />
        </View>
      </View>

      <View className="mt-5">
        <SettingsGroup>
          <SettingsRow
            title="Cache"
            subtitle="Previews and temporary files"
            trailing={
              <View className="flex-row items-center gap-3">
                <Text variant="stamp" tone="tertiary" className="text-[13px]">
                  {cacheLabel(cache)}
                </Text>
                <Button
                  label="Clear"
                  variant="secondary"
                  size="sm"
                  loading={clearing}
                  onPress={async () => {
                    setClearing(true);
                    await clearCache();
                    setClearing(false);
                    measure();
                    toast.show({ message: 'Cache cleared' });
                  }}
                />
              </View>
            }
          />
          <SettingsRow
            divider
            title="Upload quality"
            subtitle="Original keeps every pixel. Other options are coming."
            trailing={
              <Text variant="body" tone="default" className="font-body-semibold">
                Original
              </Text>
            }
          />
        </SettingsGroup>
      </View>

      <Text variant="body" className="mt-5">
        Rolls stay as long as any member is still in them. You'll get 30 days' notice and a download
        link before anything is removed.
      </Text>

      <View className="mt-5 gap-2">
        <Button
          label="Get more space"
          variant="secondary"
          size="lg"
          disabled
          disabledReason="Plans coming soon"
          onPress={() => router.back()}
        />
      </View>
    </Screen>
  );
}

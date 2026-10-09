import { FlashList } from '@shopify/flash-list';
import { useQueries } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { rpc } from '@/data/rpc';
import { rollHeaderKey } from '@/data/useDestinations';
import type { RollHeaderLite } from '@/data/types-cf';
import {
  isCancellable,
  revealBody,
  revealEyebrow,
  sortQueue,
  statusLine,
} from '@/features/import/queueCopy';
import {
  cancelUpload,
  clearFinishedUploads,
  retryAllFailed,
  retryUpload,
  setPaused,
  setWifiOnly,
  useUploadQueue,
  type UploadItemView,
} from '@/features/uploads';
import { formatBytes, formatCountdown } from '@/lib/format';
import {
  Button,
  EdgeState,
  Glyph,
  Icon,
  IconButton,
  PressableScale,
  Screen,
  Text,
  ToggleSwitch,
  useColors,
} from '@/ui';

/**
 * C4 Uploads & reveal: per-item progress, total size, Wi-Fi only, pause / resume, retry failed.
 * Sealed Rolls show the stamp countdown card. Failures keep the photo on the phone and say why.
 */
export default function UploadsScreen() {
  const queue = useUploadQueue();
  const colors = useColors();
  const { summary } = queue;
  const [now, setNow] = useState(Date.now());

  const rollIds = useMemo(
    () => [...new Set(queue.items.filter((i) => i.state !== 'cancelled').map((i) => i.rollId))],
    [queue.items],
  );
  const headers = useQueries({
    queries: rollIds.map((id) => ({
      queryKey: rollHeaderKey(id),
      queryFn: () => rpc<RollHeaderLite>('roll_header', { p_roll_id: id }),
      staleTime: 60_000,
    })),
  });
  const sealed = headers
    .map((q) => q.data)
    .find((h) => h?.sealed && h.roll.reveal_at && Date.parse(h.roll.reveal_at) > Date.now());

  const hasTimers = !!sealed || queue.items.some((i) => i.state === 'failed' && i.retryAt != null);
  useEffect(() => {
    if (!hasTimers) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasTimers]);

  const rows = useMemo(() => sortQueue(queue.items), [queue.items]);
  const storageFull = queue.items.some((i) => i.errorCode === 'storage_full');
  const finished = summary.counts.done + summary.counts.duplicate + summary.counts.cancelled;
  const empty = rows.length === 0;
  const failed = summary.failed;
  const sealedCount = sealed
    ? queue.items.filter((i) => i.rollId === sealed.roll.id && i.state !== 'cancelled').length
    : 0;

  const footer = empty ? undefined : (
    <View className="flex-row items-center gap-3">
      <View className="flex-1">
        <Button
          label={queue.paused ? 'Resume all' : 'Pause all'}
          variant={queue.paused && failed === 0 ? 'primary' : 'secondary'}
          size="lg"
          onPress={() => setPaused(!queue.paused)}
        />
      </View>
      {failed > 0 ? (
        <View className="flex-1">
          <Button
            label={`Retry failed (${failed})`}
            variant="primary"
            size="lg"
            onPress={retryAllFailed}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen
      header={{ title: 'Uploads', back: true }}
      padded={false}
      footer={<View className="px-4">{footer}</View>}
    >
      <FlashList
        data={rows}
        keyExtractor={(i) => i.id}
        extraData={now}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ListHeaderComponent={
          <View className="gap-4 pb-2 pt-1">
            {sealed?.roll.reveal_at ? (
              <View className="rounded-card bg-ink p-5" accessibilityRole="summary">
                <Text
                  variant="stamp"
                  tone="shutter"
                  className="text-[11px]"
                  style={{ color: '#FF8A3D' }}
                >
                  {revealEyebrow(sealed.roll.name, sealed.roll.reveal_mode)}
                </Text>
                <Text
                  variant="stamp"
                  tone="flash"
                  className="mt-1 text-[44px] leading-[48px] tracking-[1px]"
                  accessibilityLabel={`Reveal in ${formatCountdown(Date.parse(sealed.roll.reveal_at) - now)}`}
                >
                  {formatCountdown(Date.parse(sealed.roll.reveal_at) - now)}
                </Text>
                <Text variant="body" tone="inverse" className="mt-2 opacity-80">
                  {revealBody(sealedCount, sealed.roll.reveal_at)}
                </Text>
              </View>
            ) : null}

            {storageFull ? (
              <EdgeState
                icon="alert"
                tone="peach"
                title="Your storage is full"
                body="Uploads wait safely on your phone. Free up space or get more to carry on."
                primary={{ label: 'Open Storage', onPress: () => router.push('/you/storage') }}
                primaryVariant="strong"
              />
            ) : null}

            {!empty ? (
              <View>
                <View className="flex-row items-end justify-between">
                  <Text variant="heading" tone="default">
                    {summary.uploaded} of {summary.total} uploaded
                  </Text>
                  <Text variant="stamp" tone="tertiary" className="text-[12px]">
                    {formatBytes(summary.doneBytes)} / {formatBytes(summary.totalBytes)}
                  </Text>
                </View>
                <View
                  className="mt-2 h-2 overflow-hidden rounded-pill bg-ink/10 dark:bg-ink-dark/15"
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(summary.fraction * 100) }}
                >
                  <View
                    className="h-2 rounded-pill bg-ink dark:bg-ink-dark"
                    style={{ width: `${Math.round(summary.fraction * 100)}%` }}
                  />
                </View>
              </View>
            ) : null}

            <View className="min-h-[48px] flex-row items-center justify-between">
              <View className="flex-1 flex-row items-center gap-2 pr-3">
                <Glyph name="wifi" size={18} color={colors.ink2} />
                <Text variant="body" tone="default">
                  Upload on Wi-Fi only
                </Text>
              </View>
              <ToggleSwitch
                label="Upload on Wi-Fi only"
                value={queue.wifiOnly}
                onValueChange={setWifiOnly}
              />
            </View>
            {queue.paused ? (
              <Text variant="caption" accessibilityLiveRegion="polite">
                Uploads are paused. Everything is saved on your phone.
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View className="mt-8">
            <EdgeState
              layout="screen"
              icon="check"
              tone="mint"
              title="All caught up"
              body="Nothing is waiting to upload. New shots and imports show up here while they go."
              primary={{ label: 'Open the camera', onPress: () => router.push('/camera') }}
              primaryVariant="strong"
            />
          </View>
        }
        ListFooterComponent={
          finished > 0 && !empty ? (
            <View className="items-center pt-2">
              <Button
                label="Clear finished"
                variant="tertiary"
                size="sm"
                onPress={clearFinishedUploads}
              />
            </View>
          ) : null
        }
        renderItem={({ item }) => <UploadRow item={item} now={now} />}
      />
    </Screen>
  );
}

function UploadRow({ item, now }: { item: UploadItemView; now: number }) {
  const colors = useColors();
  const line = statusLine(item, now);
  const uploading = item.state === 'uploading';
  const failed = item.state === 'failed' || item.state === 'blocked';
  const done = item.state === 'done';
  return (
    <View className="min-h-[68px] flex-row items-center gap-3 border-b border-line py-2.5 dark:border-line-dark">
      <View className="h-12 w-12 overflow-hidden rounded-[10px] bg-line dark:bg-line-dark">
        <Image
          source={{ uri: item.thumbUri ?? item.localUri }}
          contentFit="cover"
          style={{ width: 48, height: 48 }}
          accessibilityIgnoresInvertColors
        />
      </View>
      <View className="flex-1">
        <Text variant="body" tone="default" className="font-body-semibold" numberOfLines={1}>
          {item.fileName ?? 'Photo'}
          {item.bytes > 0 ? ` · ${formatBytes(item.bytes)}` : ''}
        </Text>
        {uploading ? (
          <View className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-ink/10 dark:bg-ink-dark/15">
            <View
              className="h-1.5 rounded-pill bg-ink dark:bg-ink-dark"
              style={{ width: `${Math.round(item.progress * 100)}%` }}
            />
          </View>
        ) : (
          <Text
            variant="caption"
            tone={
              line.tone === 'success' ? 'success' : line.tone === 'danger' ? 'shutter' : 'tertiary'
            }
            numberOfLines={2}
          >
            {line.text}
          </Text>
        )}
      </View>
      {uploading ? (
        <Text variant="caption" tone="default" className="w-10 text-right">
          {line.text}
        </Text>
      ) : failed && item.state === 'failed' ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Retry upload"
          onPress={() => retryUpload(item.id)}
          className="h-9 justify-center rounded-pill bg-tint-peach px-4 dark:bg-tint-peach-dark"
        >
          <Text variant="heading" tone="default" className="text-[14px]">
            Retry
          </Text>
        </PressableScale>
      ) : done ? (
        <Icon name="check" size={20} color={colors.ink === '#16141B' ? '#2F6B12' : '#D4FF3F'} />
      ) : isCancellable(item.state) ? (
        <IconButton
          icon="close"
          label="Cancel this upload"
          variant="ghost"
          size={36}
          onPress={() => cancelUpload(item.id)}
        />
      ) : null}
    </View>
  );
}

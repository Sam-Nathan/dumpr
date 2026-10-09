import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useSession } from '@/data/session';
import { useRollHeaderLite } from '@/data/useDestinations';
import { usePhotoLite } from '@/data/usePhotos';
import { supabase } from '@/lib/supabase';
import {
  cancelDownload,
  dismissFinishedDownload,
  hasSavePermission,
  pauseDownload,
  restoreDownloadJob,
  resumeDownload,
  startDownload,
  useDownloadStore,
} from '@/features/downloads/job';
import {
  albumName,
  checkSpace,
  defaultQuality,
  downloadLabel,
  estimateDownload,
  formatEta,
  progressFraction,
  type DownloadDescriptor,
  type DownloadQuality,
  type DownloadScope,
} from '@/features/downloads/plan';
import { formatBytes } from '@/lib/format';
import {
  Button,
  Chip,
  EdgeState,
  edge,
  goBack,
  Icon,
  PressableScale,
  SegmentedTabs,
  SheetContent,
  Skeleton,
  Text,
  ToggleSwitch,
  useColors,
} from '@/ui';

/**
 * F1 Download sheet. Params: `photoId` | `photoIds` (comma separated, with `scope=selected`) |
 * `rollId`. Saves to the phone gallery (an album per Roll); keeps going in the background and
 * resumes if the app is closed. ZIP is not part of the MVP.
 */
export default function DownloadSheet() {
  const params = useLocalSearchParams<{
    photoId?: string;
    photoIds?: string;
    rollId?: string;
    scope?: string;
  }>();
  const { user } = useSession();
  const colors = useColors();
  const job = useDownloadStore();

  const ids = useMemo(
    () => (params.photoIds ? params.photoIds.split(',').filter(Boolean) : []),
    [params.photoIds],
  );
  const photo = usePhotoLite(params.photoId);
  const rollId = params.rollId ?? photo.data?.roll_id ?? null;
  const header = useRollHeaderLite(rollId);

  const hasPhoto = !!params.photoId;
  const hasSelected = ids.length > 0;
  const [scope, setScope] = useState<DownloadScope>(
    params.scope === 'selected' && hasSelected ? 'selected' : hasPhoto ? 'photo' : 'roll',
  );
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [quality, setQuality] = useState<DownloadQuality>(defaultQuality(Platform.OS));
  const [wifiOnly, setWifiOnly] = useState(false);
  const [step, setStep] = useState<'choose' | 'primer' | 'denied'>('choose');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void restoreDownloadJob();
  }, []);

  const h = header.data;
  const downloadsOff = !!h && !h.roll.allow_downloads && !h.my.is_admin;
  const rollName = h?.roll.name ?? photo.data?.roll?.name ?? 'Photos';

  // The viewer's own photo count, for Rolls where the host turned downloads off.
  const mine = useQuery({
    queryKey: ['my-roll-count', rollId, user?.id],
    enabled: !!rollId && !!user && downloadsOff,
    queryFn: async () => {
      const { count } = await supabase
        .from('photos')
        .select('id', { count: 'exact', head: true })
        .eq('roll_id', rollId as string)
        .eq('uploader_id', user?.id as string)
        .eq('status', 'ready');
      return count ?? 0;
    },
  });

  const count =
    scope === 'photo'
      ? 1
      : scope === 'selected'
        ? ids.length
        : downloadsOff
          ? (mine.data ?? 0)
          : (h?.photo_count ?? 0);
  const photoBlocked = scope === 'photo' && downloadsOff && photo.data?.uploader_id !== user?.id;
  const estimate = estimateDownload({ count, quality });
  const free = (() => {
    try {
      return Paths.availableDiskSpace;
    } catch {
      return null;
    }
  })();
  const space = checkSpace({ bytes: estimate.bytes, freeBytes: free, count });
  const hasChapters = (h?.chapters.length ?? 0) > 0;

  const descriptor = (): DownloadDescriptor => ({
    id: Crypto.randomUUID().toLowerCase(),
    scope,
    rollId,
    rollName,
    photoIds: scope === 'photo' ? [params.photoId as string] : scope === 'selected' ? ids : [],
    chapterId: scope === 'roll' ? chapterId : null,
    onlyMine: downloadsOff,
    quality,
    wifiOnly,
  });

  const begin = async () => {
    setStarting(true);
    try {
      const perm = await hasSavePermission();
      if (perm === 'blocked') return setStep('denied');
      if (perm === 'undetermined' && step !== 'primer') return setStep('primer');
      void startDownload(descriptor(), user?.id ?? null);
      setStep('choose');
    } finally {
      setStarting(false);
    }
  };

  // ---------------------------------------------------------------- running / finished job
  if (job.status !== 'idle' && job.descriptor) {
    const pct = Math.round(progressFraction(job.done, job.total) * 100);
    const saved = Math.max(0, job.done - job.skipped);
    const finished = job.status === 'done';
    return (
      <SheetContent
        title={finished ? 'Saved to your gallery' : 'Downloading'}
        footer={
          finished ? (
            <Button
              label="Done"
              variant="primary"
              size="lg"
              onPress={() => {
                dismissFinishedDownload();
                goBack();
              }}
            />
          ) : (
            <View className="gap-1">
              {job.status === 'running' ? (
                <Button
                  label="Keep going in the background"
                  variant="primary"
                  size="lg"
                  onPress={goBack}
                />
              ) : (
                <Button
                  label="Resume"
                  variant="primary"
                  size="lg"
                  onPress={() => resumeDownload(user?.id ?? null)}
                />
              )}
              <View className="flex-row justify-center gap-2">
                {job.status === 'running' ? (
                  <Button label="Pause" variant="tertiary" onPress={pauseDownload} />
                ) : null}
                <Button
                  label="Cancel download"
                  variant="destructive"
                  onPress={() => {
                    cancelDownload();
                    goBack();
                  }}
                />
              </View>
            </View>
          )
        }
      >
        <Text variant="heading" tone="default">
          {job.descriptor.rollName}
        </Text>
        <Text variant="caption" className="mt-0.5">
          {albumName(Platform.OS, job.descriptor.rollName)}
        </Text>
        <View
          className="mt-4 h-3 overflow-hidden rounded-pill bg-ink/10 dark:bg-ink-dark/15"
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: pct }}
        >
          <View className="h-3 rounded-pill bg-flash" style={{ width: `${pct}%` }} />
        </View>
        <View className="mt-2 flex-row items-center justify-between">
          <Text variant="body" tone="default">
            {finished ? `${saved} saved` : `${job.done} of ${job.total}`}
          </Text>
          <Text variant="stamp" tone="tertiary" className="text-[12px]">
            {pct}%
          </Text>
        </View>
        {job.note ? (
          <Text variant="caption" className="mt-2" accessibilityLiveRegion="polite">
            {job.note}
          </Text>
        ) : null}
        {job.skipped > 0 ? (
          <Text variant="caption" className="mt-2">
            {job.skipped} {job.skipped === 1 ? 'photo' : 'photos'} could not be saved (taken down or
            not allowed to download).
          </Text>
        ) : null}
        {!finished ? (
          <Text variant="caption" className="mt-4">
            Keeps going in the background. If the app closes, it picks up where it stopped.
          </Text>
        ) : null}
      </SheetContent>
    );
  }

  // ---------------------------------------------------------------- permission steps
  if (step === 'denied') {
    const c = edge.permissionDenied('photos');
    return (
      <SheetContent title="Download">
        <EdgeState
          icon={c.icon}
          tone={c.tone}
          title="Dumpr can't save to your gallery"
          body="Allow photo access in Settings and we will save the album straight away."
          primary={{ label: 'Open Settings', onPress: () => void Linking.openSettings() }}
          secondary={{ label: 'Not now', onPress: goBack }}
        />
      </SheetContent>
    );
  }
  if (step === 'primer') {
    return (
      <SheetContent
        title="Save to your gallery"
        footer={
          <Button
            label="Allow saving"
            variant="primary"
            size="lg"
            loading={starting}
            onPress={() => void begin()}
          />
        }
      >
        <Text variant="body">Your phone will ask next. Here is exactly what that means.</Text>
        <View className="mt-4 gap-3">
          {[
            [
              'download',
              'Dumpr only adds photos to an album called “' +
                albumName(Platform.OS, rollName) +
                '”.',
            ],
            ['lock', 'It never reads the rest of your gallery for this.'],
            ['clock', 'You can stop the download any time.'],
          ].map(([icon, text]) => (
            <View key={text} className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-input bg-ink/[0.06] dark:bg-ink-dark/10">
                <Icon name={icon as 'download'} size={20} color={colors.ink} />
              </View>
              <Text variant="body" tone="secondary" className="flex-1">
                {text}
              </Text>
            </View>
          ))}
        </View>
        <View className="mt-2 items-center">
          <Button label="Not now" variant="tertiary" onPress={() => setStep('choose')} />
        </View>
      </SheetContent>
    );
  }

  // ---------------------------------------------------------------- choose
  const loading = (!!rollId && header.isLoading) || (hasPhoto && photo.isLoading);
  const error = header.error ?? photo.error;
  const disabledReason = photoBlocked
    ? 'The host turned downloads off for this Roll'
    : !space.fits
      ? 'Not enough space on this phone'
      : count === 0
        ? 'Nothing to download'
        : undefined;
  const canStart = !disabledReason && !loading;

  const Option = ({
    id,
    title,
    subtitle,
    children,
  }: {
    id: DownloadScope;
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
  }) => (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected: scope === id }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={() => setScope(id)}
      haptics={false}
      scaleTo={0.99}
      className={`mb-2 rounded-card border bg-surface p-4 dark:bg-surface-dark ${
        scope === id
          ? 'border-ink dark:border-ink-dark border-2'
          : 'border-line dark:border-line-dark'
      }`}
    >
      <View className="flex-row items-center gap-3">
        <View
          className={`h-7 w-7 items-center justify-center rounded-pill border-2 ${
            scope === id
              ? 'border-ink bg-ink dark:border-ink-dark dark:bg-ink-dark'
              : 'border-ink/25 dark:border-ink-dark/30'
          }`}
        >
          {scope === id ? <View className="h-3 w-3 rounded-pill bg-flash" /> : null}
        </View>
        <View className="flex-1">
          <Text variant="heading" tone="default">
            {title}
          </Text>
          {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
        </View>
      </View>
      {scope === id && children ? (
        <View className="mt-3 flex-row flex-wrap gap-2 pl-10">{children}</View>
      ) : null}
    </PressableScale>
  );

  return (
    <SheetContent
      title="Download"
      footer={
        <View>
          <Button
            label={downloadLabel(count)}
            variant="primary"
            size="lg"
            loading={starting}
            disabled={!canStart}
            disabledReason={disabledReason}
            onPress={() => void begin()}
          />
          <Text variant="caption" className="mt-2 text-center">
            Keeps going in the background. We'll tell you when it's done.
          </Text>
        </View>
      }
    >
      {loading ? (
        <View className="gap-3">
          <Skeleton height={56} radius={24} />
          <Skeleton height={56} radius={24} />
          <Skeleton height={80} radius={24} />
        </View>
      ) : error && !h && !hasPhoto ? (
        <EdgeState
          icon="alert"
          tone="sky"
          title="Can't load this Roll"
          body="Check your connection and try again."
          primary={{ label: 'Try again', onPress: () => void header.refetch() }}
        />
      ) : (
        <View>
          <Text variant="stamp" tone="tertiary" heading className="mb-2 text-[11px]">
            WHAT
          </Text>
          {hasPhoto ? <Option id="photo" title="This photo" /> : null}
          {hasSelected ? (
            <Option
              id="selected"
              title={`Selected · ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}`}
            />
          ) : null}
          {rollId ? (
            <Option
              id="roll"
              title={downloadsOff ? 'My photos in this Roll' : 'Whole Roll'}
              subtitle={`${rollName} · ${downloadsOff ? (mine.data ?? '…') : (h?.photo_count ?? '…')} photos`}
            >
              {hasChapters && !downloadsOff ? (
                <>
                  <Chip
                    label="All"
                    selected={chapterId === null}
                    onPress={() => setChapterId(null)}
                  />
                  {h?.chapters.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      selected={chapterId === c.id}
                      onPress={() => setChapterId(c.id)}
                    />
                  ))}
                </>
              ) : null}
            </Option>
          ) : null}

          {downloadsOff ? (
            <EdgeState
              icon="lock"
              tone="peach"
              title="Downloads are off for this Roll"
              body={`The host turned them off. You can still save the photos you added yourself.`}
            />
          ) : null}

          <Text variant="stamp" tone="tertiary" heading className="mb-2 mt-5 text-[11px]">
            QUALITY
          </Text>
          <SegmentedTabs
            value={quality}
            onChange={setQuality}
            options={[
              { value: 'original', label: 'Original' },
              { value: 'high', label: 'High · smaller JPG' },
            ]}
          />

          <Text variant="stamp" tone="tertiary" heading className="mb-2 mt-5 text-[11px]">
            SAVE TO
          </Text>
          <View className="rounded-card border-2 border-ink bg-surface p-4 dark:border-ink-dark dark:bg-surface-dark">
            <Text variant="heading" tone="default">
              Phone gallery
            </Text>
            <Text variant="caption">New album “{albumName(Platform.OS, rollName)}”</Text>
          </View>

          <View className="mt-4 flex-row items-center justify-between rounded-input bg-ink/[0.06] px-4 py-3 dark:bg-ink-dark/10">
            <Text variant="stamp" tone="default" className="flex-shrink pr-2 text-[12px]">
              ≈ {formatBytes(estimate.bytes)} · ~{formatEta(estimate.seconds)} on Wi-Fi
            </Text>
            {free != null ? (
              <Text variant="caption" tone="default">
                Free: {formatBytes(free)}
              </Text>
            ) : null}
          </View>

          {!space.fits ? (
            <View className="mt-3">
              <EdgeState
                icon="download"
                tone="peach"
                title="Not enough space for all of it"
                body={
                  space.highWouldFit && quality === 'original'
                    ? 'Switch to High quality, or download in parts.'
                    : hasChapters
                      ? 'Download one Chapter at a time to fit.'
                      : 'Free up some space on your phone, or download fewer photos at once.'
                }
                primary={
                  space.highWouldFit && quality === 'original'
                    ? { label: 'Use High quality', onPress: () => setQuality('high') }
                    : undefined
                }
                primaryVariant="strong"
              />
            </View>
          ) : null}

          <View className="mt-4 min-h-[48px] flex-row items-center justify-between">
            <Text variant="body" tone="default">
              Wi-Fi only
            </Text>
            <ToggleSwitch
              label="Download on Wi-Fi only"
              value={wifiOnly}
              onValueChange={setWifiOnly}
            />
          </View>
        </View>
      )}
    </SheetContent>
  );
}

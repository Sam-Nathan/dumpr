import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useProfile } from '@/data/profile';
import { useSession } from '@/data/session';
import { useMyProfileStats, useMyStorage } from '@/data/useStorage';
import { signOut } from '@/features/auth/phone';
import { DownloadsModal } from '@/features/downloads/DownloadsModal';
import { restoreDownloadJob, useDownloadStore } from '@/features/downloads/job';
import { jobStatusLine } from '@/features/downloads/plan';
import { formatBytes, formatCount } from '@/lib/format';
import {
  Avatar,
  Button,
  confirmDialog,
  PressableScale,
  Screen,
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  Skeleton,
  Text,
} from '@/ui';

type Tile = {
  key: string;
  title: string;
  caption: string;
  bg: string;
  soon?: boolean;
  dashed?: boolean;
  onPress?: () => void;
};

/**
 * F5 You: profile header, stats strip, tiles (only Downloads is live; the rest say "Coming soon"),
 * Privacy & safety, Storage, Sign out.
 */
export default function You() {
  const profile = useProfile();
  const stats = useMyProfileStats();
  const storage = useMyStorage();
  const { isGuest } = useSession();
  const job = useDownloadStore();
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const p = profile.data;

  useEffect(() => {
    void restoreDownloadJob();
  }, []);

  const downloadsCaption =
    job.status === 'idle' || !job.descriptor
      ? 'Nothing running'
      : jobStatusLine(job.status, job.done, job.total);

  const tiles: Tile[] = [
    {
      key: 'passport',
      title: 'Passport',
      caption: 'Coming soon',
      bg: 'bg-tint-lime dark:bg-tint-lime-dark',
      soon: true,
    },
    {
      key: 'stickers',
      title: 'My Stickers',
      caption: 'Coming soon',
      bg: 'bg-tint-pink dark:bg-tint-pink-dark',
      soon: true,
    },
    {
      key: 'photos-of-me',
      title: 'Photos of me',
      caption: 'Coming soon',
      bg: 'bg-surface dark:bg-surface-dark',
      soon: true,
      dashed: true,
    },
    {
      key: 'capsules',
      title: 'Time Capsules',
      caption: 'Coming soon',
      bg: 'bg-tint-sky dark:bg-tint-sky-dark',
      soon: true,
    },
    {
      key: 'downloads',
      title: 'Downloads',
      caption: downloadsCaption,
      bg: 'bg-tint-peach dark:bg-tint-peach-dark',
      onPress: () => setDownloadsOpen(true),
    },
    {
      key: 'widgets',
      title: 'Widgets',
      caption: 'Coming soon',
      bg: 'bg-tint-lilac dark:bg-tint-lilac-dark',
      soon: true,
    },
  ];

  const rows: { label: string; href: string; value?: string }[] = [
    { label: 'Uploads', href: '/uploads' },
  ];
  if (__DEV__)
    rows.push(
      { label: 'UI kit (dev)', href: '/dev/kit' },
      { label: 'Edge states (dev)', href: '/dev/edge-states' },
    );

  return (
    <Screen scroll header={{ back: true }}>
      <View className="mt-1 flex-row items-center gap-4">
        <Avatar
          name={p?.display_name ?? ''}
          avatarKey={p?.avatar_key}
          ring={p?.ring_color ?? 'lime'}
          size={80}
        />
        <View className="flex-1">
          <Text variant="title" heading numberOfLines={2}>
            {p?.display_name ?? ' '}
          </Text>
          {p?.handle ? (
            <Text variant="body" numberOfLines={1}>
              @{p.handle}
            </Text>
          ) : isGuest ? (
            <Text variant="body">Guest</Text>
          ) : null}
        </View>
        {!isGuest ? (
          <Button
            label="Edit"
            variant="secondary"
            size="sm"
            onPress={() => router.push('/you/edit')}
          />
        ) : null}
      </View>

      <View className="mt-4 min-h-[18px]">
        {stats.data ? (
          <Text
            variant="stamp"
            tone="secondary"
            className="text-[12px]"
            accessibilityLabel={`${stats.data.rolls} Rolls, ${stats.data.crews} Crews, ${stats.data.photos} photos`}
          >
            {formatCount(stats.data.rolls)} {stats.data.rolls === 1 ? 'ROLL' : 'ROLLS'} ·{' '}
            {formatCount(stats.data.crews)} {stats.data.crews === 1 ? 'CREW' : 'CREWS'} ·{' '}
            {formatCount(stats.data.photos)} {stats.data.photos === 1 ? 'PHOTO' : 'PHOTOS'}
          </Text>
        ) : stats.isLoading ? (
          <Skeleton width={230} height={14} />
        ) : null}
      </View>

      <View
        className="mt-3 flex-row items-center justify-between rounded-card bg-ink px-5 py-4"
        accessibilityLabel="Dumpr Wrapped 2026, coming in December"
      >
        <View className="flex-1 pr-3">
          <Text variant="stamp" tone="flash" className="text-[11px]">
            DUMPR WRAPPED · 2026
          </Text>
          <Text variant="heading" tone="inverse" className="mt-0.5">
            Coming this December
          </Text>
        </View>
        <Text variant="stamp" className="text-[20px]" style={{ color: '#FF8A3D' }}>
          DEC
        </Text>
      </View>

      <View className="mt-3 flex-row flex-wrap justify-between gap-y-3">
        {tiles.map((t) => (
          <PressableScale
            key={t.key}
            accessibilityRole={t.onPress ? 'button' : 'text'}
            accessibilityLabel={`${t.title}. ${t.caption}`}
            accessibilityState={{ disabled: !!t.soon }}
            disabled={!t.onPress}
            onPress={t.onPress}
            haptics={false}
            wrapperStyle={{ width: '48.5%', minHeight: 0 }}
            className={`min-h-[96px] justify-between rounded-card p-4 ${t.bg} ${t.soon ? 'opacity-60' : ''} ${
              t.dashed ? 'border border-dashed border-ink/30 dark:border-ink-dark/30' : ''
            }`}
          >
            <Text variant="heading" tone="default">
              {t.title}
            </Text>
            <Text variant="caption" tone="secondary" className="mt-3">
              {t.caption}
            </Text>
          </PressableScale>
        ))}
      </View>

      <SectionLabel>SETTINGS</SectionLabel>
      <SettingsGroup>
        <SettingsRow title="Privacy & safety" chevron onPress={() => router.push('/you/privacy')} />
        <SettingsRow
          divider
          title="Storage"
          chevron
          onPress={() => router.push('/you/storage')}
          trailing={
            storage.data ? (
              <Text variant="stamp" tone="tertiary" className="text-[13px]">
                {formatBytes(storage.data.used_bytes)}
              </Text>
            ) : undefined
          }
        />
        {rows.map((r) => (
          <SettingsRow
            key={r.href}
            divider
            title={r.label}
            chevron
            onPress={() => router.push(r.href)}
          />
        ))}
      </SettingsGroup>

      <View className="mt-8 items-center">
        <Button
          label="Sign out"
          variant="destructive"
          onPress={async () => {
            // Dialogs are for irreversible actions only: a guest cannot sign back in to this account.
            if (isGuest) {
              const ok = await confirmDialog({
                title: 'Sign out of this guest account?',
                body: "Guests can't sign back in, so you'll lose access to this account. Photos you added stay in the Roll.",
                confirmLabel: 'Sign out',
              });
              if (!ok) return;
            }
            await signOut();
          }}
        />
      </View>

      <DownloadsModal visible={downloadsOpen} onClose={() => setDownloadsOpen(false)} />
    </Screen>
  );
}

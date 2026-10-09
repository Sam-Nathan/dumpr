import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { rpc } from '@/data/rpc';
import { useSession } from '@/data/session';
import { useRollHeaderLite } from '@/data/useDestinations';
import {
  photoLiteKey,
  removePhoto,
  reportPhoto,
  requestPhotoRemoval,
  useMyRemovalRequest,
  usePhotoAudience,
  usePhotoLite,
  useSetVisibility,
  type Visibility,
} from '@/data/usePhotos';
import type { CrewOverviewLite } from '@/data/types-cf';
import { friendlyMessage } from '@/lib/errors';
import {
  Avatar,
  BottomModal,
  Button,
  Chip,
  confirmDialog,
  EdgeState,
  edge,
  Facepile,
  goBack,
  Icon,
  PressableScale,
  SettingsGroup,
  SettingsRow,
  SheetContent,
  Skeleton,
  Text,
  toast,
} from '@/ui';

const REPORT_REASONS = ['Not appropriate', 'Harassment or bullying', 'Spam', 'Something else'];

/**
 * F2 Photo privacy & report (sheet from the viewer's ⋯). Own photos: visibility (Everyone in the
 * Roll · Ghost: people I pick · Only me). Someone else's: ask to remove, report. Delete for the
 * owner and Roll hosts. Lore tags and Hype Notes arrive in a later phase and are not shown.
 */
export default function PhotoActionsSheet() {
  const { photoId } = useLocalSearchParams<{ photoId?: string }>();
  const { user } = useSession();
  const qc = useQueryClient();
  const photo = usePhotoLite(photoId);
  const p = photo.data;
  const mineP = !!p && p.uploader_id === user?.id;
  const header = useRollHeaderLite(p?.roll_id);
  const isAdmin = !!header.data?.my.is_admin;

  const crew = useQuery({
    queryKey: ['crew', p?.crew_id ?? ''],
    enabled: !!p && mineP,
    queryFn: () => rpc<CrewOverviewLite>('crew_overview', { p_crew_id: p?.crew_id }),
  });
  const audience = usePhotoAudience(photoId, mineP && p?.visibility === 'selected');
  const sent = useMyRemovalRequest(photoId, !!p && !mineP);
  const setVis = useSetVisibility(photoId ?? '');

  const [vis, setVisState] = useState<Visibility>('everyone');
  const [picked, setPicked] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (p) setVisState(p.visibility);
  }, [p?.visibility]);
  useEffect(() => {
    if (audience.data) setPicked(audience.data);
  }, [audience.data]);

  const members = useMemo(
    () => (crew.data?.members ?? []).filter((m) => m.user_id !== user?.id),
    [crew.data, user?.id],
  );
  const pickedPeople = members.filter((m) => picked.includes(m.user_id));

  const changed =
    !!p &&
    (vis !== p.visibility ||
      (vis === 'selected' &&
        (picked.length !== (audience.data ?? []).length ||
          picked.some((x) => !(audience.data ?? []).includes(x)))));
  const needsPeople = vis === 'selected' && picked.length === 0;
  const rollName = p?.roll?.name ?? 'this Roll';

  const saveVisibility = async () => {
    try {
      await setVis.mutateAsync({ visibility: vis, audience: picked });
      toast.show({ message: 'Saved' });
      goBack();
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    }
  };

  const askRemoval = async () => {
    setBusy('remove');
    try {
      await requestPhotoRemoval(photoId as string);
      setRequested(true);
      void sent.refetch();
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const report = async (reason: string) => {
    setReportOpen(false);
    try {
      await reportPhoto(photoId as string, reason);
      toast.show({ message: 'Reported. The hosts will take a look.' });
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    }
  };

  const del = async () => {
    const ok = await confirmDialog({
      title: 'Delete this photo?',
      body: mineP
        ? `It leaves ${rollName} for everyone. This can't be undone.`
        : `It leaves ${rollName} for everyone and ${p?.uploader?.display_name ?? 'the person who added it'} is told. This can't be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await removePhoto(photoId as string, mineP ? 'deleted by owner' : 'removed by host');
      void qc.invalidateQueries({ queryKey: ['roll-photos'] });
      void qc.invalidateQueries({ queryKey: ['roll-header'] });
      void qc.invalidateQueries({ queryKey: photoLiteKey(photoId as string) });
      void qc.invalidateQueries({ queryKey: ['photo', photoId] });
      toast.show({ message: 'Photo deleted' });
      goBack();
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    }
  };

  if (photo.isLoading) {
    return (
      <SheetContent title="Photo options">
        <View className="gap-3">
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </View>
      </SheetContent>
    );
  }
  if (photo.isError || !p) {
    const c = edge.fromError(photo.error);
    return (
      <SheetContent title="Photo options">
        <EdgeState
          icon={c.icon}
          tone={c.tone}
          title={c.title}
          body={c.body}
          primary={{ label: 'Try again', onPress: () => void photo.refetch() }}
          secondary={{ label: 'Close', onPress: goBack }}
        />
      </SheetContent>
    );
  }

  const Radio = ({
    value,
    title,
    children,
  }: {
    value: Visibility;
    title: string;
    children?: React.ReactNode;
  }) => (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected: vis === value }}
      accessibilityLabel={title}
      onPress={() => setVisState(value)}
      haptics={false}
      scaleTo={0.99}
      className="py-2.5"
    >
      <View className="flex-row items-center gap-3">
        <View
          className={`h-7 w-7 items-center justify-center rounded-pill border-2 ${
            vis === value
              ? 'border-ink bg-ink dark:border-ink-dark dark:bg-ink-dark'
              : 'border-ink/25 dark:border-ink-dark/30'
          }`}
        >
          {vis === value ? <View className="h-3 w-3 rounded-pill bg-flash" /> : null}
        </View>
        <Text variant="heading" tone="default" className="flex-1">
          {title}
        </Text>
      </View>
      {vis === value && children ? <View className="pl-10 pt-2">{children}</View> : null}
    </PressableScale>
  );

  const canDelete = mineP || isAdmin;
  const requestSent = requested || !!sent.data;

  return (
    <SheetContent
      title={mineP ? 'Who sees this photo' : 'Photo options'}
      footer={
        mineP ? (
          <Button
            label="Save visibility"
            variant="primary"
            size="lg"
            loading={setVis.isPending}
            disabled={!changed || needsPeople}
            disabledReason={needsPeople ? 'Pick at least one person' : 'Change who sees it to save'}
            onPress={() => void saveVisibility()}
          />
        ) : undefined
      }
    >
      {mineP ? (
        <View>
          <Radio value="everyone" title={`Everyone in ${rollName}`} />
          <Radio value="selected" title="Ghost Mode — only people I pick">
            <View className="flex-row items-center gap-2">
              {pickedPeople.length > 0 ? (
                <Facepile
                  people={pickedPeople.map((m) => ({
                    name: m.display_name,
                    avatarKey: m.avatar_key,
                    ring: m.ring_color,
                  }))}
                  size={28}
                />
              ) : null}
              <Text variant="caption" tone="default">
                {picked.length} {picked.length === 1 ? 'person' : 'people'} ·
              </Text>
              <Text
                variant="caption"
                tone="default"
                className="font-body-bold underline"
                accessibilityRole="button"
                onPress={() => setPickerOpen(true)}
              >
                {picked.length ? 'Edit' : 'Choose'}
              </Text>
            </View>
            <Text variant="caption" className="mt-2">
              Hidden from the grid, downloads and recaps for everyone else. Screenshots can't be
              blocked.
            </Text>
          </Radio>
          <Radio value="only_me" title="Only me" />
        </View>
      ) : (
        <Text variant="body">
          {p.uploader?.display_name ?? 'Someone'} added this photo to {rollName}.
        </Text>
      )}

      <View className="mt-4">
        <SettingsGroup>
          {!mineP ? (
            <SettingsRow
              title="I'm in this — ask to remove"
              subtitle={
                requestSent
                  ? undefined
                  : `Sends your request to ${p.uploader?.display_name ?? 'them'}`
              }
              onPress={requestSent || busy ? undefined : () => void askRemoval()}
              trailing={
                requestSent ? (
                  <Chip label={`Sent to ${p.uploader?.display_name ?? 'them'}`} tone="lime" />
                ) : undefined
              }
            />
          ) : null}
          {!mineP ? (
            <SettingsRow
              divider
              title="Report photo"
              destructive
              onPress={() => setReportOpen(true)}
            />
          ) : null}
          {canDelete ? (
            <SettingsRow
              divider={!mineP}
              title={mineP ? 'Delete photo' : 'Remove photo'}
              destructive
              onPress={() => void del()}
              trailing={<Text variant="caption">{mineP ? 'Only you and hosts' : 'Host'}</Text>}
            />
          ) : null}
        </SettingsGroup>
      </View>

      <BottomModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Who can see it?"
        footer={
          <Button label="Done" variant="strong" size="lg" onPress={() => setPickerOpen(false)} />
        }
      >
        {crew.isLoading ? (
          <Skeleton height={48} />
        ) : members.length === 0 ? (
          <Text variant="body">There is nobody else in this Crew yet.</Text>
        ) : (
          members.map((m) => {
            const on = picked.includes(m.user_id);
            return (
              <PressableScale
                key={m.user_id}
                accessibilityRole="checkbox"
                accessibilityLabel={m.display_name}
                accessibilityState={{ checked: on }}
                onPress={() =>
                  setPicked((cur) =>
                    on ? cur.filter((x) => x !== m.user_id) : [...cur, m.user_id],
                  )
                }
                haptics={false}
                scaleTo={0.99}
                className="min-h-[56px] flex-row items-center gap-3"
              >
                <Avatar
                  name={m.display_name}
                  avatarKey={m.avatar_key}
                  ring={m.ring_color}
                  size={40}
                />
                <Text variant="body" tone="default" className="flex-1 font-body-semibold">
                  {m.display_name}
                </Text>
                <View
                  className={`h-6 w-6 items-center justify-center rounded-pill border-2 ${
                    on ? 'border-flash bg-flash' : 'border-ink/25 dark:border-ink-dark/30'
                  }`}
                >
                  {on ? <Icon name="check" size={14} color="#16141B" strokeWidth={3} /> : null}
                </View>
              </PressableScale>
            );
          })
        )}
      </BottomModal>

      <BottomModal
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report this photo"
      >
        <Text variant="body" className="mb-3">
          Tell the hosts what is wrong. They decide what happens next.
        </Text>
        <View className="gap-2 pb-2">
          {REPORT_REASONS.map((r) => (
            <Button
              key={r}
              label={r}
              variant="secondary"
              size="lg"
              onPress={() => void report(r)}
            />
          ))}
        </View>
      </BottomModal>
    </SheetContent>
  );
}

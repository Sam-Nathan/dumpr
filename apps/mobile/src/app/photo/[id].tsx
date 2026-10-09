import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Linking,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/data/session';
import { REACTIONS, type ReactionKind } from '@/data/types';
import type { GridPhoto } from '@/data/types-b';
import {
  patchCachedCaption,
  updateCaption,
  usePhotoDetail,
  useReactionMutations,
  useReactions,
  useUploaderProfile,
} from '@/data/usePhoto';
import { useFlatPhotos, useRollHeader, useRollPhotos, useRollRealtime } from '@/data/useRoll';
import { flattenSections, groupIntoSections, sectionModeFor } from '@/features/rolls/grid';
import {
  captionParts,
  isRemovedRow,
  withTombstones,
  type ViewerRow,
} from '@/features/viewer/helpers';
import {
  canSaveToGallery,
  requestSavePermission,
  savePhotoToGallery,
  sharePhotoFile,
} from '@/features/viewer/save';
import { SavePrimer } from '@/features/viewer/SavePrimer';
import { PhotoPage, RemovedPage, ViewerSkeleton } from '@/features/viewer/ViewerPage';
import { errorCopy, friendlyMessage, toAppError } from '@/lib/errors';
import {
  Avatar,
  Button,
  EdgeState,
  edge,
  goBack,
  haptic,
  Icon,
  IconButton,
  ModalSheet,
  PressableScale,
  ReactionChip,
  Stamp,
  Text,
  toast,
  type IconName,
} from '@/ui';

type Row = GridPhoto | ViewerRow;
const isPhoto = (r: Row): r is GridPhoto => 'uploader_id' in r;

function BarButton({
  icon,
  label,
  onPress,
  dim,
  busy,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  dim?: boolean;
  busy?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!dim, busy: !!busy }}
      onPress={onPress}
      wrapperStyle={{ flex: 1, alignItems: 'center' }}
      className={dim || busy ? 'items-center opacity-50' : 'items-center'}
    >
      <Icon name={icon} size={24} color="#F4F3F6" />
      <Text variant="caption" tone="inverse" className="mt-1 text-[12px]">
        {label}
      </Text>
    </PressableScale>
  );
}

/** B4 Photo viewer: black, full-bleed pager over the Roll's cached grid. */
export default function PhotoViewer() {
  const {
    id,
    rollId: rollParam,
    chapterId,
  } = useLocalSearchParams<{
    id: string;
    rollId?: string;
    chapterId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const { user, isGuest } = useSession();
  const detail = usePhotoDetail(id);
  const rollId = rollParam || detail.data?.roll_id || undefined;
  const filter = chapterId || null;
  const header = useRollHeader(rollId);
  const photosQ = useRollPhotos(rollId, filter);
  const flat = useFlatPhotos(photosQ.data);
  useRollRealtime(rollId);

  const chapters = header.data?.chapters ?? [];
  const ordered = useMemo(
    () => flattenSections(groupIntoSections(flat, chapters, sectionModeFor(chapters, filter))),
    [flat, chapters, filter],
  );

  // Rows keep a placeholder where a photo vanished, so "removed while viewing" never jumps the pager.
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    setRows((prev) => (prev.length ? withTombstones(prev, ordered) : ordered));
  }, [ordered]);

  // Deep link with no cached Roll list: fall back to the single photo.
  const single: Row[] = useMemo(() => (detail.data ? [detail.data] : []), [detail.data]);
  const list: Row[] =
    rows.length > 0 && rows.some((r) => r.id === id) ? rows : single.length ? single : rows;

  const listRef = useRef<FlatList<Row>>(null);
  const startIndex = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  if (startIndex.current === null && list.length > 0) {
    const i = list.findIndex((r) => r.id === id);
    startIndex.current = Math.max(0, i);
    setIndex(startIndex.current);
  }
  const current = list[Math.min(index, Math.max(0, list.length - 1))];
  const photo = current && isPhoto(current) ? current : null;
  const removedNow =
    !!current && (isRemovedRow(current) || (photo?.status as string) === 'removed');
  const mine = !!photo && photo.uploader_id === user?.id;
  const currentDetail = usePhotoDetail(photo?.id);
  const profile = useUploaderProfile(photo?.uploader_id);
  const reactions = useReactions(photo && !removedNow ? photo.id : undefined);
  const { react } = useReactionMutations(photo?.id ?? '');
  const hd = header.data;
  const chapterName = hd?.chapters.find((c) => c.id === photo?.chapter_id)?.name;
  const total = filter ? ordered.length : (hd?.photo_count ?? ordered.length);
  const downloadsOff = !!hd && !hd.roll.allow_downloads && !hd.my.is_admin && !mine;

  const [chrome, setChrome] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [primer, setPrimer] = useState<null | 'ask' | 'denied'>(null);
  const [busy, setBusy] = useState<null | 'save' | 'share'>(null);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(i);
    setEditing(false);
    if (i >= list.length - 5 && photosQ.hasNextPage && !photosQ.isFetchingNextPage) {
      void photosQ.fetchNextPage();
    }
  };

  const doSave = async () => {
    if (!photo) return;
    setBusy('save');
    try {
      const res = await savePhotoToGallery(
        photo.id,
        currentDetail.data?.mime ?? null,
        hd?.roll.name ?? 'Roll',
      );
      haptic.success();
      toast.show({ message: res.album ? `Saved to ${res.album}` : 'Saved to your gallery' });
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    if (!photo || busy) return;
    if (downloadsOff) {
      toast.show({ message: errorCopy('downloads_disabled').message });
      return;
    }
    if (await canSaveToGallery()) await doSave();
    else setPrimer('ask');
  };

  const allowSave = async () => {
    try {
      const r = await requestSavePermission();
      if (r.granted) {
        setPrimer(null);
        await doSave();
      } else setPrimer('denied');
    } catch {
      setPrimer('denied');
    }
  };

  const onShare = async () => {
    if (!photo || busy) return;
    if (downloadsOff) {
      toast.show({ message: errorCopy('downloads_disabled').message });
      return;
    }
    setBusy('share');
    try {
      await sharePhotoFile(photo.id);
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const doReact = async (kind: ReactionKind | null) => {
    if (isGuest) {
      toast.show({ message: errorCopy('guest_not_allowed').message });
      return;
    }
    haptic.select();
    try {
      await react(kind);
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    }
  };

  const saveCaption = async () => {
    if (!photo) return;
    const next = draft.trim() || null;
    setEditing(false);
    if (next === (photo.caption ?? null)) return;
    patchCachedCaption(qc, photo.id, next);
    try {
      await updateCaption(photo.id, next);
    } catch (e) {
      patchCachedCaption(qc, photo.id, photo.caption ?? null);
      toast.show({ message: friendlyMessage(e) });
    }
  };

  // Failure states
  const err = (detail.error && list.length === 0 ? toAppError(detail.error) : null) ?? null;
  if (
    err ||
    (!detail.isPending && detail.data === undefined && list.length === 0 && !photosQ.isPending)
  ) {
    const c = err ? edge.fromError(err) : edge.photoRemoved();
    return (
      <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
        <StatusBar style="light" />
        <View className="px-4 pt-2">
          <IconButton icon="back" label="Back" variant="onDark" onPress={goBack} />
        </View>
        <EdgeState
          layout="screen"
          icon={c.icon}
          tone="ink"
          title={err?.code === 'not_found' || !err ? 'This photo was removed' : c.title}
          body={
            err?.code === 'not_found' || !err
              ? 'It was taken down, or you no longer have access.'
              : c.body
          }
          primary={{ label: 'Go back', onPress: goBack }}
        />
      </View>
    );
  }
  if (list.length === 0) {
    return (
      <View className="flex-1 bg-black">
        <StatusBar style="light" />
        <ViewerSkeleton />
      </View>
    );
  }

  const counts = reactions.data?.counts ?? {};
  const mineReaction = reactions.data?.mine ?? null;
  const shownKinds = REACTIONS.filter((k) => (counts[k] ?? 0) > 0).sort(
    (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0),
  );
  const caption = photo?.caption ?? '';

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />
      <FlatList
        ref={listRef}
        data={list}
        keyExtractor={(r) => r.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={startIndex.current ?? 0}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        onMomentumScrollEnd={onScrollEnd}
        onEndReached={() => {
          if (photosQ.hasNextPage && !photosQ.isFetchingNextPage) void photosQ.fetchNextPage();
        }}
        onEndReachedThreshold={2}
        renderItem={({ item, index: i }) =>
          isPhoto(item) && item.status !== ('removed' as string) ? (
            <PhotoPage photo={item} onTap={() => setChrome((c) => !c)} />
          ) : (
            <RemovedPage
              onBack={goBack}
              onNext={() => {
                listRef.current?.scrollToIndex({
                  index: Math.min(i + 1, list.length - 1),
                  animated: true,
                });
                setIndex(Math.min(i + 1, list.length - 1));
              }}
              hasNext={i < list.length - 1}
            />
          )
        }
      />

      {chrome && !removedNow ? (
        <>
          <View
            className="absolute inset-x-0 top-0 flex-row items-center gap-3 px-4 pb-3"
            style={{ paddingTop: insets.top + 8, backgroundColor: 'rgba(0,0,0,0.5)' }}
          >
            <IconButton icon="back" label="Back" variant="onDark" onPress={goBack} />
            {photo ? (
              <>
                <Avatar
                  name={profile.data?.display_name ?? ''}
                  avatarKey={profile.data?.avatar_key}
                  ring={profile.data?.ring_color ?? 'none'}
                  size={40}
                />
                <View className="flex-1">
                  <Text variant="heading" tone="inverse" numberOfLines={1}>
                    {profile.data?.display_name ?? 'Someone'}
                  </Text>
                  <Text variant="caption" tone="inverse" className="opacity-70" numberOfLines={1}>
                    {[chapterName, `${index + 1} of ${Math.max(total, list.length)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Stamp date={photo.sort_at} variant="plain" size={12} />
              </>
            ) : null}
          </View>

          {photo ? (
            <View
              className="absolute inset-x-0 bottom-0 px-4 pt-3"
              style={{
                paddingBottom: Math.max(insets.bottom, 12),
                backgroundColor: 'rgba(0,0,0,0.62)',
              }}
            >
              {editing ? (
                <View className="mb-3">
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    autoFocus
                    multiline
                    maxLength={280}
                    placeholder="Add a caption"
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    accessibilityLabel="Caption"
                    style={{
                      color: '#F4F3F6',
                      fontSize: 16,
                      minHeight: 48,
                      fontFamily: 'HankenGrotesk_500Medium',
                    }}
                  />
                  <View className="mt-1 flex-row justify-end gap-2">
                    <Button
                      label="Cancel"
                      variant="tertiary"
                      size="sm"
                      onDark
                      onPress={() => setEditing(false)}
                    />
                    <Button
                      label="Save"
                      variant="primary"
                      size="sm"
                      onPress={() => void saveCaption()}
                    />
                  </View>
                </View>
              ) : caption ? (
                <PressableScale
                  accessibilityRole={mine ? 'button' : 'text'}
                  accessibilityLabel={`Caption: ${caption}${mine ? '. Double tap to edit' : ''}`}
                  disabled={!mine}
                  haptics={false}
                  onPress={() => {
                    setDraft(caption);
                    setEditing(true);
                  }}
                  wrapperStyle={{ minHeight: 0, marginBottom: 12 }}
                >
                  <Text variant="body" tone="inverse" className="text-[16px] leading-[22px]">
                    {captionParts(caption).map((p, i) =>
                      p.tag ? (
                        <Text key={i} variant="body" tone="flash" className="text-[16px]">
                          {p.text}
                        </Text>
                      ) : (
                        p.text
                      ),
                    )}
                  </Text>
                </PressableScale>
              ) : mine ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Add a caption"
                  onPress={() => {
                    setDraft('');
                    setEditing(true);
                  }}
                  wrapperStyle={{ alignSelf: 'flex-start', marginBottom: 4 }}
                >
                  <Text variant="body" tone="inverse" className="text-[16px] opacity-50">
                    Add a caption
                  </Text>
                </PressableScale>
              ) : null}

              {shownKinds.length > 0 ? (
                <View className="mb-3 flex-row flex-wrap gap-2">
                  {shownKinds.map((k) => (
                    <ReactionChip
                      key={k}
                      kind={k}
                      count={counts[k]}
                      selected={mineReaction === k}
                      onPress={() => void doReact(mineReaction === k ? null : k)}
                      onLongPress={() => setPickerOpen(true)}
                    />
                  ))}
                </View>
              ) : null}

              <View className="flex-row border-t border-white/15 pt-2">
                <BarButton
                  icon="download"
                  label="Save"
                  onPress={() => void onSave()}
                  dim={downloadsOff}
                  busy={busy === 'save'}
                />
                <BarButton
                  icon="share"
                  label="Share"
                  onPress={() => void onShare()}
                  dim={downloadsOff}
                  busy={busy === 'share'}
                />
                <BarButton
                  icon="heart"
                  label="React"
                  onPress={() => (isGuest ? void doReact(null) : setPickerOpen(true))}
                  dim={isGuest}
                />
                <BarButton
                  icon="reply"
                  label="Reply"
                  dim={isGuest}
                  onPress={() =>
                    isGuest
                      ? toast.show({ message: errorCopy('guest_not_allowed').message })
                      : router.push(`/chat/r:${rollId}?photoId=${photo.id}`)
                  }
                />
                <BarButton
                  icon="more"
                  label="More"
                  onPress={() =>
                    router.push({
                      pathname: '/sheets/photo-actions',
                      params: { photoId: photo.id },
                    })
                  }
                />
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      <ModalSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="React">
        <View className="flex-row flex-wrap gap-2 pb-2">
          {REACTIONS.map((k) => (
            <ReactionChip
              key={k}
              kind={k}
              count={counts[k]}
              selected={mineReaction === k}
              onPress={() => {
                setPickerOpen(false);
                void doReact(mineReaction === k ? null : k);
              }}
            />
          ))}
        </View>
        {mineReaction ? (
          <Button
            label="Remove my reaction"
            variant="tertiary"
            onPress={() => {
              setPickerOpen(false);
              void doReact(null);
            }}
          />
        ) : null}
      </ModalSheet>

      <SavePrimer
        visible={primer !== null}
        denied={primer === 'denied'}
        onAllow={() => void allowSave()}
        onClose={() => setPrimer(null)}
        onOpenSettings={() => void Linking.openSettings()}
      />
    </View>
  );
}

import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/data/session';
import { useCrewOverview } from '@/data/useCrew';
import { createInvite } from '@/data/useInvite';
import {
  invalidateRoll,
  removePhoto,
  reviewGuestPhotos,
  useFlatPhotos,
  useReviewPhotos,
  useRollHeader,
  useRollPhotos,
  useRollRealtime,
} from '@/data/useRoll';
import type { GridPhoto } from '@/data/types-b';
import { leaveRoll } from '@/features/rolls/api';
import {
  columnsAfterPinch,
  DEFAULT_COLUMNS,
  flattenSections,
  groupIntoSections,
  sectionModeFor,
  toGridRows,
} from '@/features/rolls/grid';
import { GridRowView, type Cell, type GridCtx } from '@/features/rolls/RollGrid';
import { RollHero } from '@/features/rolls/RollHero';
import { ChapterChips, ReviewBanner, SealedCard, UploadPill } from '@/features/rolls/RollParts';
import { ReviewModal } from '@/features/rolls/ReviewModal';
import { revealCountdownLabel, sealedUntil } from '@/features/rolls/reveal';
import { useNow } from '@/features/rolls/useNow';
import { retryUpload, useRollPendingUploads } from '@/features/uploads';
import { friendlyMessage, toAppError } from '@/lib/errors';
import { pluralize } from '@/lib/format';
import {
  Button,
  confirmDialog,
  EdgeState,
  edge,
  goBack,
  haptic,
  IconButton,
  ListRow,
  ModalSheet,
  Skeleton,
  Text,
  toast,
  useBackHandler,
} from '@/ui';

/** B3 Roll gallery. One lime button: Add (Download N while selecting). */
export default function RollScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useSession();
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const header = useRollHeader(id);
  const photosQ = useRollPhotos(id, chapterId);
  const photos = useFlatPhotos(photosQ.data);
  const pending = useRollPendingUploads(id ?? '');
  const h = header.data;
  const crew = useCrewOverview(h?.roll.crew_id);
  const review = useReviewPhotos(id, reviewOpen);
  useRollRealtime(id);

  const sealed = !!h?.sealed;
  const until = h ? sealedUntil(h.roll) : null;
  const now = useNow(sealed && until ? 1000 : null);
  const countdown = sealed ? revealCountdownLabel(until, now) : null;
  const isAdmin = !!h?.my.is_admin;
  const chapters = h?.chapters ?? [];

  useBackHandler(
    () => {
      setSelectMode(false);
      setSelected(new Set());
      return true;
    },
    selectMode,
  );

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggle = useCallback((photoId: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(photoId)) n.delete(photoId);
      else n.add(photoId);
      return n;
    });
  }, []);

  const ctx: GridCtx = useMemo(
    () => ({
      columns,
      selectMode,
      selected,
      meId: user?.id,
      sealed,
      onOpen: (p: GridPhoto) => {
        if (selectMode) {
          toggle(p.id);
          return;
        }
        router.push({
          pathname: '/photo/[id]',
          params: { id: p.id, rollId: id as string, ...(chapterId ? { chapterId } : {}) },
        });
      },
      onLongPress: (p: GridPhoto) => {
        if (sealed) return;
        haptic.select();
        setSelectMode(true);
        setSelected((s) => new Set(s).add(p.id));
      },
      onRetry: (uploadId: string) => void retryUpload(uploadId),
    }),
    [columns, selectMode, selected, user?.id, sealed, id, chapterId, toggle],
  );

  // Sections -> list rows (uploads on top, sealed placeholders last).
  const { rows, headerIndices } = useMemo(() => {
    const mode = sectionModeFor(chapters, chapterId);
    const sections = groupIntoSections(photos, chapters, mode).map((s) => ({
      ...s,
      photos: s.photos.map((p): Cell => ({ kind: 'photo', id: p.id, photo: p })),
    }));
    const all: { key: string; title: string; subtitle?: string; photos: Cell[] }[] = [];
    if (pending.length > 0) {
      all.push({
        key: 'uploads',
        title: 'Yours · uploading',
        photos: pending.map((it): Cell => ({ kind: 'upload', id: `u:${it.id}`, item: it })),
      });
    }
    all.push(...sections);
    if (sealed) {
      const filler = Math.min(12, Math.max(0, (h?.photo_count ?? 0) - photos.length));
      if (filler > 0) {
        all.push({
          key: 'sealed',
          title: 'Sealed until the reveal',
          photos: Array.from({ length: filler }, (_, i): Cell => ({ kind: 'sealed', id: `s${i}` })),
        });
      }
    }
    return toGridRows(all, columns);
  }, [photos, chapters, chapterId, pending, sealed, h?.photo_count, columns]);

  const uploading = pending.filter(
    (p) => p.state !== 'failed' && p.state !== 'blocked' && p.state !== 'duplicate',
  ).length;
  const failed = pending.filter((p) => p.state === 'failed' || p.state === 'blocked').length;

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onEnd((e) => setColumns((c) => columnsAfterPinch(c, e.scale))),
    [],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([header.refetch(), photosQ.refetch(), crew.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const share = async () => {
    if (!h) return;
    setSharing(true);
    try {
      const inv = await createInvite({ crewId: h.roll.crew_id, rollId: h.roll.id });
      await Share.share({ message: `Add your photos to ${h.roll.name} on Dumpr: ${inv.link}` });
    } catch (e) {
      const err = toAppError(e);
      toast.show({
        message: err.code === 'not_admin' ? 'Only hosts can invite to this Roll.' : friendlyMessage(e),
      });
    } finally {
      setSharing(false);
    }
  };

  const decideReview = async (ids: string[], approve: boolean) => {
    if (!id) return;
    setReviewBusy(true);
    try {
      await reviewGuestPhotos(ids, approve);
      toast.show({
        message: approve ? `Approved ${pluralize(ids.length, 'photo')}` : `Rejected ${pluralize(ids.length, 'photo')}`,
      });
      invalidateRoll(qc, id, h?.roll.crew_id);
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    } finally {
      setReviewBusy(false);
    }
  };

  const selectedPhotos = photos.filter((p) => selected.has(p.id));
  const canRemoveSelected =
    selectedPhotos.length > 0 && selectedPhotos.every((p) => p.uploader_id === user?.id || isAdmin);

  const removeSelected = async () => {
    const targets = selectedPhotos;
    const ok = await confirmDialog({
      title: `Remove ${pluralize(targets.length, 'photo')}?`,
      body: 'They disappear for everyone in this Roll. You can undo for a few days from your uploads.',
      confirmLabel: 'Remove',
    });
    if (!ok || !id) return;
    const results = await Promise.allSettled(targets.map((p) => removePhoto(p.id)));
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    invalidateRoll(qc, id, h?.roll.crew_id);
    exitSelect();
    toast.show({
      message:
        okCount === targets.length
          ? `Removed ${pluralize(okCount, 'photo')}`
          : `Removed ${okCount} of ${targets.length}. The rest could not be removed.`,
    });
  };

  const onLeave = async () => {
    if (!h) return;
    setMenuOpen(false);
    await new Promise((r) => setTimeout(r, 280));
    const ok = await confirmDialog({
      title: `Leave ${h.roll.name}?`,
      body: "You'll stop seeing this Roll. You can come back with a new invite.",
      confirmLabel: 'Leave',
    });
    if (!ok) return;
    try {
      await leaveRoll(h.roll.id);
      invalidateRoll(qc, h.roll.id, h.roll.crew_id);
      router.replace('/');
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    }
  };

  const err = header.error ? toAppError(header.error) : null;
  if (err && !h) {
    const c = err.code === 'not_a_member' ? edge.removedFromCrew('this Roll') : edge.fromError(err);
    return (
      <View className="flex-1 bg-paper dark:bg-paper-dark" style={{ paddingTop: insets.top }}>
        <View className="px-4 pt-2">
          <IconButton icon="back" label="Back" onPress={goBack} />
        </View>
        <EdgeState
          layout="screen"
          icon={c.icon}
          tone={c.tone}
          title={err.code === 'not_a_member' ? "You're not in this Roll" : c.title}
          body={err.code === 'not_a_member' ? 'Ask someone inside for an invite and it will show up here.' : c.body}
          primary={
            err.code === 'not_a_member'
              ? { label: 'Go home', onPress: () => router.replace('/') }
              : { label: 'Try again', onPress: () => void header.refetch() }
          }
        />
      </View>
    );
  }

  const canUpload = !!h?.my.can_upload;
  const downloadsOff = !!h && !h.roll.allow_downloads && !isAdmin;
  const noPhotos = photos.length === 0;

  const listHeader = (
    <View className="gap-3 pb-2">
      <RollHero
        header={h}
        memberCount={crew.data?.members.length}
        sharing={sharing}
        onShare={() => void share()}
        onMore={() => setMenuOpen(true)}
      />
      {h ? (
        <>
          {sealed ? (
            <View className="px-4">
              <SealedCard label={countdown} />
            </View>
          ) : null}
          {h.crew.deleted_at ? (
            <View className="px-4">
              <EdgeState
                icon="download"
                tone="ink"
                title={`${h.crew.name} was deleted`}
                body="You have 30 days to download the photos you can see."
                primary={{
                  label: 'Download my copies',
                  onPress: () => router.push({ pathname: '/sheets/download', params: { rollId: h.roll.id } }),
                }}
                primaryVariant="strong"
              />
            </View>
          ) : null}
          {isAdmin && h.review_count > 0 ? (
            <View className="px-4">
              <ReviewBanner count={h.review_count} onPress={() => setReviewOpen(true)} />
            </View>
          ) : null}
          <ChapterChips chapters={chapters} value={chapterId} onChange={setChapterId} />
          {selectMode ? (
            <View className="flex-row items-center justify-between px-4">
              <Text variant="heading" heading>
                {selected.size === 0 ? 'Select photos' : `${selected.size} selected`}
              </Text>
              <Button label="Cancel" variant="tertiary" size="sm" onPress={exitSelect} />
            </View>
          ) : (
            <View className="px-4">
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label="Add"
                  icon="plus"
                  variant="primary"
                  disabled={!canUpload}
                  onPress={() => setAddOpen(true)}
                />
                <Button
                  label="Download all"
                  icon="download"
                  variant="secondary"
                  disabled={downloadsOff || sealed || noPhotos}
                  onPress={() =>
                    router.push({ pathname: '/sheets/download', params: { rollId: h.roll.id } })
                  }
                />
                <Button
                  label="Chat"
                  icon="chat"
                  variant="secondary"
                  disabled={h.my.is_guest}
                  onPress={() => router.push(`/chat/r:${h.roll.id}`)}
                />
                <Button
                  label="Select"
                  icon="checkCircle"
                  variant="secondary"
                  disabled={sealed || noPhotos}
                  onPress={() => setSelectMode(true)}
                />
              </View>
              {!canUpload || downloadsOff ? (
                <Text variant="caption" className="mt-2">
                  {!canUpload ? 'Uploads are closed by the host. ' : ''}
                  {downloadsOff ? 'The host turned downloads off.' : ''}
                </Text>
              ) : null}
            </View>
          )}
        </>
      ) : (
        <View className="gap-3 px-4">
          <Skeleton height={48} radius={999} />
        </View>
      )}
    </View>
  );

  const empty = !h ? (
    <GridSkeleton columns={columns} />
  ) : photosQ.isPending ? (
    <GridSkeleton columns={columns} />
  ) : photosQ.isError ? (
    <View className="px-4 pt-4">
      <EdgeState
        icon="alert"
        tone="sky"
        title="Photos did not load"
        body="Check your connection and try again. Nothing was lost."
        primary={{ label: 'Try again', onPress: () => void photosQ.refetch() }}
        primaryVariant="strong"
      />
    </View>
  ) : sealed ? null : (
    <View className="mx-4 mt-4 rounded-card border border-dashed border-ink/30 p-6 dark:border-ink-dark/30">
      <Text variant="title" heading>
        Nothing here yet
      </Text>
      <Text variant="body" className="mt-1">
        {canUpload ? 'Be the first to add one.' : 'Photos will show up here as people add them.'}
      </Text>
      {canUpload ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          <Button label="Add photos" icon="camera" variant="strong" onPress={() => setAddOpen(true)} />
          <Button
            label="Import from this weekend"
            icon="image"
            variant="secondary"
            onPress={() => router.push({ pathname: '/import', params: { rollId: id as string } })}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      <GestureDetector gesture={pinch}>
        <View className="flex-1">
          <FlashList
            data={rows}
            extraData={ctx}
            keyExtractor={(r) => r.key}
            getItemType={(r) => r.type}
            stickyHeaderIndices={headerIndices}
            renderItem={({ item }) => <GridRowView row={item} ctx={ctx} />}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={empty}
            onEndReached={() => {
              if (photosQ.hasNextPage && !photosQ.isFetchingNextPage) void photosQ.fetchNextPage();
            }}
            onEndReachedThreshold={1.5}
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            contentContainerStyle={{ paddingBottom: selectMode ? 140 : 120 }}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </GestureDetector>

      {!selectMode ? (
        <UploadPill uploading={uploading} failed={failed} onPress={() => router.push('/uploads')} />
      ) : (
        <View
          className="absolute inset-x-0 bottom-0 gap-1 bg-paper px-4 pt-3 dark:bg-paper-dark"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Button
            label={selected.size > 0 ? `Download ${selected.size}` : 'Download'}
            icon="download"
            variant="primary"
            size="lg"
            disabled={selected.size === 0 || downloadsOff}
            disabledReason={downloadsOff ? 'The host turned downloads off' : 'Pick at least one photo'}
            onPress={() => {
              router.push({
                pathname: '/sheets/download',
                params: { rollId: id as string, scope: 'selected', photoIds: [...selected].join(',') },
              });
              exitSelect();
            }}
          />
          {canRemoveSelected ? (
            <Button label="Remove" variant="destructive" fullWidth onPress={() => void removeSelected()} />
          ) : null}
        </View>
      )}

      <ModalSheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add to this Roll">
        <View>
          <ListRow
            icon="camera"
            title="Take photos"
            subtitle="Shoot now, they upload in the background"
            onPress={() => {
              setAddOpen(false);
              router.push({ pathname: '/camera', params: { rollId: id as string } });
            }}
          />
          <ListRow
            icon="image"
            title="From your gallery"
            subtitle="We suggest photos from this Roll's dates"
            divider={false}
            onPress={() => {
              setAddOpen(false);
              router.push({ pathname: '/import', params: { rollId: id as string } });
            }}
          />
        </View>
      </ModalSheet>

      <ModalSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={h?.roll.name ?? 'Roll'}>
        <View>
          {h && !h.my.is_guest ? (
            <ListRow
              icon="userPlus"
              title="Invite people"
              onPress={() => {
                setMenuOpen(false);
                router.push({
                  pathname: '/sheets/invite',
                  params: { crewId: h.roll.crew_id, rollId: h.roll.id },
                });
              }}
            />
          ) : null}
          {isAdmin && h ? (
            <ListRow
              icon="sliders"
              title="Roll settings"
              subtitle="Uploads, downloads, guests, dates"
              onPress={() => {
                setMenuOpen(false);
                router.push({ pathname: '/sheets/roll-settings', params: { rollId: h.roll.id } });
              }}
            />
          ) : null}
          {h && h.my.via === 'crew' ? (
            <ListRow
              icon="users"
              title={`Open ${h.crew.name}`}
              onPress={() => {
                setMenuOpen(false);
                router.push(`/crew/${h.roll.crew_id}`);
              }}
            />
          ) : null}
          {h && h.my.via === 'roll' ? (
            <ListRow icon="logout" title="Leave Roll" destructive divider={false} onPress={() => void onLeave()} />
          ) : null}
        </View>
      </ModalSheet>

      <ReviewModal
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        photos={review.data ?? []}
        loading={review.isPending}
        busy={reviewBusy}
        onDecide={(ids, approve) => void decideReview(ids, approve)}
      />
    </View>
  );
}

function GridSkeleton({ columns }: { columns: number }) {
  return (
    <View className="flex-row flex-wrap px-1" style={{ gap: 2 }}>
      {Array.from({ length: columns * 4 }, (_, i) => (
        <View key={i} style={{ width: `${100 / columns - 0.6}%` }}>
          <Skeleton height={undefined} radius={10} style={{ aspectRatio: 1 }} />
        </View>
      ))}
    </View>
  );
}

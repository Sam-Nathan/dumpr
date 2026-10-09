import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/data/session';
import type { MemberRole } from '@/data/types';
import {
  crewKey,
  deleteCrew,
  invalidateCrew,
  leaveCrew,
  removeMember,
  setCrewMuted,
  setMemberRole,
  transferHost,
  updateCrew,
  useCrewOverview,
} from '@/data/useCrew';
import { homeFeedKey } from '@/data/useHome';
import { prefetchInviteLink } from '@/data/useInvite';
import type { CrewMember, CrewOverview, HomeFeed } from '@/data/types-b';
import { CrewSettingsModal } from '@/features/crews/CrewSettingsModal';
import { MemberListModal } from '@/features/crews/MemberListModal';
import { NewRollCard, RollCard } from '@/features/crews/RollCard';
import { deleteCrewBody, memberSummary, type MemberAction } from '@/features/crews/summary';
import { errorCopy, friendlyMessage, toAppError } from '@/lib/errors';
import {
  Button,
  confirmDialog,
  EdgeState,
  edge,
  Facepile,
  goBack,
  IconButton,
  ListRow,
  ModalSheet,
  PressableScale,
  Skeleton,
  Text,
  TINT_BG,
  toast,
} from '@/ui';

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** B2 Crew overview: tinted header, members, Invite, Mute, Rolls newest first, Chat. */
export default function CrewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, isGuest } = useSession();
  const q = useCrewOverview(id);
  const [refreshing, setRefreshing] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Header renders instantly from what Home already knows.
  const known = qc.getQueryData<HomeFeed>(homeFeedKey)?.crews.find((c) => c.id === id);
  const data = q.data;
  const name = data?.crew.name ?? known?.name ?? '';
  const tint = data?.crew.tint ?? known?.tint ?? 'lilac';
  const myRole: MemberRole | undefined = data?.my.role;
  const isAdmin = !!data?.my.is_admin;
  const isHost = myRole === 'host';
  const muted = data?.my.muted ?? known?.muted ?? false;
  const deleted = !!data?.crew.deleted_at;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (id) invalidateCrew(qc, id);
      if (done) toast.show({ message: done });
      return true;
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
      return false;
    }
  };

  const toggleMute = async () => {
    if (!id || !data) return;
    const next = !muted;
    qc.setQueryData<CrewOverview>(crewKey(id), { ...data, my: { ...data.my, muted: next } });
    try {
      await setCrewMuted(id, next);
      toast.show({ message: next ? `Muted ${name}` : `Unmuted ${name}` });
      void qc.invalidateQueries({ queryKey: homeFeedKey });
    } catch (e) {
      qc.setQueryData<CrewOverview>(crewKey(id), data);
      toast.show({ message: friendlyMessage(e) });
    }
  };

  const onMemberAction = async (action: MemberAction, m: CrewMember) => {
    if (!id) return;
    setMembersOpen(false);
    await later(280);
    if (action === 'make_cohost') {
      await run(() => setMemberRole(id, m.user_id, 'cohost'), `${m.display_name} is now a co-host`);
    } else if (action === 'make_member') {
      await run(
        () => setMemberRole(id, m.user_id, 'member'),
        `${m.display_name} is a member again`,
      );
    } else if (action === 'make_host') {
      const ok = await confirmDialog({
        title: `Make ${m.display_name} the host?`,
        body: `They will run ${name} and you become a co-host. Only a host can undo this.`,
        confirmLabel: 'Make host',
        destructive: false,
      });
      if (ok) await run(() => transferHost(id, m.user_id), `${m.display_name} is the host now`);
    } else {
      const ok = await confirmDialog({
        title: `Remove ${m.display_name} from ${name}?`,
        body: 'They lose access to the Crew and its Rolls. Photos they added stay in the Rolls.',
        confirmLabel: 'Remove',
      });
      if (ok) await run(() => removeMember(id, m.user_id), `Removed ${m.display_name}`);
    }
  };

  const onLeave = async () => {
    if (!id) return;
    setMenuOpen(false);
    await later(280);
    const ok = await confirmDialog({
      title: `Leave ${name}?`,
      body: "You'll stop getting its photos and chat. You can come back with a new invite.",
      confirmLabel: 'Leave',
    });
    if (!ok) return;
    try {
      await leaveCrew(id);
      void qc.invalidateQueries({ queryKey: homeFeedKey });
      qc.removeQueries({ queryKey: crewKey(id) });
      router.replace('/');
      toast.show({ message: `You left ${name}` });
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'last_host') {
        const copy = errorCopy('last_host');
        const choose = await confirmDialog({
          title: copy.title,
          body: copy.message,
          confirmLabel: 'Choose a host',
          cancelLabel: 'Not now',
          destructive: false,
        });
        if (choose) setMembersOpen(true);
      } else {
        toast.show({ message: friendlyMessage(e) });
      }
    }
  };

  const onDelete = async () => {
    if (!id) return;
    setSettingsOpen(false);
    await later(280);
    const ok = await confirmDialog({
      title: `Delete ${name} for everyone?`,
      body: deleteCrewBody(data?.members.length ?? 0),
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteCrew(id);
      void qc.invalidateQueries({ queryKey: homeFeedKey });
      router.replace('/');
      toast.show({ message: `Deleted ${name}` });
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    }
  };

  const onSaveSettings = async (patch: { name: string; tint: typeof tint }) => {
    if (!id) return;
    setSaving(true);
    const ok = await run(() =>
      updateCrew(id, {
        name: patch.name !== name ? patch.name : undefined,
        tint: patch.tint !== tint ? patch.tint : undefined,
      }),
    );
    setSaving(false);
    if (ok) setSettingsOpen(false);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const err = q.error ? toAppError(q.error) : null;
  const rolls = data?.rolls ?? [];

  const header = (
    <View
      className={`rounded-b-sheet px-4 pb-4 ${TINT_BG[tint]}`}
      style={{ paddingTop: insets.top + 8 }}
    >
      <View className="flex-row items-center justify-between">
        <IconButton icon="back" label="Back" onPress={goBack} />
        {data && !deleted ? (
          <View className="flex-row items-center gap-2">
            <IconButton
              icon={muted ? 'bellOff' : 'bell'}
              label={muted ? 'Unmute Crew' : 'Mute Crew'}
              onPress={() => void toggleMute()}
            />
            {!isGuest ? (
              <IconButton
                icon="userPlus"
                label="Invite people"
                variant="ink"
                onPress={() => {
                  prefetchInviteLink(qc, { crewId: id as string });
                  router.push({ pathname: '/sheets/invite', params: { crewId: id as string } });
                }}
              />
            ) : null}
            <IconButton icon="more" label="More" onPress={() => setMenuOpen(true)} />
          </View>
        ) : null}
      </View>
      {name ? (
        <Text variant="display" heading className="mt-3" numberOfLines={3}>
          {name}
        </Text>
      ) : (
        <View className="mt-3">
          <Skeleton width="60%" height={40} radius={10} className="bg-white/50 dark:bg-white/10" />
        </View>
      )}
      {data ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Members: ${memberSummary(data.members, user?.id)}. Open list`}
          onPress={() => setMembersOpen(true)}
          wrapperStyle={{ alignSelf: 'flex-start' }}
        >
          <View className="flex-row items-center gap-3">
            <Facepile
              size={30}
              max={4}
              total={data.members.length}
              people={data.members.map((m) => ({
                name: m.display_name,
                avatarKey: m.avatar_key,
                ring: m.ring_color,
              }))}
            />
            <Text variant="caption" tone="secondary" className="flex-shrink">
              {memberSummary(data.members, user?.id)}
            </Text>
          </View>
        </PressableScale>
      ) : null}
      {data && !deleted ? (
        <View
          accessibilityRole="tablist"
          className="mt-4 flex-row self-start rounded-pill bg-white/60 p-1 dark:bg-white/10"
        >
          <View
            accessibilityRole="tab"
            accessibilityState={{ selected: true }}
            className="h-10 justify-center rounded-pill bg-ink px-5 dark:bg-ink-dark"
          >
            <Text
              variant="caption"
              tone="inverse"
              className="font-body-bold text-[14px] dark:text-ink"
            >
              Rolls
            </Text>
          </View>
          <PressableScale
            accessibilityRole="tab"
            accessibilityState={{ selected: false }}
            accessibilityLabel="Chat"
            onPress={() => router.push(`/chat/c:${id}`)}
            className="h-10 justify-center px-5"
          >
            <Text variant="caption" tone="default" className="font-body-bold text-[14px]">
              Chat
            </Text>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (err && !data) {
    const c =
      err.code === 'not_a_member' ? edge.removedFromCrew(name || 'this Crew') : edge.fromError(err);
    body = (
      <View className="px-4 pt-8">
        <EdgeState
          icon={c.icon}
          tone={c.tone}
          title={c.title}
          body={c.body}
          primary={
            err.code === 'not_a_member'
              ? { label: 'Go home', onPress: () => router.replace('/') }
              : { label: 'Try again', onPress: () => void q.refetch() }
          }
          secondary={
            err.code === 'not_a_member'
              ? undefined
              : { label: 'Go home', onPress: () => router.replace('/') }
          }
        />
      </View>
    );
  } else if (!data) {
    body = (
      <View className="gap-3 px-4 pt-4">
        <Skeleton height={190} radius={24} />
        <Skeleton height={190} radius={24} />
      </View>
    );
  } else if (deleted) {
    const c = edge.crewDeleted(name);
    const first = rolls[0];
    body = (
      <View className="px-4 pt-6">
        <EdgeState
          icon={c.icon}
          tone={c.tone}
          title={c.title}
          body={c.body}
          primary={
            first
              ? {
                  label: 'Download my copies',
                  onPress: () =>
                    router.push({ pathname: '/sheets/download', params: { rollId: first.id } }),
                }
              : { label: 'Go home', onPress: () => router.replace('/') }
          }
          secondary={first ? { label: 'Go home', onPress: () => router.replace('/') } : undefined}
        />
        <View className="mt-3 gap-3">
          {rolls.map((r) => (
            <RollCard key={r.id} roll={r} tint={tint} />
          ))}
        </View>
      </View>
    );
  } else if (rolls.length === 0) {
    body = (
      <View className="px-4 pt-6">
        <View className="rounded-card border border-dashed border-ink/30 p-6 dark:border-ink-dark/30">
          <Text variant="title" heading>
            No Rolls yet
          </Text>
          <Text variant="body" className="mt-1">
            Make one for your next plan, or add photos from a past trip.
          </Text>
          <View className="mt-3 items-start">
            <Button
              label="Import from gallery"
              icon="image"
              variant="secondary"
              onPress={() => router.push({ pathname: '/import', params: { crewId: id as string } })}
            />
          </View>
        </View>
      </View>
    );
  } else {
    body = (
      <View className="gap-3 px-4 pt-4">
        {rolls.map((r) => (
          <RollCard key={r.id} roll={r} tint={tint} />
        ))}
        {!isGuest ? (
          <NewRollCard
            onPress={() =>
              router.push({
                pathname: '/sheets/create',
                params: { kind: 'roll', crewId: id as string },
              })
            }
          />
        ) : null}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {header}
        {body}
      </ScrollView>

      {data && !deleted && !isGuest ? (
        <View
          className="absolute inset-x-0 bottom-0 px-4"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Button
            label="New Roll"
            icon="plus"
            variant="primary"
            size="lg"
            onPress={() =>
              router.push({
                pathname: '/sheets/create',
                params: { kind: 'roll', crewId: id as string },
              })
            }
          />
        </View>
      ) : null}

      {data ? (
        <>
          <MemberListModal
            visible={membersOpen}
            onClose={() => setMembersOpen(false)}
            crewName={name}
            members={data.members}
            meId={user?.id}
            myRole={myRole}
            onAct={(a, m) => void onMemberAction(a, m)}
          />
          <CrewSettingsModal
            visible={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            name={name}
            tint={tint}
            isHost={isHost}
            saving={saving}
            onSave={(p) => void onSaveSettings(p)}
            onDelete={() => void onDelete()}
          />
          <ModalSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={name}>
            <View>
              <ListRow
                icon="users"
                title="Members"
                subtitle={`${data.members.length} in this Crew`}
                onPress={() => {
                  setMenuOpen(false);
                  setMembersOpen(true);
                }}
              />
              <ListRow
                icon={muted ? 'bell' : 'bellOff'}
                title={muted ? 'Unmute notifications' : 'Mute notifications'}
                onPress={() => {
                  setMenuOpen(false);
                  void toggleMute();
                }}
              />
              {isAdmin ? (
                <ListRow
                  icon="sliders"
                  title="Crew settings"
                  subtitle="Rename, change tint"
                  onPress={() => {
                    setMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                />
              ) : null}
              <ListRow
                icon="logout"
                title="Leave Crew"
                destructive
                divider={false}
                onPress={() => void onLeave()}
              />
            </View>
          </ModalSheet>
        </>
      ) : null}
    </View>
  );
}

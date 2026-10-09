import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rpc } from '@/data/rpc';
import { useSession } from '@/data/session';
import type { InvitePreview } from '@/data/types';
import { joinedHref, joinViaInvite, useInvitePreview } from '@/features/invites/api';
import { usePendingInvite } from '@/features/invites/pendingInvite';
import { maybeRegisterForPush } from '@/features/notifications/register';
import { type AppError, errorCopy, toAppError } from '@/lib/errors';
import { formatDateRange, formatStamp, parseDay, pluralize } from '@/lib/format';
import {
  Avatar,
  Button,
  DumpStack,
  type EdgeContent,
  EdgeState,
  edge,
  Facepile,
  FLASH,
  goBack,
  haptic,
  Icon,
  type IconName,
  IconButton,
  INK,
  Skeleton,
  type StackCard,
  Text,
  TINT_BG,
  toast,
  useColors,
} from '@/ui';

const DEAD_END_CODES = new Set([
  'invite_expired',
  'invite_revoked',
  'invite_full',
  'invite_not_found',
  'not_found',
]);

function deadEndFor(status: string, host: string | null): EdgeContent {
  switch (status) {
    case 'expired':
    case 'invite_expired':
      return edge.inviteExpired(host);
    case 'revoked':
    case 'invite_revoked':
      return edge.inviteRevoked(host);
    case 'full':
    case 'invite_full':
      return edge.inviteFull(host);
    default:
      return edge.inviteNotFound();
  }
}

function titleOf(p: InvitePreview): string {
  return p.roll?.name ?? p.crew?.name ?? 'this Roll';
}

function stampFor(day: string | null | undefined, offsetDays = 0): string | undefined {
  const d = parseDay(day);
  if (!d) return undefined;
  return formatStamp(new Date(d.getTime() + offsetDays * 86_400_000), { time: false, utc: true });
}

/**
 * A4 Join invite. Preview (cover stack, name, host, facepile, count, dates, who-can-see), Join ->
 * join_via_invite -> Roll / Crew; requested -> "Requested — we'll tell you"; Decline; Report.
 * Expired / revoked / full / unknown links -> F6 "Ask <host> for a new link".
 */
export default function JoinInvite() {
  const params = useLocalSearchParams<{ code: string; autojoin?: string }>();
  const code = decodeURIComponent(String(params.code ?? '')).toLowerCase();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { session, isGuest } = useSession();
  const preview = useInvitePreview(code);
  const declined = usePendingInvite((s) => !!s.declined[code]);
  const [joining, setJoining] = useState(false);
  const [requested, setRequested] = useState(false);
  const [joinError, setJoinError] = useState<AppError | null>(null);
  const autoJoined = useRef(false);

  const data = preview.data;
  const host = data?.host?.display_name ?? null;

  const join = async () => {
    if (!data || joining) return;
    if (!session) {
      // Keep the invite through sign-up; A2 offers guest access when the invite allows it.
      usePendingInvite.getState().setPending({
        code,
        kind: data.kind,
        title: titleOf(data),
        hostName: host,
        allowGuests: data.kind === 'roll' && data.allow_guests,
      });
      router.push('/welcome');
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const r = await joinViaInvite(code);
      usePendingInvite.getState().clear();
      if (r.status === 'requested') {
        setRequested(true);
        return;
      }
      haptic.success();
      if (r.status === 'joined') toast.show({ message: `You're in ${titleOf(data)}` });
      router.replace(joinedHref(r));
      if (!isGuest) void maybeRegisterForPush();
    } catch (e) {
      setJoinError(toAppError(e));
    } finally {
      setJoining(false);
    }
  };

  // Coming back from sign-up with a pending invite: join straight away (the person already chose).
  useEffect(() => {
    if (params.autojoin !== '1' || autoJoined.current || !session || !data || data.status !== 'ok')
      return;
    if (data.viewer?.is_member || data.viewer?.request_pending) return;
    autoJoined.current = true;
    void join();
    // join is stable enough for a one-shot effect
  }, [params.autojoin, session, data]);

  const askForNewLink = () => {
    const name = data ? titleOf(data) : 'the Roll';
    void Share.share({
      message: `Hi${host ? ` ${host}` : ''}! My Dumpr link for ${name} isn't working any more. Could you send me a new one?`,
    }).catch(() => undefined);
  };

  const goHome = () => router.replace('/');

  // ---------- Loading ----------
  if (preview.isLoading) {
    return (
      <View
        className="flex-1 bg-paper dark:bg-paper-dark"
        accessibilityLabel="Loading invite"
        accessibilityState={{ busy: true }}
      >
        <View
          className="rounded-b-[40px] bg-tint-lime px-5 pb-6 dark:bg-tint-lime-dark"
          style={{ paddingTop: insets.top + 12 }}
        >
          <View className="flex-row items-center justify-between">
            <Skeleton width={160} height={20} radius={999} />
            <IconButton icon="close" label="Close" onPress={goBack} />
          </View>
          <View className="mt-6 items-center">
            <Skeleton width="70%" height={220} radius={20} />
          </View>
        </View>
        <View className="gap-3 px-5 pt-6">
          <Skeleton width={120} height={12} />
          <Skeleton width="65%" height={36} />
          <View className="flex-row items-center justify-between">
            <Skeleton width={150} height={14} />
            <View className="flex-row gap-1">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} width={32} height={32} radius={999} />
              ))}
            </View>
          </View>
        </View>
      </View>
    );
  }

  const deadEnd: EdgeContent | null = preview.isError
    ? DEAD_END_CODES.has(toAppError(preview.error).code)
      ? deadEndFor(toAppError(preview.error).code, null)
      : null
    : data && data.status !== 'ok'
      ? deadEndFor(data.status, host)
      : joinError && DEAD_END_CODES.has(joinError.code)
        ? deadEndFor(joinError.code, host)
        : null;

  const screenState = (content: EdgeContent, primary: () => void, secondary?: () => void) => (
    <View
      className="flex-1 bg-paper dark:bg-paper-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-row justify-end px-4 py-1">
        <IconButton icon="close" label="Close" onPress={goBack} />
      </View>
      <EdgeState
        layout="screen"
        icon={content.icon}
        tone={content.tone}
        title={content.title}
        body={content.body}
        primary={
          content.primaryLabel ? { label: content.primaryLabel, onPress: primary } : undefined
        }
        secondary={
          content.secondaryLabel && secondary
            ? { label: content.secondaryLabel, onPress: secondary }
            : undefined
        }
      />
    </View>
  );

  // ---------- Error / dead ends ----------
  if (deadEnd) {
    const notFound = deadEnd.title === edge.inviteNotFound().title;
    return screenState(deadEnd, notFound ? goHome : askForNewLink, goHome);
  }
  if (preview.isError || !data) {
    const c = edge.fromError(preview.error);
    return screenState(c, () => void preview.refetch(), goHome);
  }
  const title = titleOf(data);
  if (declined) {
    return screenState(
      edge.inviteDeclined(title),
      () => usePendingInvite.getState().undecline(code),
      goHome,
    );
  }
  if (requested || data.viewer?.request_pending) {
    return screenState(edge.requested(title), goHome);
  }

  // ---------- Preview ----------
  const roll = data.roll;
  const sealed = !!roll?.sealed;
  const tint = data.crew?.tint ?? 'lime';
  const cards: StackCard[] = [
    { art: 'beach', stamp: stampFor(roll?.starts_on) },
    { art: 'sunset', stamp: stampFor(roll?.starts_on, 1) },
    data.cover_url && !sealed
      ? {
          uri: data.cover_url,
          cacheKey: data.cover_thumb_key ?? undefined,
          stamp: stampFor(roll?.ends_on),
        }
      : { art: 'party', stamp: stampFor(roll?.ends_on), blurred: sealed },
  ];
  const meta =
    data.kind === 'roll' && roll
      ? [
          formatDateRange(roll.starts_on, roll.ends_on),
          roll.photo_count > 0 ? pluralize(roll.photo_count, 'photo') : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : pluralize(data.member_count, 'member');
  const revealText = roll?.reveal_at
    ? new Date(roll.reveal_at).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const rows: { icon: IconName; text: string }[] = [
    {
      icon: 'lock',
      text:
        data.kind === 'roll'
          ? `Private — only the ${data.member_count} ${data.member_count === 1 ? 'person' : 'people'} in this Roll see it`
          : `Private — only the ${data.member_count} members of this Crew see it`,
    },
    {
      icon: data.kind === 'roll' ? 'download' : 'users',
      text:
        data.kind === 'roll'
          ? isGuest || (!session && data.allow_guests)
            ? 'You can add photos and save the ones you like'
            : 'You can add photos and download the full Roll'
          : "You'll see every Roll in this Crew, plus its chat",
    },
  ];
  if (sealed)
    rows.push({
      icon: 'clock',
      text: `Photos stay sealed${revealText ? ` until ${revealText}` : ''}. Everyone sees them at the same moment.`,
    });
  if (data.requires_approval)
    rows.push({
      icon: 'users',
      text: "A host approves new people. We'll tell you when you're in.",
    });

  const isMember = !!data.viewer?.is_member;
  const joinLabel = data.kind === 'roll' ? 'Join Roll' : 'Join Crew';
  const guestBlocked = isGuest && (data.kind === 'crew' || !data.allow_guests);

  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className={`rounded-b-[40px] px-5 pb-4 ${TINT_BG[tint]}`}
          style={{ paddingTop: insets.top + 8 }}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-2.5 pr-2">
              {data.host ? (
                <Avatar name={data.host.display_name} uri={data.host.avatar_url} size={36} />
              ) : null}
              <Text variant="body" tone="default" numberOfLines={1} className="flex-1">
                <Text variant="body" tone="default" className="font-body-bold">
                  {host ?? 'Someone'}
                </Text>{' '}
                invited you
              </Text>
            </View>
            <IconButton icon="close" label="Close" variant="soft" onPress={goBack} />
          </View>
          <View className="mt-2">
            <DumpStack cards={cards} aspectRatio={1.35} cardAspect={0.95}>
              {sealed ? (
                <View
                  className="absolute inset-0 items-center justify-center"
                  style={{ zIndex: 10 }}
                >
                  <View
                    className="flex-row items-center gap-2 rounded-pill px-4 py-2"
                    style={{ backgroundColor: INK }}
                  >
                    <Icon name="lock" size={16} color={FLASH} />
                    <Text variant="stamp" style={{ color: FLASH }}>
                      {revealText ? `SEALED UNTIL ${revealText.toUpperCase()}` : 'SEALED'}
                    </Text>
                  </View>
                </View>
              ) : null}
            </DumpStack>
          </View>
        </View>

        <View className="px-5 pt-5">
          <Text variant="stamp" tone="tertiary" className="text-[12px]">
            {data.crew?.name
              ? `${data.crew.name} · ${data.kind === 'roll' ? 'ROLL' : 'CREW'}`
              : data.kind.toUpperCase()}
          </Text>
          <Text variant="display" heading className="mt-1" numberOfLines={3}>
            {title}
          </Text>
          <View className="mt-3 flex-row items-center justify-between">
            <Text variant="body" className="flex-1 pr-2">
              {meta}
            </Text>
            <Facepile
              people={data.facepile.map((p) => ({
                name: p.display_name,
                avatarUrl: p.avatar_url,
                ring: p.ring_color,
              }))}
              total={data.member_count}
            />
          </View>
          {data.kind === 'roll' && roll && roll.photo_count === 0 && !sealed ? (
            <Text variant="caption" className="mt-1">
              No photos yet. Be the first to add one.
            </Text>
          ) : null}

          <View className="mt-5">
            {rows.map((r, i) => (
              <View
                key={i}
                className="flex-row items-center gap-3 border-t border-line py-3.5 dark:border-line-dark"
              >
                <Icon name={r.icon} size={20} color={colors.ink} />
                <Text variant="body" tone="default" className="flex-1">
                  {r.text}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View className="px-5 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        {joinError ? (
          <Text
            variant="caption"
            tone="danger"
            className="mb-2 text-center"
            accessibilityLiveRegion="polite"
          >
            {errorCopy(joinError.code).message}
          </Text>
        ) : null}
        {isMember ? (
          <Button
            label={data.kind === 'roll' ? 'Open Roll' : 'Open Crew'}
            variant="primary"
            size="lg"
            onPress={() =>
              router.replace(
                joinedHref({ crew_id: data.crew?.id ?? '', roll_id: data.roll?.id ?? null }),
              )
            }
          />
        ) : (
          <Button
            label={joinLabel}
            variant="primary"
            size="lg"
            loading={joining}
            disabled={guestBlocked}
            disabledReason={
              guestBlocked
                ? 'Guests can only join Rolls that allow guests. Sign up with your number to join.'
                : undefined
            }
            onPress={() => void join()}
          />
        )}
        {!isMember ? (
          <View className="mt-1 flex-row justify-between">
            <Button
              label="Decline"
              variant="tertiary"
              onPress={() => {
                usePendingInvite.getState().decline(code);
                usePendingInvite.getState().clear();
              }}
            />
            {session && !isGuest ? (
              <Button
                label="Report"
                variant="tertiary"
                onPress={async () => {
                  try {
                    await rpc('report', {
                      p_target: data.kind === 'roll' ? 'roll' : 'crew',
                      p_target_id: data.roll?.id ?? data.crew?.id,
                      p_reason: 'Reported from an invite preview',
                    });
                    toast.show({ message: "Thanks. We've passed it on for review." });
                  } catch (e) {
                    toast.show({ message: errorCopy(toAppError(e).code).message });
                  }
                }}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

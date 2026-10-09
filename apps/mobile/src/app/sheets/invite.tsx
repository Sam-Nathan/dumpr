import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import type { InviteSettings } from '@/data/types-b';
import { useCrewOverview } from '@/data/useCrew';
import { DEFAULT_INVITE_SETTINGS, useInviteLink } from '@/data/useInvite';
import { useRollHeader } from '@/data/useRoll';
import { QrCode, QrFullScreen, QrSkeletonCard } from '@/features/invites/InviteQr';
import {
  displayLink,
  EXPIRY_OPTIONS,
  expiryLabel,
  linkSettingsSummary,
  shareMessage,
  smsUrl,
  whatsappUrl,
} from '@/features/invites/links';
import { friendlyMessage, toAppError } from '@/lib/errors';
import { pluralize } from '@/lib/format';
import {
  Button,
  EdgeState,
  goBack,
  haptic,
  Icon,
  ListRow,
  ModalSheet,
  PressableScale,
  primerCopy,
  Segmented,
  SheetContent,
  Skeleton,
  Text,
  TINT_BG,
  ToggleRow,
  toast,
  useColors,
} from '@/ui';
import type { IconName } from '@/ui';

function Target({
  label,
  icon,
  bg,
  onPress,
}: {
  label: string;
  icon: IconName;
  bg: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      wrapperStyle={{ alignItems: 'center', flex: 1 }}
    >
      <View className={`h-14 w-14 items-center justify-center rounded-[20px] ${bg}`}>
        <Icon name={icon} size={24} color={colors.ink} />
      </View>
      <Text variant="caption" tone="secondary" className="mt-1 text-[12px]">
        {label}
      </Text>
    </PressableScale>
  );
}

/** B6 Invite sheet: QR in the Crew tint, link pill, WhatsApp first, link settings for hosts. */
export default function InviteSheet() {
  const { crewId, rollId } = useLocalSearchParams<{ crewId?: string; rollId?: string }>();
  const colors = useColors();
  const crew = useCrewOverview(crewId);
  const roll = useRollHeader(rollId);
  const [settings, setSettings] = useState<InviteSettings>(DEFAULT_INVITE_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);

  const isRoll = !!rollId;
  const tint = roll.data?.crew.tint ?? crew.data?.crew.tint ?? 'lilac';
  const name = isRoll ? (roll.data?.roll.name ?? '') : (crew.data?.crew.name ?? '');
  const memberCount = crew.data?.members.length;
  const isAdmin = isRoll ? !!roll.data?.my.is_admin : !!crew.data?.my.is_admin;
  const memberInvitesOff =
    isRoll && !!roll.data && !roll.data.my.is_admin && !roll.data.roll.allow_member_invites;

  const link = useInviteLink(crewId ? { crewId, rollId: rollId ?? null } : null, settings);
  const linkError = link.error ? toAppError(link.error) : null;
  const onlyHosts =
    memberInvitesOff ||
    linkError?.code === 'not_admin' ||
    linkError?.code === 'not_a_member' ||
    linkError?.code === 'guest_not_allowed';

  const url = link.data?.link ?? '';
  const message = name ? shareMessage(name, url, isRoll ? 'roll' : 'crew') : url;

  const copy = async () => {
    if (!url) return;
    try {
      await Clipboard.setStringAsync(url);
      haptic.success();
      toast.show({ message: 'Link copied' });
    } catch {
      toast.show({ message: 'Could not copy. Long-press the link to select it.' });
    }
  };

  const systemShare = async () => {
    try {
      await Share.share({ message });
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    }
  };

  const whatsapp = async () => {
    if (!url) return;
    try {
      await Linking.openURL(whatsappUrl(message));
    } catch {
      await systemShare();
    }
  };

  const sms = async () => {
    if (!url) return;
    try {
      await Linking.openURL(smsUrl(message, Platform.OS));
    } catch {
      await systemShare();
    }
  };

  const loadingLink = link.isPending && !!crewId;
  const reason = loadingLink ? 'Making your link…' : !url ? 'No link yet' : undefined;

  if (!crewId) {
    return (
      <SheetContent title="Invite">
        <EdgeState
          icon="link"
          tone="peach"
          title="Nothing to invite to"
          body="Open an invite from a Crew or a Roll."
          primary={{ label: 'Close', onPress: goBack }}
          primaryVariant="strong"
        />
      </SheetContent>
    );
  }

  if (onlyHosts) {
    return (
      <SheetContent title={name ? `Invite to ${name}` : 'Invite'}>
        <EdgeState
          icon="lock"
          tone={tint}
          title="Only hosts can invite"
          body="The host turned off invite links for members. Ask them to send people in."
          primary={{ label: 'Got it', onPress: goBack }}
          primaryVariant="strong"
        />
      </SheetContent>
    );
  }

  const primer = primerCopy('contacts');

  return (
    <SheetContent
      title={name ? `Invite to ${name}` : 'Invite'}
      right={
        memberCount ? (
          <Text variant="caption" className="pt-2">
            {pluralize(memberCount, 'member')}
          </Text>
        ) : (
          <View />
        )
      }
      footer={
        <View className="gap-1">
          <Button
            label="Share to WhatsApp"
            icon="chat"
            variant="primary"
            size="lg"
            disabled={!url}
            disabledReason={reason}
            onPress={() => void whatsapp()}
          />
          <Button label="Skip for now" variant="tertiary" fullWidth onPress={goBack} />
        </View>
      }
    >
      <View className="gap-4">
        <View className={`flex-row items-center gap-4 rounded-card p-4 ${TINT_BG[tint]}`}>
          {url ? <QrCode value={url} size={112} /> : <QrSkeletonCard size={112} />}
          <View className="flex-1 gap-3">
            <Text variant="body" tone="default" className="font-body-semibold">
              Friends scan to join — with or without the app.
            </Text>
            <Button
              label="Show full screen"
              variant="strong"
              size="sm"
              fullWidth
              disabled={!url}
              onPress={() => setQrOpen(true)}
            />
          </View>
        </View>

        <View className="flex-row items-center rounded-pill border border-line bg-surface py-1.5 pl-4 pr-1.5 dark:border-line-dark dark:bg-surface-dark">
          {url ? (
            <Text
              variant="stamp"
              tone="default"
              className="flex-1 text-[13px] normal-case"
              numberOfLines={1}
              selectable
            >
              {displayLink(url)}
            </Text>
          ) : link.isError ? (
            <Text variant="caption" tone="danger" className="flex-1">
              {friendlyMessage(link.error)}
            </Text>
          ) : (
            <View className="flex-1">
              <Skeleton width="70%" height={16} radius={8} />
            </View>
          )}
          {link.isError ? (
            <Button
              label="Try again"
              size="sm"
              variant="secondary"
              onPress={() => void link.refetch()}
            />
          ) : (
            <Button
              label="Copy"
              size="sm"
              variant="secondary"
              icon="copy"
              disabled={!url}
              onPress={() => void copy()}
            />
          )}
        </View>

        <View className="flex-row">
          <Target
            label="WhatsApp"
            icon="chat"
            bg="bg-[#CFEFD9] dark:bg-[#1F3D2B]"
            onPress={() => void whatsapp()}
          />
          <Target
            label="SMS"
            icon="mail"
            bg="bg-tint-sky dark:bg-tint-sky-dark"
            onPress={() => void sms()}
          />
          <Target
            label="More"
            icon="more"
            bg="bg-ink/[0.07] dark:bg-ink-dark/15"
            onPress={() => void systemShare()}
          />
        </View>

        <View>
          <ListRow
            icon="userPlus"
            title="Find friends in contacts"
            subtitle="Optional · numbers are matched privately, never stored"
            onPress={() => setFriendsOpen(true)}
          />
          {isAdmin ? (
            <>
              <ListRow
                icon="clock"
                title="Link settings"
                subtitle={linkSettingsSummary({
                  ttlDays: settings.ttlDays,
                  requiresApproval: settings.requiresApproval,
                  allowGuests: settings.allowGuests,
                  showGuests: isRoll,
                })}
                divider={!settingsOpen}
                right={
                  <View style={{ transform: [{ rotate: settingsOpen ? '90deg' : '0deg' }] }}>
                    <Icon name="chevronRight" size={18} color={colors.ink} />
                  </View>
                }
                onPress={() => setSettingsOpen((o) => !o)}
              />
              {settingsOpen ? (
                <View className="gap-1 pb-2">
                  <Text variant="caption" className="mb-1.5 mt-2 font-body-semibold">
                    Link expires after
                  </Text>
                  <Segmented
                    accessibilityLabel="Link expiry"
                    options={EXPIRY_OPTIONS.map((d) => ({
                      value: String(d),
                      label: expiryLabel(d),
                    }))}
                    value={String(settings.ttlDays)}
                    onChange={(v) =>
                      setSettings((s) => ({
                        ...s,
                        ttlDays: Number(v) as InviteSettings['ttlDays'],
                      }))
                    }
                  />
                  <ToggleRow
                    title="Host approves new members"
                    subtitle="People who open the link wait for a host to say yes"
                    value={settings.requiresApproval}
                    onValueChange={(v) => setSettings((s) => ({ ...s, requiresApproval: v }))}
                  />
                  {isRoll ? (
                    <ToggleRow
                      title="Guests allowed"
                      subtitle="Anyone with the link can add photos from the web, no app needed"
                      value={settings.allowGuests}
                      onValueChange={(v) => setSettings((s) => ({ ...s, allowGuests: v }))}
                    />
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      <QrFullScreen
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        value={url}
        title={name ? `Join ${name}` : 'Join on Dumpr'}
        tint={tint}
      />
      <ModalSheet
        visible={friendsOpen}
        onClose={() => setFriendsOpen(false)}
        title={primer.title}
        footer={
          <Button
            label="Allow contacts"
            variant="primary"
            size="lg"
            disabled
            disabledReason="Coming soon. Links and QR codes work today."
            onPress={() => undefined}
          />
        }
      >
        <View className="gap-3">
          {primer.bullets.map((b, i) => (
            <View key={i} className="flex-row items-start gap-3">
              <Icon name={b.icon} size={20} color={colors.ink} />
              <Text variant="body" className="flex-1">
                {b.parts.map((p, j) =>
                  typeof p === 'string' ? (
                    p
                  ) : (
                    <Text key={j} variant="body" tone="default" className="font-body-bold">
                      {p.b}
                    </Text>
                  ),
                )}
              </Text>
            </View>
          ))}
        </View>
      </ModalSheet>
    </SheetContent>
  );
}

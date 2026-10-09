import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { View } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { WhoCanAdd } from '@/data/types';
import type { LastHostCrew } from '@/data/types-cf';
import {
  deleteMyAccount,
  exportMyData,
  lastHostCrews,
  useBlockedPeople,
  useHostedRolls,
  useNotificationPrefs,
  usePrivacySettings,
  useSetNotificationPref,
  useUnblock,
  useUpdatePrivacy,
  type ConsentKey,
} from '@/data/usePrivacy';
import { friendlyMessage, toAppError } from '@/lib/errors';
import {
  Avatar,
  BottomModal,
  Button,
  PressableScale,
  Screen,
  SectionLabel,
  SettingsGroup,
  SettingsRow,
  Skeleton,
  Text,
  TextField,
  toast,
  ToggleSwitch,
} from '@/ui';

const WHO_LABEL: Record<WhoCanAdd, string> = {
  everyone: 'Everyone',
  contacts: 'My contacts',
  nobody: 'Nobody',
};
const WHO_HELP: Record<WhoCanAdd, string> = {
  everyone: 'Anyone on Dumpr can add you to a Crew.',
  contacts: 'Only people in your contacts can add you.',
  nobody: 'Nobody can add you. You join through links you accept.',
};

const FACE: { key: ConsentKey; title: string; subtitle: string }[] = [
  {
    key: 'consent_stickers',
    title: 'Friend Stickers',
    subtitle: 'Friends can make stickers of you',
  },
  { key: 'consent_discovery', title: 'Photos of me', subtitle: "Find Crew photos you're in" },
  {
    key: 'consent_then_now',
    title: 'Then vs Now matching',
    subtitle: 'Pair your photos across years',
  },
];

const NOTIFS = [
  { key: 'invites', title: 'Invites and requests', subtitle: 'Straight away' },
  { key: 'chats', title: 'Chats and mentions', subtitle: 'Straight away' },
  {
    key: 'uploads',
    title: 'New photos in your Rolls',
    subtitle: 'Batched hourly, never one per photo',
  },
  { key: 'reveals', title: 'Reveals', subtitle: 'When a Roll opens' },
] as const;

/** F3 Privacy & safety. */
export default function PrivacyScreen() {
  const settings = usePrivacySettings();
  const update = useUpdatePrivacy();
  const prefs = useNotificationPrefs();
  const setPref = useSetNotificationPref();
  const hosted = useHostedRolls();
  const blocked = useBlockedPeople();

  const [whoOpen, setWhoOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const s = settings.data;
  const fail = (e: unknown) => toast.show({ message: friendlyMessage(e) });

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await exportMyData();
      const file = new File(Paths.cache, 'dumpr-export.json');
      file.create({ overwrite: true });
      file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Your Dumpr export',
          UTI: 'public.json',
        });
      } else {
        toast.show({ message: `Export ready: ${data.photos.length} photos` });
      }
      if (data.truncated) {
        toast.show({ message: 'Your export is large, so it lists the first photos only.' });
      }
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen scroll header={{ title: 'Privacy & safety', back: true }}>
      {settings.isLoading ? (
        <View className="mt-4 gap-3">
          <Skeleton height={112} radius={24} />
          <Skeleton height={168} radius={24} />
        </View>
      ) : settings.isError || !s ? (
        <View className="mt-6 items-center gap-3">
          <Text variant="body" className="text-center">
            {friendlyMessage(settings.error)}
          </Text>
          <Button label="Try again" variant="strong" onPress={() => void settings.refetch()} />
        </View>
      ) : (
        <View>
          <SectionLabel>INVITES</SectionLabel>
          <SettingsGroup>
            <SettingsRow
              title="Who can add me to Crews"
              trailing={
                <Text variant="body" tone="secondary">
                  {WHO_LABEL[s.who_can_add]}
                </Text>
              }
              chevron
              onPress={() => setWhoOpen(true)}
            />
            <SettingsRow
              divider
              title="Show my number to Crews"
              trailing={
                <ToggleSwitch
                  label="Show my number to Crews"
                  value={s.phone_visible}
                  onValueChange={(v) => update.mutate({ phone_visible: v }, { onError: fail })}
                />
              }
            />
          </SettingsGroup>

          <SectionLabel>FACE FEATURES · EACH IS YOUR CHOICE</SectionLabel>
          <SettingsGroup>
            {FACE.map((f, i) => (
              <SettingsRow
                key={f.key}
                divider={i > 0}
                title={f.title}
                subtitle={f.subtitle}
                trailing={
                  <ToggleSwitch
                    label={f.title}
                    value={s[f.key]}
                    onValueChange={(v) => update.mutate({ [f.key]: v }, { onError: fail })}
                  />
                }
              />
            ))}
          </SettingsGroup>
          <Text variant="caption" className="mt-2 px-1">
            All off by default. Turning one off deletes the face data it used within 24 hours.
          </Text>

          <SectionLabel>NOTIFICATIONS</SectionLabel>
          <SettingsGroup>
            {NOTIFS.map((n, i) => (
              <SettingsRow
                key={n.key}
                divider={i > 0}
                title={n.title}
                subtitle={n.subtitle}
                trailing={
                  <ToggleSwitch
                    label={n.title}
                    value={prefs.data?.[n.key] ?? true}
                    disabled={prefs.isLoading}
                    onValueChange={(v) => setPref.mutate({ [n.key]: v }, { onError: fail })}
                  />
                }
              />
            ))}
          </SettingsGroup>

          <SectionLabel>ROLLS YOU HOST</SectionLabel>
          {hosted.isLoading ? (
            <Skeleton height={64} radius={24} />
          ) : (hosted.data ?? []).length === 0 ? (
            <Text variant="body" className="px-1">
              You don't host any Rolls yet. Rolls you create or host show up here.
            </Text>
          ) : (
            <SettingsGroup>
              {(hosted.data ?? []).map((r, i) => (
                <SettingsRow
                  key={r.id}
                  divider={i > 0}
                  title={r.name}
                  subtitle={`${r.guests_allowed ? 'Guests upload' : 'Members only'} · uploads ${r.allow_uploads ? 'on' : 'off'} · downloads ${r.allow_downloads ? 'on' : 'off'}`}
                  chevron
                  onPress={() =>
                    router.push({ pathname: '/sheets/roll-settings', params: { rollId: r.id } })
                  }
                />
              ))}
            </SettingsGroup>
          )}

          <SectionLabel>ACCOUNT</SectionLabel>
          <SettingsGroup>
            <SettingsRow
              title="Blocked people"
              trailing={
                <Text variant="body" tone="secondary">
                  {blocked.data ? blocked.data.length : ''}
                </Text>
              }
              chevron
              onPress={() => setBlockedOpen(true)}
            />
            <SettingsRow
              divider
              title="Export everything I've uploaded"
              subtitle={
                exporting
                  ? 'Getting your photos together…'
                  : 'A list of your photos with download links, valid for 24 hours'
              }
              chevron={!exporting}
              disabled={exporting}
              onPress={() => void doExport()}
            />
            <SettingsRow
              divider
              title="Delete account"
              destructive
              onPress={() => setDeleteOpen(true)}
            />
          </SettingsGroup>
        </View>
      )}

      <BottomModal
        visible={whoOpen}
        onClose={() => setWhoOpen(false)}
        title="Who can add me to Crews"
      >
        {(Object.keys(WHO_LABEL) as WhoCanAdd[]).map((k) => (
          <PressableScale
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ selected: s?.who_can_add === k }}
            accessibilityLabel={`${WHO_LABEL[k]}. ${WHO_HELP[k]}`}
            onPress={() => {
              update.mutate({ who_can_add: k }, { onError: fail });
              setWhoOpen(false);
            }}
            haptics={false}
            className="min-h-[60px] flex-row items-center gap-3 py-2"
          >
            <View
              className={`h-7 w-7 items-center justify-center rounded-pill border-2 ${
                s?.who_can_add === k
                  ? 'border-ink bg-ink dark:border-ink-dark dark:bg-ink-dark'
                  : 'border-ink/25 dark:border-ink-dark/30'
              }`}
            >
              {s?.who_can_add === k ? <View className="h-3 w-3 rounded-pill bg-flash" /> : null}
            </View>
            <View className="flex-1">
              <Text variant="heading" tone="default">
                {WHO_LABEL[k]}
              </Text>
              <Text variant="caption">{WHO_HELP[k]}</Text>
            </View>
          </PressableScale>
        ))}
      </BottomModal>

      <BlockedModal visible={blockedOpen} onClose={() => setBlockedOpen(false)} />
      <DeleteModal visible={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </Screen>
  );
}

function BlockedModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const blocked = useBlockedPeople();
  const unblock = useUnblock();
  const list = blocked.data ?? [];
  return (
    <BottomModal visible={visible} onClose={onClose} title="Blocked people">
      {blocked.isLoading ? (
        <Skeleton height={48} />
      ) : list.length === 0 ? (
        <Text variant="body" className="pb-4">
          Nobody is blocked. People you block can't add you to Crews and you won't see their
          activity.
        </Text>
      ) : (
        list.map((b) => (
          <View key={b.blocked_id} className="min-h-[60px] flex-row items-center gap-3">
            <Avatar
              name={b.profile?.display_name ?? 'Someone'}
              avatarKey={b.profile?.avatar_key}
              ring={b.profile?.ring_color ?? 'none'}
              size={40}
            />
            <Text variant="body" tone="default" className="flex-1 font-body-semibold">
              {b.profile?.display_name ?? 'Someone you blocked'}
            </Text>
            <Button
              label="Unblock"
              variant="secondary"
              size="sm"
              loading={unblock.isPending && unblock.variables === b.blocked_id}
              onPress={() =>
                unblock.mutate(b.blocked_id, {
                  onError: (e) => toast.show({ message: friendlyMessage(e) }),
                })
              }
            />
          </View>
        ))
      )}
    </BottomModal>
  );
}

function DeleteModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [crews, setCrews] = useState<LastHostCrew[]>([]);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setTyped('');
    setCrews([]);
    setError(null);
    onClose();
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount();
      qc.clear();
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    } catch (e) {
      const list = lastHostCrews(e);
      if (list.length > 0) setCrews(list);
      else
        setError(
          toAppError(e).code === 'network'
            ? friendlyMessage(e)
            : "We couldn't delete your account. Nothing was changed; try again.",
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomModal
      visible={visible}
      onClose={close}
      title="Delete your account?"
      footer={
        crews.length === 0 ? (
          <Button
            label="Delete my account"
            variant="destructive"
            size="lg"
            loading={busy}
            disabled={typed.trim() !== 'DELETE'}
            disabledReason="Type DELETE to confirm"
            onPress={() => void run()}
          />
        ) : undefined
      }
    >
      {crews.length > 0 ? (
        <View className="pb-2">
          <Text variant="body" tone="default" className="mb-1 font-body-semibold">
            Make someone else host first
          </Text>
          <Text variant="body" className="mb-3">
            You're the only host of these Crews. Hand over hosting, then come back to delete.
          </Text>
          <SettingsGroup>
            {crews.map((c, i) => (
              <SettingsRow
                key={c.id}
                divider={i > 0}
                title={c.name}
                chevron
                onPress={() => {
                  close();
                  router.push(`/crew/${c.id}`);
                }}
              />
            ))}
          </SettingsGroup>
        </View>
      ) : (
        <View className="gap-3 pb-1">
          <Text variant="body">
            Your photos are removed from every Roll, your profile is deleted and you're signed out.
            People in your Crews keep their own photos. This can't be undone.
          </Text>
          <TextField
            label="Type DELETE to confirm"
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            error={error}
          />
        </View>
      )}
    </BottomModal>
  );
}

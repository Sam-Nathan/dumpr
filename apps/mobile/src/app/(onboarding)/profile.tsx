import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfile, useUpdateProfile } from '@/data/profile';
import { rpc } from '@/data/rpc';
import { type CheckHandleResult, RING_COLORS, type RingColor } from '@/data/types';
import { signOut } from '@/features/auth/phone';
import { usePendingInvite } from '@/features/invites/pendingInvite';
import { errorCopy, toAppError } from '@/lib/errors';
import { daysInMonth, formatBirthday, monthLong } from '@/lib/format';
import { cleanHandle, handleFromName, isValidHandle } from '@/lib/handle';
import {
  Avatar,
  Button,
  Chip,
  haptic,
  Icon,
  IconButton,
  INK,
  PressableScale,
  RING_HEX,
  Screen,
  Text,
  TextField,
  useColors,
} from '@/ui';

type HandleStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken'; suggestions: string[] }
  | { kind: 'invalid' }
  | { kind: 'error' };

const DEFAULT_NAMES = new Set(['new user', 'guest']);

/** Live handle availability through `check_handle` with a 300 ms debounce; stale answers ignored. */
function useHandleCheck(handle: string, current: string | null | undefined): HandleStatus {
  const [status, setStatus] = useState<HandleStatus>({ kind: 'idle' });
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (!handle) return setStatus({ kind: 'idle' });
    if (!isValidHandle(handle)) return setStatus({ kind: 'invalid' });
    if (current && handle === current.toLowerCase()) return setStatus({ kind: 'available' });
    setStatus({ kind: 'checking' });
    const t = setTimeout(async () => {
      try {
        const r = await rpc<CheckHandleResult>('check_handle', { p_handle: handle });
        if (id !== seq.current) return;
        setStatus(r.available ? { kind: 'available' } : { kind: 'taken', suggestions: (r.suggestions ?? []).slice(0, 3) });
      } catch {
        if (id === seq.current) setStatus({ kind: 'error' });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [handle, current]);
  return status;
}

/**
 * A3 Profile setup (STEP 2 OF 2). Avatar (camera / gallery / initials), ring colour, name, @handle
 * with live availability + 3 suggestions when taken, optional birthday (day + month).
 *
 * TODO(avatar upload): the picked photo is previewed only; `avatar_key` stays null until an avatar
 * upload path exists (needs an `a/{user}/{uuid}.jpg` presign from the functions builder).
 */
export default function ProfileSetup() {
  const profile = useProfile();
  const update = useUpdateProfile();
  const pending = usePendingInvite((s) => s.pending);
  const colors = useColors();

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [ring, setRing] = useState<RingColor>('lime');
  const [photo, setPhoto] = useState<string | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const seeded = useRef(false);

  // Seed from the profile once (Apple/Google give a name; the trigger defaults to "New user").
  useEffect(() => {
    const p = profile.data;
    if (!p || seeded.current) return;
    seeded.current = true;
    const n = DEFAULT_NAMES.has(p.display_name.trim().toLowerCase()) ? '' : p.display_name;
    setName(n);
    if (p.handle) {
      setHandle(p.handle);
      setHandleTouched(true);
    }
    setRing(p.ring_color ?? 'lime');
    setDay(p.birthday_day);
    setMonth(p.birthday_month);
  }, [profile.data]);

  // Suggest a handle from the name until the person edits it.
  useEffect(() => {
    if (!handleTouched) setHandle(handleFromName(name));
  }, [name, handleTouched]);

  const status = useHandleCheck(handle, profile.data?.handle);
  const nameOk = name.trim().length >= 1 && name.trim().length <= 40;
  const canContinue = nameOk && status.kind === 'available';

  const reason = !nameOk
    ? 'Add the name your Crew knows you by'
    : status.kind === 'checking'
      ? 'Checking your username…'
      : status.kind === 'taken'
        ? 'Pick a username that is free'
        : status.kind === 'invalid' || status.kind === 'idle'
          ? 'Choose a username (3–24 letters, numbers, . or _)'
          : status.kind === 'error'
            ? "We couldn't check the username. Try again."
            : undefined;

  const pickPhoto = () => {
    const fromCamera = async () => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
      const r = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (!r.canceled && r.assets[0]) setPhoto(r.assets[0].uri);
    };
    const fromGallery = async () => {
      // The system photo picker needs no library permission.
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!r.canceled && r.assets[0]) setPhoto(r.assets[0].uri);
    };
    Alert.alert('Profile photo', undefined, [
      { text: 'Take a photo', onPress: () => void fromCamera().catch(() => undefined) },
      { text: 'Choose from gallery', onPress: () => void fromGallery().catch(() => undefined) },
      { text: 'Use my initials', onPress: () => setPhoto(null) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submit = async () => {
    if (!canContinue) return;
    setSubmitError(null);
    try {
      if (pending) usePendingInvite.getState().setAutoJoin(true);
      await update.mutateAsync({
        display_name: name.trim(),
        handle,
        ring_color: ring,
        birthday_day: day && month ? day : null,
        birthday_month: day && month ? month : null,
        // avatar_key: null — see TODO(avatar upload) above.
      });
      haptic.success();
      // The root gate now sees a complete profile and moves on (Home, or A4 for a pending invite).
    } catch (e) {
      const err = toAppError(e);
      setSubmitError(
        err.code === 'handle_taken' ? 'Someone grabbed that username a moment ago. Pick another.' : errorCopy(err.code).message,
      );
    }
  };

  const handleRight =
    status.kind === 'checking' ? (
      <ActivityIndicator size="small" color={colors.ink3} />
    ) : status.kind === 'available' ? (
      <View className="flex-row items-center gap-1" accessibilityLiveRegion="polite">
        <Icon name="check" size={16} color={colors.ink === INK ? '#2F6B12' : '#D4FF3F'} />
        <Text variant="caption" tone="success" className="font-body-semibold">
          Available
        </Text>
      </View>
    ) : status.kind === 'taken' ? (
      <Text variant="caption" tone="danger" className="font-body-semibold" accessibilityLiveRegion="polite">
        Taken
      </Text>
    ) : null;

  return (
    <Screen
      scroll
      header={{
        right: (
          <Text variant="stamp" tone="tertiary" className="text-[11px]">
            STEP 2 OF 2
          </Text>
        ),
      }}
      footer={
        <View className="gap-3">
          {pending ? (
            <View className="flex-row items-center gap-3 rounded-card bg-tint-lime p-4 dark:bg-tint-lime-dark">
              <Icon name="link" size={20} color={colors.ink} />
              <Text variant="body" tone="default" className="flex-1">
                {pending.hostName ? <Text variant="body" tone="default" className="font-body-bold">{pending.hostName}</Text> : 'Someone'}
                {' invited you to '}
                <Text variant="body" tone="default" className="font-body-bold">
                  {pending.title ?? 'a Roll'}
                </Text>
                . You&rsquo;ll land there next.
              </Text>
            </View>
          ) : null}
          {submitError ? (
            <Text variant="caption" tone="danger" className="text-center" accessibilityLiveRegion="polite">
              {submitError}
            </Text>
          ) : null}
          <Button
            label="Continue"
            variant="primary"
            size="lg"
            loading={update.isPending}
            disabled={!canContinue}
            disabledReason={reason}
            onPress={() => void submit()}
          />
        </View>
      }
    >
      <Text variant="title" heading className="mt-2 text-[32px] leading-[35px]">
        How should your Crew see you?
      </Text>

      <View className="mt-6 flex-row items-center gap-5">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Profile photo"
          accessibilityHint="Take a photo, choose one, or use your initials"
          onPress={pickPhoto}
        >
          <Avatar
            name={name || '?'}
            uri={photo}
            size={104}
            ring={ring}
            badge={
              <View className="h-9 w-9 items-center justify-center rounded-pill border-2 border-paper bg-ink dark:border-paper-dark">
                <Icon name="camera" size={16} color="#F4F3F6" />
              </View>
            }
          />
        </PressableScale>
        <View className="flex-1">
          <Text variant="caption" tone="secondary" className="mb-2 font-body-semibold">
            Your ring colour
          </Text>
          <View className="flex-row gap-2" accessibilityRole="radiogroup">
            {RING_COLORS.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="radio"
                accessibilityLabel={c}
                accessibilityState={{ selected: ring === c, checked: ring === c }}
                onPress={() => {
                  haptic.select();
                  setRing(c);
                }}
                hitSlop={4}
                className="h-11 w-11 items-center justify-center rounded-pill"
                style={{ borderWidth: ring === c ? 2 : 0, borderColor: colors.ink }}
              >
                <View className="h-9 w-9 rounded-pill" style={{ backgroundColor: RING_HEX[c] }} />
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <View className="mt-6 gap-4">
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Meera Iyer"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          maxLength={40}
          returnKeyType="next"
        />
        <View>
          <TextField
            label="Username"
            value={handle}
            onChangeText={(t) => {
              setHandleTouched(true);
              setHandle(cleanHandle(t));
            }}
            left={
              <Text variant="body" tone="tertiary" className="font-body-semibold text-[16px]">
                @
              </Text>
            }
            right={handleRight}
            placeholder="meera.clicks"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            maxLength={24}
            error={
              status.kind === 'invalid' && handle.length > 0
                ? '3–24 characters: letters, numbers, dots or underscores.'
                : status.kind === 'error'
                  ? "We couldn't check right now. Keep typing or try again."
                  : null
            }
          />
          {status.kind === 'taken' && status.suggestions.length > 0 ? (
            <View className="mt-2">
              <Text variant="caption" className="mb-1.5">
                Someone already has @{handle}. These are free:
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {status.suggestions.map((s) => (
                  <Chip
                    key={s}
                    label={`@${s}`}
                    onPress={() => {
                      setHandleTouched(true);
                      setHandle(s);
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>

        <View>
          <Text variant="caption" tone="secondary" className="mb-1.5 font-body-semibold">
            Birthday <Text variant="caption">· optional</Text>
          </Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={day && month ? `Birthday ${formatBirthday(day, month)}. Change` : 'Add birthday'}
            onPress={() => setBirthdayOpen(true)}
            haptics={false}
            className="min-h-[52px] flex-row items-center justify-between rounded-input border border-line bg-surface px-4 dark:border-line-dark dark:bg-surface-dark"
          >
            <Text variant="body" tone={day && month ? 'default' : 'tertiary'} className="text-[16px]">
              {day && month ? formatBirthday(day, month) : 'Add day and month'}
            </Text>
            {day && month ? (
              <IconButton
                icon="close"
                label="Remove birthday"
                variant="ghost"
                size={32}
                onPress={() => {
                  setDay(null);
                  setMonth(null);
                }}
              />
            ) : (
              <Icon name="chevronDown" size={18} color={colors.ink3} />
            )}
          </PressableScale>
          <Text variant="caption" className="mt-1.5">
            Only day and month. Lets friends plan a Surprise Roll for you.
          </Text>
        </View>

        <View className="items-center">
          <Button label="Not you? Use another account" variant="tertiary" size="sm" onPress={() => void signOut()} />
        </View>
      </View>

      <BirthdayPicker
        visible={birthdayOpen}
        day={day}
        month={month}
        onClose={() => setBirthdayOpen(false)}
        onPick={(d, m) => {
          setDay(d);
          setMonth(m);
          setBirthdayOpen(false);
        }}
      />
    </Screen>
  );
}

function BirthdayPicker({
  visible,
  day,
  month,
  onPick,
  onClose,
}: {
  visible: boolean;
  day: number | null;
  month: number | null;
  onPick: (day: number, month: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [m, setM] = useState<number>(month ?? 1);
  const [d, setD] = useState<number | null>(day);
  useEffect(() => {
    if (visible) {
      setM(month ?? 1);
      setD(day);
    }
  }, [visible, day, month]);
  const days = useMemo(() => Array.from({ length: daysInMonth(m) }, (_, i) => i + 1), [m]);
  const dayValid = d !== null && d <= daysInMonth(m);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" accessibilityLabel="Close" onPress={onClose} />
        <View
          className="rounded-t-sheet bg-paper px-5 pt-4 dark:bg-paper-dark"
          style={{ paddingBottom: Math.max(insets.bottom, 16), maxHeight: '85%' }}
        >
          <View className="mb-3 flex-row items-center justify-between">
            <Text variant="title" heading>
              Your birthday
            </Text>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text variant="caption" tone="secondary" className="mb-2 font-body-semibold">
              Month
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
                <Chip key={mm} label={monthLong(mm - 1).slice(0, 3)} selected={m === mm} onPress={() => setM(mm)} accessibilityLabel={monthLong(mm - 1)} />
              ))}
            </View>
            <Text variant="caption" tone="secondary" className="mb-2 mt-4 font-body-semibold">
              Day
            </Text>
            <View className="flex-row flex-wrap gap-1.5">
              {days.map((dd) => (
                <Pressable
                  key={dd}
                  accessibilityRole="button"
                  accessibilityLabel={`${dd}`}
                  accessibilityState={{ selected: d === dd }}
                  onPress={() => setD(dd)}
                  className={`h-11 w-11 items-center justify-center rounded-pill ${d === dd ? 'bg-ink dark:bg-ink-dark' : ''}`}
                >
                  <Text variant="body" tone={d === dd ? 'inverse' : 'default'} className={d === dd ? 'dark:text-ink' : ''}>
                    {dd}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <View className="mt-4">
            <Button
              label={dayValid ? `Save ${formatBirthday(d, m)}` : 'Save'}
              variant="strong"
              size="lg"
              disabled={!dayValid}
              disabledReason="Pick a day"
              onPress={() => d && onPick(d, m)}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

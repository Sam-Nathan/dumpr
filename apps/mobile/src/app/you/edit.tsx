import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useProfile, useUpdateProfile } from '@/data/profile';
import { RING_COLORS, type RingColor } from '@/data/types';
import { BirthdayPicker } from '@/features/you/BirthdayPicker';
import { useHandleCheck } from '@/features/you/useHandleCheck';
import { errorCopy, toAppError } from '@/lib/errors';
import { formatBirthday } from '@/lib/format';
import { cleanHandle } from '@/lib/handle';
import {
  Avatar,
  Button,
  Chip,
  goBack,
  haptic,
  Icon,
  IconButton,
  INK,
  PressableScale,
  RING_HEX,
  Screen,
  Skeleton,
  Text,
  TextField,
  toast,
  useColors,
} from '@/ui';

/** Edit profile: name, @handle (live check), ring colour, birthday. */
export default function EditProfile() {
  const profile = useProfile();
  const update = useUpdateProfile();
  const colors = useColors();
  const p = profile.data;

  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [ring, setRing] = useState<RingColor>('lime');
  const [day, setDay] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (!p || seeded.current) return;
    seeded.current = true;
    setName(p.display_name);
    setHandle(p.handle ?? '');
    setRing(p.ring_color ?? 'lime');
    setDay(p.birthday_day);
    setMonth(p.birthday_month);
  }, [p]);

  const status = useHandleCheck(handle, p?.handle);
  const nameOk = name.trim().length >= 1 && name.trim().length <= 40;
  const dirty =
    !!p &&
    (name.trim() !== p.display_name ||
      handle !== (p.handle ?? '') ||
      ring !== p.ring_color ||
      (day ?? null) !== p.birthday_day ||
      (month ?? null) !== p.birthday_month);
  const canSave = dirty && nameOk && status.kind === 'available';
  const reason = !dirty
    ? 'Change something to save'
    : !nameOk
      ? 'Add the name your Crew knows you by'
      : status.kind === 'checking'
        ? 'Checking your username…'
        : status.kind === 'taken'
          ? 'Pick a username that is free'
          : status.kind === 'error'
            ? "We couldn't check the username. Try again."
            : 'Choose a username (3–24 letters, numbers, . or _)';

  const save = async () => {
    setSubmitError(null);
    try {
      await update.mutateAsync({
        display_name: name.trim(),
        handle,
        ring_color: ring,
        birthday_day: day && month ? day : null,
        birthday_month: day && month ? month : null,
      });
      haptic.success();
      toast.show({ message: 'Profile saved' });
      goBack();
    } catch (e) {
      const err = toAppError(e);
      setSubmitError(
        err.code === 'handle_taken'
          ? 'Someone grabbed that username a moment ago. Pick another.'
          : errorCopy(err.code).message,
      );
    }
  };

  return (
    <Screen
      scroll
      header={{ title: 'Edit profile', back: true }}
      footer={
        <View className="gap-2">
          {submitError ? (
            <Text
              variant="caption"
              tone="danger"
              className="text-center"
              accessibilityLiveRegion="polite"
            >
              {submitError}
            </Text>
          ) : null}
          <Button
            label="Save"
            variant="primary"
            size="lg"
            loading={update.isPending}
            disabled={!canSave}
            disabledReason={reason}
            onPress={() => void save()}
          />
        </View>
      }
    >
      {!p ? (
        <View className="mt-4 gap-4">
          <Skeleton width={96} height={96} radius={48} />
          <Skeleton height={52} radius={14} />
          <Skeleton height={52} radius={14} />
        </View>
      ) : (
        <View className="mt-3 gap-5">
          <View className="flex-row items-center gap-5">
            <Avatar name={name || '?'} avatarKey={p.avatar_key} size={96} ring={ring} />
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
                    <View
                      className="h-9 w-9 rounded-pill"
                      style={{ backgroundColor: RING_HEX[c] }}
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            maxLength={40}
          />

          <View>
            <TextField
              label="Username"
              value={handle}
              onChangeText={(t) => setHandle(cleanHandle(t))}
              left={
                <Text variant="body" tone="tertiary" className="font-body-semibold text-[16px]">
                  @
                </Text>
              }
              right={
                status.kind === 'checking' ? (
                  <ActivityIndicator size="small" color={colors.ink3} />
                ) : status.kind === 'available' ? (
                  <View className="flex-row items-center gap-1" accessibilityLiveRegion="polite">
                    <Icon
                      name="check"
                      size={16}
                      color={colors.ink === INK ? '#2F6B12' : '#D4FF3F'}
                    />
                    <Text variant="caption" tone="success" className="font-body-semibold">
                      Available
                    </Text>
                  </View>
                ) : status.kind === 'taken' ? (
                  <Text variant="caption" tone="danger" className="font-body-semibold">
                    Taken
                  </Text>
                ) : null
              }
              autoCapitalize="none"
              autoCorrect={false}
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
                    <Chip key={s} label={`@${s}`} onPress={() => setHandle(s)} />
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
              accessibilityLabel={
                day && month ? `Birthday ${formatBirthday(day, month)}. Change` : 'Add birthday'
              }
              onPress={() => setBirthdayOpen(true)}
              haptics={false}
              className="min-h-[52px] flex-row items-center justify-between rounded-input border border-line bg-surface px-4 dark:border-line-dark dark:bg-surface-dark"
            >
              <Text
                variant="body"
                tone={day && month ? 'default' : 'tertiary'}
                className="text-[16px]"
              >
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
        </View>
      )}

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

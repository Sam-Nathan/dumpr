import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { invalidateRoll, rollHeaderKey, updateRoll, useRollHeader } from '@/data/useRoll';
import type { RollHeader } from '@/data/types-b';
import type { RollSettingsPatch } from '@/data/useRoll';
import { DateRangeModal } from '@/features/rolls/DateRangeModal';
import { friendlyMessage, toAppError } from '@/lib/errors';
import { formatDateRange } from '@/lib/format';
import {
  Button,
  EdgeState,
  goBack,
  ListRow,
  SheetContent,
  Skeleton,
  Text,
  TextField,
  ToggleRow,
  toast,
} from '@/ui';

type Flag =
  | 'allow_uploads'
  | 'allow_downloads'
  | 'allow_member_invites'
  | 'guests_allowed'
  | 'guest_uploads_review';

/** Roll settings (hosts): switches save at once, name and dates save with the button. */
export default function RollSettingsSheet() {
  const { rollId } = useLocalSearchParams<{ rollId?: string }>();
  const qc = useQueryClient();
  const q = useRollHeader(rollId);
  const h = q.data;
  const [name, setName] = useState('');
  const [dates, setDates] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const [datesOpen, setDatesOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!h) return;
    setName(h.roll.name);
    setDates({ start: h.roll.starts_on, end: h.roll.ends_on });
  }, [h?.roll.id]);

  if (!rollId || (q.isError && !h)) {
    const code = q.error ? toAppError(q.error).code : 'not_found';
    return (
      <SheetContent title="Roll settings">
        <EdgeState
          icon="info"
          tone="sky"
          title={code === 'not_a_member' ? "You're not in this Roll" : 'Settings did not load'}
          body="Check your connection and try again."
          primary={{ label: 'Close', onPress: goBack }}
          primaryVariant="strong"
        />
      </SheetContent>
    );
  }
  if (!h) {
    return (
      <SheetContent title="Roll settings">
        <View className="gap-3">
          <Skeleton height={52} radius={14} />
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      </SheetContent>
    );
  }
  if (!h.my.is_admin) {
    return (
      <SheetContent title="Roll settings">
        <EdgeState
          icon="lock"
          tone="lilac"
          title="Only hosts can do that"
          body="Ask a host of this Crew or Roll to change these settings."
          primary={{ label: 'Close', onPress: goBack }}
          primaryVariant="strong"
        />
      </SheetContent>
    );
  }

  const trimmed = name.trim();
  const datesChanged = dates.start !== h.roll.starts_on || dates.end !== h.roll.ends_on;
  const changed = trimmed !== h.roll.name || datesChanged;
  const valid = trimmed.length >= 1 && trimmed.length <= 60;

  const setFlag = async (flag: Flag, value: boolean) => {
    const key = rollHeaderKey(rollId);
    const before = qc.getQueryData<RollHeader>(key);
    if (before)
      qc.setQueryData<RollHeader>(key, { ...before, roll: { ...before.roll, [flag]: value } });
    try {
      await updateRoll(rollId, { [flag]: value } as RollSettingsPatch);
      invalidateRoll(qc, rollId, h.roll.crew_id);
    } catch (e) {
      if (before) qc.setQueryData<RollHeader>(key, before);
      toast.show({ message: friendlyMessage(e) });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const patch: RollSettingsPatch = {};
      if (trimmed !== h.roll.name) patch.name = trimmed;
      if (datesChanged) {
        patch.starts_on = dates.start;
        patch.ends_on = dates.end ?? dates.start;
      }
      await updateRoll(rollId, patch);
      invalidateRoll(qc, rollId, h.roll.crew_id);
      toast.show({ message: 'Saved' });
      goBack();
    } catch (e) {
      toast.show({ message: friendlyMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const r = h.roll;
  return (
    <SheetContent
      title="Roll settings"
      eyebrow={h.crew.name.toUpperCase()}
      footer={
        <Button
          label="Save changes"
          variant="primary"
          size="lg"
          loading={saving}
          disabled={!changed || !valid}
          disabledReason={!valid ? 'Give the Roll a name' : 'Change the name or dates to save'}
          onPress={() => void save()}
        />
      }
    >
      <View className="gap-1">
        <TextField
          label="Roll name"
          value={name}
          onChangeText={setName}
          maxLength={60}
          returnKeyType="done"
        />
        <ListRow
          title="Dates"
          onPress={() => setDatesOpen(true)}
          right={
            <Text variant="stamp" tone="default" className="text-[13px]">
              {dates.start
                ? formatDateRange(dates.start, dates.end ?? dates.start).toUpperCase()
                : 'ADD DATES'}
            </Text>
          }
        />
        <Text variant="stamp" tone="tertiary" className="mb-1 mt-3 text-[11px]">
          WHO CAN DO WHAT
        </Text>
        <ToggleRow
          title="Uploads"
          subtitle="Members can add photos"
          value={r.allow_uploads}
          onValueChange={(v) => void setFlag('allow_uploads', v)}
        />
        <ToggleRow
          title="Downloads"
          subtitle="Members can save original photos"
          value={r.allow_downloads}
          onValueChange={(v) => void setFlag('allow_downloads', v)}
        />
        <ToggleRow
          title="Member invites"
          subtitle="Members can share the invite link"
          value={r.allow_member_invites}
          onValueChange={(v) => void setFlag('allow_member_invites', v)}
        />
        <ToggleRow
          title="Guests allowed"
          subtitle="People with the link can add photos from the web"
          value={r.guests_allowed}
          onValueChange={(v) => void setFlag('guests_allowed', v)}
        />
        <ToggleRow
          title="Review guest photos"
          subtitle="Guest photos wait for a host to approve them"
          value={r.guest_uploads_review}
          disabled={!r.guests_allowed}
          disabledReason="Turn on guests first"
          onValueChange={(v) => void setFlag('guest_uploads_review', v)}
        />
      </View>
      <DateRangeModal
        visible={datesOpen}
        onClose={() => setDatesOpen(false)}
        value={dates}
        onApply={setDates}
      />
    </SheetContent>
  );
}

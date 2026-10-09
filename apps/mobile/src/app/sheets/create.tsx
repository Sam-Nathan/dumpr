import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSession } from '@/data/session';
import type { CrewTint } from '@/data/types';
import { createCrew, createRoll } from '@/data/useCrew';
import { prefetchInviteLink } from '@/data/useInvite';
import { homeFeedKey, useHomeFeed } from '@/data/useHome';
import { TintPicker } from '@/features/crews/CrewSettingsModal';
import { DateRangeModal, type DateRange } from '@/features/rolls/DateRangeModal';
import {
  chapterPresets,
  dayCount,
  ROLL_TYPE_CHIPS,
  rollKindFor,
  suggestRollNames,
  type RollTypeChip,
} from '@/features/rolls/names';
import { friendlyMessage, toAppError } from '@/lib/errors';
import { formatDateRange } from '@/lib/format';
import {
  Button,
  Chip,
  EdgeState,
  edge,
  haptic,
  Icon,
  ListRow,
  ModalSheet,
  PressableScale,
  Segmented,
  SheetContent,
  Text,
  TextField,
  TINT_BG,
  ToggleRow,
  toast,
  useColors,
} from '@/ui';

type Tab = 'crew' | 'roll';

const CREW_IDEAS = ['Friends', 'Family', 'Flatmates', 'Office'];

/** B5 Create Crew / Roll sheet. Primary: Create & invite. Secondary: Create only. */
export default function CreateSheet() {
  const params = useLocalSearchParams<{ kind?: string; crewId?: string }>();
  const qc = useQueryClient();
  const { isGuest } = useSession();
  const colors = useColors();
  const feed = useHomeFeed();
  const crews = useMemo(() => (feed.data?.crews ?? []).filter((c) => !c.deleted_at), [feed.data]);

  const [tab, setTab] = useState<Tab>(params.kind === 'roll' ? 'roll' : 'crew');
  const [busy, setBusy] = useState<'invite' | 'only' | null>(null);

  // Crew
  const [crewName, setCrewName] = useState('');
  const [tint, setTint] = useState<CrewTint>('lilac');

  // Roll
  const [rollName, setRollName] = useState('');
  const [typeChip, setTypeChip] = useState<RollTypeChip>('casual');
  const [crewId, setCrewId] = useState<string | null>(params.crewId ?? null);
  const [dates, setDates] = useState<DateRange>({ start: null, end: null });
  const [datesOpen, setDatesOpen] = useState(false);
  const [crewPickerOpen, setCrewPickerOpen] = useState(false);
  const [chaptersOn, setChaptersOn] = useState(false);
  const [chapters, setChapters] = useState<string[]>([]);
  const [chaptersEdited, setChaptersEdited] = useState(false);
  const [newChapter, setNewChapter] = useState('');

  useEffect(() => {
    if (crewId || crews.length === 0) return;
    setCrewId((crews.find((c) => c.live_roll) ?? crews[0])?.id ?? null);
  }, [crews, crewId]);

  const days = dayCount(dates.start, dates.end);
  useEffect(() => {
    if (chaptersEdited) return;
    setChapters(chapterPresets(typeChip, days));
  }, [typeChip, days, chaptersEdited]);

  const suggestions = useMemo(
    () => suggestRollNames({ start: dates.start, end: dates.end }),
    [dates.start, dates.end],
  );
  const pickedCrew = crews.find((c) => c.id === crewId) ?? null;

  const pickType = (t: RollTypeChip) => {
    setTypeChip(t);
    if (!chaptersEdited) setChaptersOn(chapterPresets(t, days).length > 0);
  };

  const name = (tab === 'crew' ? crewName : rollName).trim();
  const rollBlocked = tab === 'roll' && !pickedCrew;
  const disabledReason =
    name.length === 0
      ? tab === 'crew'
        ? 'Name your Crew first'
        : 'Name your Roll first'
      : rollBlocked
        ? 'Pick a Crew for this Roll'
        : undefined;
  const disabled = !!disabledReason;

  const submit = async (invite: boolean) => {
    if (disabled || busy) return;
    setBusy(invite ? 'invite' : 'only');
    try {
      if (tab === 'crew') {
        const crew = await createCrew(name, tint);
        void qc.invalidateQueries({ queryKey: homeFeedKey });
        haptic.success();
        if (invite) prefetchInviteLink(qc, { crewId: crew.id });
        router.dismiss();
        router.push(`/crew/${crew.id}`);
        if (invite) router.push({ pathname: '/sheets/invite', params: { crewId: crew.id } });
      } else if (pickedCrew) {
        const roll = await createRoll({
          crewId: pickedCrew.id,
          name,
          kind: rollKindFor(typeChip),
          startsOn: dates.start,
          endsOn: dates.end ?? dates.start,
          chapters: chaptersOn ? chapters : [],
        });
        void qc.invalidateQueries({ queryKey: homeFeedKey });
        void qc.invalidateQueries({ queryKey: ['crew', pickedCrew.id] });
        haptic.success();
        if (invite) prefetchInviteLink(qc, { crewId: pickedCrew.id, rollId: roll.id });
        router.dismiss();
        router.push(`/roll/${roll.id}`);
        if (invite) {
          router.push({
            pathname: '/sheets/invite',
            params: { crewId: pickedCrew.id, rollId: roll.id },
          });
        }
      }
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'network' || err.code === 'timeout') {
        toast.show({
          message: "You're offline. Nothing was created yet.",
          action: { label: 'Retry', onPress: () => void submit(invite) },
        });
      } else {
        toast.show({ message: friendlyMessage(e) });
      }
    } finally {
      setBusy(null);
    }
  };

  const addChapter = () => {
    const c = newChapter.trim();
    if (!c || chapters.length >= 30 || chapters.some((x) => x.toLowerCase() === c.toLowerCase())) {
      setNewChapter('');
      return;
    }
    setChaptersEdited(true);
    setChapters((cs) => [...cs, c.slice(0, 40)]);
    setNewChapter('');
  };

  if (isGuest) {
    const c = edge.fromError({ code: 'guest_not_allowed' });
    return (
      <SheetContent title="New">
        <EdgeState
          icon="user"
          tone="lilac"
          title={c.title}
          body={c.body}
          primary={{ label: 'Close', onPress: () => router.dismiss() }}
          primaryVariant="strong"
        />
      </SheetContent>
    );
  }

  return (
    <SheetContent
      title={tab === 'crew' ? 'New Crew' : 'New Roll'}
      closeButton={false}
      right={
        <View style={{ width: 168 }}>
          <Segmented
            accessibilityLabel="What to create"
            options={[
              { value: 'crew', label: 'Crew' },
              { value: 'roll', label: 'Roll' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>
      }
      footer={
        <View className="gap-1">
          <Button
            label="Create & invite"
            variant="primary"
            size="lg"
            loading={busy === 'invite'}
            disabled={disabled || busy === 'only'}
            disabledReason={disabledReason}
            onPress={() => void submit(true)}
          />
          <Button
            label="Create only"
            variant="tertiary"
            fullWidth
            disabled={disabled || busy === 'invite'}
            loading={busy === 'only'}
            onPress={() => void submit(false)}
          />
        </View>
      }
    >
      <View className="gap-4">
        <View className="flex-row items-end gap-3">
          <View
            accessibilityLabel="Cover: picked automatically from your first photos"
            className="h-[64px] w-[64px] items-center justify-center rounded-card border border-dashed border-ink/30 dark:border-ink-dark/30"
          >
            <Icon name="image" size={24} color={colors.ink3} />
          </View>
          <View className="flex-1">
            <TextField
              label={tab === 'crew' ? 'CREW NAME' : 'ROLL NAME'}
              value={tab === 'crew' ? crewName : rollName}
              onChangeText={tab === 'crew' ? setCrewName : setRollName}
              placeholder={tab === 'crew' ? 'Goa Gang' : (suggestions[0] ?? 'Weekend')}
              maxLength={60}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>
        </View>
        <Text variant="caption" className="-mt-2">
          Cover is picked automatically from your first photos.
        </Text>

        <View className="flex-row flex-wrap gap-2">
          {(tab === 'crew' ? CREW_IDEAS : suggestions).map((s) => (
            <Chip
              key={s}
              label={s}
              selected={name === s}
              onPress={() => (tab === 'crew' ? setCrewName(s) : setRollName(s))}
            />
          ))}
        </View>

        {tab === 'crew' ? (
          <View>
            <Text variant="caption" className="mb-2 font-body-semibold">
              Tint
            </Text>
            <TintPicker value={tint} onChange={setTint} />
          </View>
        ) : (
          <>
            <View className="flex-row flex-wrap gap-2">
              {ROLL_TYPE_CHIPS.map((t) => (
                <Chip key={t.id} label={t.label} selected={typeChip === t.id} onPress={() => pickType(t.id)} />
              ))}
            </View>

            {crews.length === 0 ? (
              <EdgeState
                icon="users"
                tone="lilac"
                title="Make a Crew first"
                body="Rolls live inside a Crew, so your people can see and add to them."
                primary={{ label: 'Create a Crew', onPress: () => setTab('crew') }}
                primaryVariant="strong"
              />
            ) : (
              <View>
                <ListRow
                  title="In Crew"
                  onPress={() => setCrewPickerOpen(true)}
                  right={
                    <View
                      className={`flex-row items-center gap-1.5 rounded-pill px-3.5 py-2 ${
                        pickedCrew ? TINT_BG[pickedCrew.tint] : 'bg-ink/[0.07]'
                      }`}
                    >
                      <Text variant="caption" tone="default" className="font-body-bold text-[14px]">
                        {pickedCrew?.name ?? 'Choose'}
                      </Text>
                      <Icon name="chevronDown" size={14} color={colors.ink} />
                    </View>
                  }
                />
                <ListRow
                  title="Dates"
                  onPress={() => setDatesOpen(true)}
                  right={
                    <View className="rounded-pill border border-ink/20 px-3.5 py-2 dark:border-ink-dark/25">
                      <Text variant="stamp" tone="default" className="text-[13px]">
                        {dates.start
                          ? formatDateRange(dates.start, dates.end ?? dates.start).toUpperCase()
                          : 'ADD DATES'}
                      </Text>
                    </View>
                  }
                />
                <ToggleRow
                  title="Chapters"
                  subtitle={
                    chaptersOn && chapters.length
                      ? chapters.slice(0, 4).join(' · ') + (chapters.length > 4 ? ' …' : '')
                      : 'Split the Roll into parts, like Haldi · Mehendi · Sangeet'
                  }
                  value={chaptersOn}
                  onValueChange={(v) => {
                    setChaptersOn(v);
                    setChaptersEdited(true);
                  }}
                />
                {chaptersOn ? (
                  <View className="mb-2 gap-2">
                    <View className="flex-row flex-wrap gap-2">
                      {chapters.map((c) => (
                        <Chip
                          key={c}
                          label={c}
                          tone="tint"
                          onPress={() => {
                            setChaptersEdited(true);
                            setChapters((cs) => cs.filter((x) => x !== c));
                          }}
                          accessibilityLabel={`Remove chapter ${c}`}
                          trailing={<Icon name="close" size={12} color={colors.ink} />}
                        />
                      ))}
                    </View>
                    <TextField
                      label="Add a Chapter"
                      value={newChapter}
                      onChangeText={setNewChapter}
                      placeholder="Reception"
                      maxLength={40}
                      returnKeyType="done"
                      onSubmitEditing={addChapter}
                      right={
                        <PressableScale
                          accessibilityRole="button"
                          accessibilityLabel="Add chapter"
                          onPress={addChapter}
                        >
                          <Icon name="plus" size={20} color={colors.ink} />
                        </PressableScale>
                      }
                    />
                  </View>
                ) : null}
                <View className="py-2">
                  <Text variant="heading" className="mb-2 text-[16px]">
                    Reveal photos
                  </Text>
                  <Segmented
                    accessibilityLabel="Reveal photos"
                    options={[
                      { value: 'live', label: 'Live' },
                      { value: 'end', label: 'When it ends', disabled: true },
                      { value: 'morning', label: 'Next morning', disabled: true },
                    ]}
                    value="live"
                    onChange={() => undefined}
                  />
                  <Text variant="caption" className="mt-1.5">
                    Photos show up as they are added. Delayed reveals are coming soon.
                  </Text>
                </View>
                <ToggleRow
                  title="Time Capsule"
                  subtitle="Lock the Roll until a date you pick"
                  value={false}
                  onValueChange={() => undefined}
                  disabled
                  disabledReason="Coming soon"
                />
              </View>
            )}
          </>
        )}
      </View>

      <DateRangeModal
        visible={datesOpen}
        onClose={() => setDatesOpen(false)}
        value={dates}
        onApply={setDates}
      />
      <ModalSheet visible={crewPickerOpen} onClose={() => setCrewPickerOpen(false)} title="In which Crew?">
        <View>
          {crews.map((c) => (
            <ListRow
              key={c.id}
              title={c.name}
              subtitle={`${c.member_count} members`}
              left={<View className={`h-9 w-9 rounded-pill ${TINT_BG[c.tint]}`} />}
              right={c.id === crewId ? <Icon name="check" size={20} color={colors.ink} /> : <View />}
              onPress={() => {
                setCrewId(c.id);
                setCrewPickerOpen(false);
              }}
            />
          ))}
        </View>
      </ModalSheet>
    </SheetContent>
  );
}


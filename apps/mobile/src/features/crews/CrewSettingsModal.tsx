import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { CREW_TINTS, type CrewTint } from '@/data/types';
import { Button, Icon, ModalSheet, PressableScale, Text, TextField, TINT_BG, INK } from '@/ui';

const TINT_NAME: Record<CrewTint, string> = {
  lilac: 'Lilac',
  lime: 'Lime',
  sky: 'Sky',
  peach: 'Peach',
  pink: 'Pink',
  mint: 'Mint',
};

/** Six named tints (colour is never the only cue). */
export function TintPicker({
  value,
  onChange,
}: {
  value: CrewTint;
  onChange: (t: CrewTint) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-2">
      {CREW_TINTS.map((t) => {
        const selected = t === value;
        return (
          <PressableScale
            key={t}
            accessibilityRole="radio"
            accessibilityLabel={`${TINT_NAME[t]} tint`}
            accessibilityState={{ selected }}
            onPress={() => onChange(t)}
            wrapperStyle={{ alignItems: 'center', width: 64 }}
          >
            <View
              className={`h-11 w-11 items-center justify-center rounded-pill ${TINT_BG[t]}`}
              style={{ borderWidth: selected ? 3 : 1, borderColor: selected ? INK : 'rgba(0,0,0,0.12)' }}
            >
              {selected ? <Icon name="check" size={18} color={INK} strokeWidth={3} /> : null}
            </View>
            <Text variant="caption" tone={selected ? 'default' : 'tertiary'} className="mt-1 text-[12px]">
              {TINT_NAME[t]}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

export interface CrewSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  name: string;
  tint: CrewTint;
  isHost: boolean;
  saving: boolean;
  onSave: (patch: { name: string; tint: CrewTint }) => void;
  onDelete: () => void;
}

/** Crew settings (admins): rename, tint; delete for the host. */
export function CrewSettingsModal({
  visible,
  onClose,
  name,
  tint,
  isHost,
  saving,
  onSave,
  onDelete,
}: CrewSettingsModalProps) {
  const [draft, setDraft] = useState(name);
  const [draftTint, setDraftTint] = useState<CrewTint>(tint);
  useEffect(() => {
    if (visible) {
      setDraft(name);
      setDraftTint(tint);
    }
  }, [visible, name, tint]);

  const trimmed = draft.trim();
  const changed = trimmed !== name || draftTint !== tint;
  const valid = trimmed.length >= 1 && trimmed.length <= 60;

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Crew settings"
      footer={
        <Button
          label="Save"
          variant="primary"
          size="lg"
          loading={saving}
          disabled={!changed || !valid}
          disabledReason={!valid ? 'Give your Crew a name' : 'Change the name or tint to save'}
          onPress={() => onSave({ name: trimmed, tint: draftTint })}
        />
      }
    >
      <View className="gap-5">
        <TextField
          label="Crew name"
          value={draft}
          onChangeText={setDraft}
          maxLength={60}
          returnKeyType="done"
        />
        <View>
          <Text variant="caption" className="mb-2 font-body-semibold">
            Tint
          </Text>
          <TintPicker value={draftTint} onChange={setDraftTint} />
        </View>
        {isHost ? (
          <View className="items-start border-t border-line pt-3 dark:border-line-dark">
            <Button label="Delete Crew" variant="destructive" icon="trash" onPress={onDelete} />
          </View>
        ) : null}
      </View>
    </ModalSheet>
  );
}

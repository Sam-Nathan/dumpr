import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, BottomModal, Chip, Glyph, IconButton, Text, useColors } from '@/ui';
import { presetWindow, shiftWindow, type ImportWindow, type WindowPreset } from './window';

const PRESETS: { id: WindowPreset; label: string }[] = [
  { id: '3d', label: 'Last 3 days' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'Everything' },
];

function fmt(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Change dates": presets plus a day stepper for each edge of the window. */
export function DateWindowModal({
  visible,
  window: initial,
  rollWindow,
  onClose,
  onApply,
}: {
  visible: boolean;
  window: ImportWindow;
  /** The roll's own dates, offered as the first preset. */
  rollWindow: ImportWindow;
  onClose: () => void;
  onApply: (w: ImportWindow) => void;
}) {
  const [draft, setDraft] = useState<ImportWindow>(initial);
  const colors = useColors();
  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  const stepper = (edge: 'from' | 'to', label: string) => (
    <View className="flex-row items-center justify-between rounded-input border border-line bg-surface px-3 py-2 dark:border-line-dark dark:bg-surface-dark">
      <View>
        <Text variant="caption">{label}</Text>
        <Text variant="body" tone="default" className="font-body-semibold">
          {fmt(draft[edge])}
        </Text>
      </View>
      <View className="flex-row items-center gap-1">
        <IconButton
          icon="back"
          label={`${label} one day earlier`}
          variant="soft"
          size={40}
          onPress={() => setDraft((d) => shiftWindow(d, edge, -1))}
        />
        <IconButton
          icon="chevronRight"
          label={`${label} one day later`}
          variant="soft"
          size={40}
          onPress={() => setDraft((d) => shiftWindow(d, edge, 1))}
        />
      </View>
    </View>
  );

  return (
    <BottomModal
      visible={visible}
      onClose={onClose}
      title="Change dates"
      footer={
        <Button
          label="Show these photos"
          variant="strong"
          size="lg"
          onPress={() => onApply(draft)}
        />
      }
    >
      <View className="flex-row flex-wrap gap-2">
        {rollWindow.isFallback ? null : (
          <Chip
            label={`Roll dates · ${rollWindow.label}`}
            selected={draft.from === rollWindow.from && draft.to === rollWindow.to}
            onPress={() => setDraft(rollWindow)}
          />
        )}
        {PRESETS.map((p) => (
          <Chip key={p.id} label={p.label} onPress={() => setDraft(presetWindow(p.id))} />
        ))}
      </View>
      <View className="mt-4 gap-2">
        <View className="flex-row items-center gap-2">
          <Glyph name="calendar" size={16} color={colors.ink3} />
          <Text variant="caption">Custom range</Text>
        </View>
        {stepper('from', 'From')}
        {stepper('to', 'To')}
      </View>
    </BottomModal>
  );
}

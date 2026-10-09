import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { daysInMonth, formatBirthday, monthLong } from '@/lib/format';
import { BottomModal, Button, Chip, Text } from '@/ui';

/** Day + month picker (same fields as A3 profile setup). */
export function BirthdayPicker({
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
    <BottomModal
      visible={visible}
      onClose={onClose}
      title="Your birthday"
      footer={
        <Button
          label={dayValid ? `Save ${formatBirthday(d, m)}` : 'Save'}
          variant="strong"
          size="lg"
          disabled={!dayValid}
          disabledReason="Pick a day"
          onPress={() => d && onPick(d, m)}
        />
      }
    >
      <Text variant="caption" tone="secondary" className="mb-2 font-body-semibold">
        Month
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
          <Chip
            key={mm}
            label={monthLong(mm - 1).slice(0, 3)}
            selected={m === mm}
            onPress={() => setM(mm)}
            accessibilityLabel={monthLong(mm - 1)}
          />
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
            <Text
              variant="body"
              tone={d === dd ? 'inverse' : 'default'}
              className={d === dd ? 'dark:text-ink' : ''}
            >
              {dd}
            </Text>
          </Pressable>
        ))}
      </View>
    </BottomModal>
  );
}

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatDateRange, monthLong, parseDay } from '@/lib/format';
import { Button, IconButton, ModalSheet, PressableScale, Text, useScheme, INK, INK_TEXT, FLASH } from '@/ui';
import { monthGrid, pickRangeDay } from './names';

export interface DateRange {
  start: string | null;
  end: string | null;
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Small month calendar for picking a start and end day (taps: start, then end). */
export function DateRangeModal({
  visible,
  onClose,
  value,
  onApply,
  title = 'Dates',
}: {
  visible: boolean;
  onClose: () => void;
  value: DateRange;
  onApply: (range: DateRange) => void;
  title?: string;
}) {
  const [range, setRange] = useState<DateRange>(value);
  const [cursor, setCursor] = useState(() => {
    const a = parseDay(value.start);
    const n = new Date();
    return a
      ? { y: a.getUTCFullYear(), m: a.getUTCMonth() }
      : { y: n.getFullYear(), m: n.getMonth() };
  });

  useEffect(() => {
    if (!visible) return;
    setRange(value);
    const a = parseDay(value.start);
    if (a) setCursor({ y: a.getUTCFullYear(), m: a.getUTCMonth() });
    else {
      const n = new Date();
      setCursor({ y: n.getFullYear(), m: n.getMonth() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dark = useScheme() === 'dark';
  const weeks = monthGrid(cursor.y, cursor.m);
  const step = (d: number) => {
    const next = new Date(Date.UTC(cursor.y, cursor.m + d, 1));
    setCursor({ y: next.getUTCFullYear(), m: next.getUTCMonth() });
  };
  const inRange = (day: string) =>
    !!range.start && (range.end ? day >= range.start && day <= range.end : day === range.start);
  const summary = range.start
    ? formatDateRange(range.start, range.end ?? range.start)
    : 'Tap a start day';

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={title}
      eyebrow={summary.toUpperCase()}
      footer={
        <View className="gap-1">
          <Button
            label="Done"
            variant="primary"
            size="lg"
            disabled={!range.start}
            disabledReason="Pick a start day, or clear the dates"
            onPress={() => {
              onApply({ start: range.start, end: range.end ?? range.start });
              onClose();
            }}
          />
          <Button
            label="No dates"
            variant="tertiary"
            fullWidth
            onPress={() => {
              onApply({ start: null, end: null });
              onClose();
            }}
          />
        </View>
      }
    >
      <View className="mb-2 flex-row items-center justify-between">
        <IconButton icon="back" label="Previous month" onPress={() => step(-1)} />
        <Text variant="heading" heading>
          {monthLong(cursor.m)} {cursor.y}
        </Text>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <IconButton icon="back" label="Next month" onPress={() => step(1)} />
        </View>
      </View>
      <View className="flex-row">
        {WEEK.map((d, i) => (
          <View key={i} className="flex-1 items-center py-1">
            <Text variant="stamp" tone="tertiary" className="text-[11px]">
              {d}
            </Text>
          </View>
        ))}
      </View>
      {weeks.map((w, wi) => (
        <View key={wi} className="flex-row">
          {w.map((day, di) => {
            if (!day) return <View key={di} className="h-11 flex-1" />;
            const on = inRange(day);
            const edgeDay = day === range.start || day === range.end;
            return (
              <View key={di} className="h-11 flex-1 items-center justify-center">
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={day}
                  accessibilityState={{ selected: on }}
                  haptics={false}
                  onPress={() => setRange((r) => pickRangeDay(r, day))}
                  className="h-10 w-10 items-center justify-center rounded-pill"
                  style={{ backgroundColor: edgeDay ? (dark ? INK_TEXT : INK) : on ? FLASH : 'transparent' }}
                >
                  <Text
                    variant="caption"
                    className="font-body-bold text-[14px]"
                    style={edgeDay ? { color: dark ? INK : INK_TEXT } : on ? { color: INK } : undefined}
                    tone="default"
                  >
                    {Number(day.slice(8))}
                  </Text>
                </PressableScale>
              </View>
            );
          })}
        </View>
      ))}
    </ModalSheet>
  );
}

import { ScrollView, View } from 'react-native';
import type { RollChapter } from '@/data/types-b';
import { Button, Chip, Icon, PressableScale, Stamp, Text, FLASH, INK } from '@/ui';

export function ChapterChips({
  chapters,
  value,
  onChange,
}: {
  chapters: RollChapter[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  if (chapters.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
      accessibilityRole="tablist"
    >
      <Chip label="All" selected={value === null} onPress={() => onChange(null)} />
      {chapters.map((c) => (
        <Chip key={c.id} label={c.name} selected={value === c.id} onPress={() => onChange(c.id)} />
      ))}
    </ScrollView>
  );
}

/** "Reveal in 07:42:10" card for a sealed Roll. */
export function SealedCard({ label }: { label: string | null }) {
  return (
    <View className="flex-row items-center gap-4 rounded-card bg-ink p-4">
      <View className="h-12 w-12 items-center justify-center rounded-pill bg-white/10">
        <Icon name="lock" size={22} color={FLASH} />
      </View>
      <View className="flex-1">
        <Text variant="stamp" className="text-[11px]">
          SEALED
        </Text>
        {label ? <Stamp text={label.replace('Reveal in ', '')} size={15} /> : null}
        <Text variant="caption" tone="inverse" className="mt-0.5 opacity-80">
          {label
            ? 'Everyone sees the full Roll at the same moment. Your own photos stay yours.'
            : 'Opening up. Pull down to refresh.'}
        </Text>
      </View>
    </View>
  );
}

export function ReviewBanner({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <View className="flex-row items-center gap-3 rounded-card border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark">
      <View className="h-10 w-10 items-center justify-center rounded-pill bg-tint-peach dark:bg-tint-peach-dark">
        <Icon name="users" size={20} color={INK} />
      </View>
      <Text variant="body" tone="default" className="flex-1 font-body-semibold">
        {count === 1 ? '1 guest photo' : `${count} guest photos`} to review
      </Text>
      <Button label="Review" variant="strong" size="sm" onPress={onPress} />
    </View>
  );
}

/** Floating "8 Uploading · 1 failed" pill (tap opens the queue). */
export function UploadPill({
  uploading,
  failed,
  onPress,
}: {
  uploading: number;
  failed: number;
  onPress: () => void;
}) {
  if (uploading === 0 && failed === 0) return null;
  return (
    <View className="absolute inset-x-0 bottom-6 items-center" pointerEvents="box-none">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${uploading} uploading, ${failed} failed. Open uploads`}
        onPress={onPress}
        className="flex-row items-center gap-2 rounded-pill bg-ink px-4 py-3"
      >
        {uploading > 0 ? (
          <Text variant="stamp" tone="flash" className="text-[13px]">
            {uploading}
          </Text>
        ) : null}
        <Text variant="heading" tone="inverse" className="text-[14px]">
          {uploading > 0 ? 'Uploading' : 'Upload stopped'}
          {failed > 0 ? ` · ${failed} failed` : ''}
        </Text>
      </PressableScale>
    </View>
  );
}

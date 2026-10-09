import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  useDestinations,
  useDestinationStore,
  type DestinationPurpose,
} from '@/data/useDestinations';
import { RollCover } from '@/features/camera/RollCover';
import { filterDestinations, sectionDestinations } from '@/features/camera/destination';
import type { DestinationRoll } from '@/data/types-cf';
import {
  Button,
  EdgeState,
  edge,
  goBack,
  Icon,
  PressableScale,
  SheetContent,
  Skeleton,
  Text,
  TextField,
  useColors,
} from '@/ui';

/**
 * C2 Destination picker (sheet). Choose where captured / imported photos go: "Live now" first, then
 * recent Rolls with their Crew tint. Rows where the host closed uploads are disabled with the reason.
 * Hands the choice back through `useDestinationStore` (the caller passes `purpose`).
 */
export default function DestinationSheet() {
  const params = useLocalSearchParams<{
    purpose?: string;
    selectedRollId?: string;
    count?: string;
  }>();
  const purpose: DestinationPurpose = params.purpose === 'import' ? 'import' : 'camera';
  const count = Number(params.count ?? 0) || 0;
  const { rolls, crews, isLoading, isError, error, refetch } = useDestinations();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(params.selectedRollId ?? null);
  const colors = useColors();

  const { live, recent } = useMemo(
    () => sectionDestinations(filterDestinations(rolls, query)),
    [rolls, query],
  );
  const chosen = rolls.find((r) => r.id === selected) ?? null;
  const noCrews = !isLoading && !isError && crews.length === 0 && rolls.length === 0;

  const confirm = () => {
    if (!chosen) return;
    useDestinationStore.getState().choose(purpose, chosen.id);
    goBack();
  };

  const label = chosen
    ? count > 0
      ? `Post ${count} to ${chosen.name}`
      : `Use ${chosen.name}`
    : 'Choose a Roll';

  const err = edge.fromError(error);

  return (
    <SheetContent
      title={count > 0 ? `Where should these ${count} go?` : 'Where should this go?'}
      footer={
        noCrews || isError ? undefined : (
          <Button
            label={label}
            variant="primary"
            size="lg"
            disabled={!chosen}
            disabledReason="Pick a Roll to continue"
            onPress={confirm}
          />
        )
      }
    >
      {isLoading ? (
        <View className="gap-4">
          {[0, 1, 2].map((i) => (
            <View key={i} className="flex-row items-center gap-3">
              <Skeleton width={48} height={48} radius={12} />
              <View className="gap-2">
                <Skeleton width={140} height={16} />
                <Skeleton width={96} height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : isError ? (
        <EdgeState
          icon={err.icon}
          tone={err.tone}
          title={err.title}
          body={err.body}
          primary={{ label: 'Try again', onPress: refetch }}
          secondary={{ label: 'Close', onPress: goBack }}
        />
      ) : noCrews ? (
        <EdgeState
          icon="users"
          tone="lilac"
          title="Start a Crew first"
          body="Photos live in Rolls, and Rolls live in a Crew. It takes a few seconds."
          primary={{
            label: 'New Crew',
            onPress: () => router.replace({ pathname: '/sheets/create', params: { kind: 'crew' } }),
          }}
          secondary={{ label: 'Not now', onPress: goBack }}
        />
      ) : (
        <View>
          {rolls.length > 0 ? (
            <View className="mb-2">
              <TextField
                value={query}
                onChangeText={setQuery}
                placeholder="Search Rolls and Crews"
                autoCorrect={false}
                returnKeyType="search"
                left={<Icon name="search" size={18} color={colors.ink3} />}
              />
            </View>
          ) : null}

          {live.length > 0 ? <SectionTitle>LIVE NOW</SectionTitle> : null}
          {live.map((r) => (
            <RollRow
              key={r.id}
              roll={r}
              selected={selected === r.id}
              onPress={() => setSelected(r.id)}
            />
          ))}

          {recent.length > 0 ? <SectionTitle>RECENT ROLLS</SectionTitle> : null}
          {recent.map((r) => (
            <RollRow
              key={r.id}
              roll={r}
              selected={selected === r.id}
              onPress={() => setSelected(r.id)}
            />
          ))}

          {live.length + recent.length === 0 ? (
            <Text variant="body" className="mt-2">
              {query ? 'No Rolls match that.' : 'No Rolls yet. Start one below.'}
            </Text>
          ) : null}

          <View className="mt-6 flex-row gap-3">
            <NewButton
              label="+ New Roll"
              onPress={() => router.push({ pathname: '/sheets/create', params: { kind: 'roll' } })}
            />
            <NewButton
              label="+ New Crew"
              onPress={() => router.push({ pathname: '/sheets/create', params: { kind: 'crew' } })}
            />
          </View>
        </View>
      )}
    </SheetContent>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text variant="stamp" tone="tertiary" heading className="mb-1 mt-4 text-[11px]">
      {children}
    </Text>
  );
}

function NewButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      wrapperStyle={{ flex: 1 }}
      className="h-12 items-center justify-center rounded-pill border border-dashed border-ink/25 dark:border-ink-dark/30"
    >
      <Text variant="heading" tone="default" className="text-[15px]">
        {label}
      </Text>
    </PressableScale>
  );
}

function RollRow({
  roll,
  selected,
  onPress,
}: {
  roll: DestinationRoll;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const closed = roll.uploadsClosed;
  const subtitle = closed
    ? 'Uploads closed by host'
    : roll.live
      ? `${roll.crewName} · Live now`
      : roll.sealed
        ? `${roll.crewName} · Sealed until the reveal`
        : roll.crewName;
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={`${roll.name}, ${subtitle}`}
      accessibilityState={{ selected, disabled: closed }}
      disabled={closed}
      onPress={onPress}
      haptics={false}
      scaleTo={0.99}
      className={`min-h-[64px] flex-row items-center gap-3 py-2 ${closed ? 'opacity-50' : ''}`}
    >
      <RollCover photoId={roll.coverPhotoId} tint={roll.tint} />
      <View className="flex-1">
        <Text variant="heading" tone="default" numberOfLines={1}>
          {roll.name}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {closed ? (
        <Icon name="lock" size={18} color={colors.ink3} />
      ) : (
        <View
          className={`h-7 w-7 items-center justify-center rounded-pill border-2 ${
            selected
              ? 'border-ink bg-ink dark:border-ink-dark dark:bg-ink-dark'
              : 'border-ink/25 dark:border-ink-dark/30'
          }`}
        >
          {selected ? <View className="h-3 w-3 rounded-pill bg-flash" /> : null}
        </View>
      )}
    </PressableScale>
  );
}

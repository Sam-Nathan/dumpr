import { FlashList } from '@shopify/flash-list';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View, useWindowDimensions } from 'react-native';
import { useDestinationRoll } from '@/data/useDestinations';
import { addLabel } from '@/features/camera/destination';
import { DateWindowModal } from '@/features/import/DateWindowModal';
import { loadImported, rememberImported } from '@/features/import/importedCache';
import {
  bannerTitle,
  dayLabel,
  estimateBytes,
  flattenSections,
  groupByDay,
  importedKey,
  preselect,
  rollWindow as buildRollWindow,
  shouldSuggestWifi,
  type ImportWindow,
} from '@/features/import/window';
import { enqueueUploads, setWifiOnly, useUploadQueue, type EnqueueAsset } from '@/features/uploads';
import { useDestinationStore } from '@/data/useDestinations';
import { formatBytes } from '@/lib/format';
import {
  Button,
  EdgeState,
  goBack,
  Icon,
  PermissionPrimer,
  PhotoTile,
  PressableScale,
  Screen,
  Skeleton,
  Text,
  toast,
  toPermissionOutcome,
  ToggleSwitch,
  useColors,
} from '@/ui';

type Mode = 'checking' | 'primer' | 'smart' | 'picked';

interface ImportItem {
  id: string;
  uri: string;
  filename: string;
  creationTime: number;
  width: number;
  height: number;
  bytes?: number;
  /** Library asset (resolved to a file just before upload) vs. a picker file (already local). */
  fromLibrary: boolean;
}

const PHOTO_ONLY = ['photo' as const];
const MAX_ASSETS = 2000;
const GAP = 2;

/**
 * C3 Smart gallery import (fullScreenModal). With library access it suggests the photos taken
 * within the Roll's dates (pre-selected, duplicates dimmed "IN ROLL"); without it, or when the OS
 * limits access (Expo Go, iOS limited, Android partial), the system picker does the same job.
 */
export default function ImportScreen() {
  const params = useLocalSearchParams<{ rollId?: string }>();
  const { roll, isLoading: destLoading } = useDestinationRoll('import', params.rollId);
  const colors = useColors();
  const { width } = useWindowDimensions();
  const tile = (width - GAP * 3) / 4;
  const queue = useUploadQueue();

  const [mode, setMode] = useState<Mode>('checking');
  const [limited, setLimited] = useState(false);
  const [denied, setDenied] = useState(false);
  const [window, setWindow] = useState<ImportWindow | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wifiAsked, setWifiAsked] = useState(false);
  const cameFromPrimer = useRef(false);

  const roll0 = useMemo(
    () => buildRollWindow(roll?.startsOn, roll?.endsOn),
    [roll?.startsOn, roll?.endsOn],
  );
  useEffect(() => {
    if (!window && !destLoading) setWindow(roll0);
  }, [window, destLoading, roll0]);

  useEffect(() => {
    if (roll) void loadImported(roll.id).then(setImported);
  }, [roll]);

  // ---- permission / mode -------------------------------------------------------------------
  const pickFromSystem = useCallback(async () => {
    try {
      // The system picker needs no library permission.
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        exif: true,
        quality: 1,
      });
      if (r.canceled || r.assets.length === 0) {
        if (cameFromPrimer.current) setMode('primer');
        else if (items.length === 0) goBack();
        return;
      }
      const picked: ImportItem[] = r.assets.map((a, i) => {
        const exifDate = (a.exif as { DateTimeOriginal?: string } | null | undefined)
          ?.DateTimeOriginal;
        const parsed = exifDate
          ? Date.parse(exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T'))
          : NaN;
        return {
          id: `pick:${a.assetId ?? a.uri}:${i}`,
          uri: a.uri,
          filename: a.fileName ?? `Photo ${i + 1}`,
          creationTime: Number.isFinite(parsed) ? parsed : Date.now(),
          width: a.width,
          height: a.height,
          bytes: a.fileSize,
          fromLibrary: false,
        };
      });
      setItems(picked);
      setTotal(picked.length);
      setSelected(new Set(picked.map((p) => p.id)));
      setMode('picked');
    } catch {
      setError("We couldn't open your gallery. Try again.");
      setMode('picked');
    }
  }, [items.length]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await MediaLibrary.getPermissionsAsync(false, PHOTO_ONLY);
        if (!alive) return;
        if (p.granted) {
          setLimited(p.accessPrivileges === 'limited');
          setMode('smart');
        } else {
          setDenied(p.canAskAgain === false);
          setMode('primer');
        }
      } catch {
        // This build cannot read the library (Expo Go): the picker still works.
        if (alive) void pickFromSystem();
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- smart: stream the library by date window ----------------------------------------------
  const loadToken = useRef(0);
  const loadWindow = useCallback(async (w: ImportWindow, importedKeys: Set<string>) => {
    const token = ++loadToken.current;
    setLoading(true);
    setItems([]);
    setSelected(new Set());
    setTotal(0);
    setError(null);
    try {
      let after: string | undefined;
      let count = 0;
      for (;;) {
        const page = await MediaLibrary.getAssetsAsync({
          first: 300,
          after,
          mediaType: 'photo',
          createdAfter: w.from,
          createdBefore: w.to,
          sortBy: [['creationTime', true]],
        });
        if (token !== loadToken.current) return;
        const mapped: ImportItem[] = page.assets.map((a) => ({
          id: a.id,
          uri: a.uri,
          filename: a.filename,
          creationTime: a.creationTime,
          width: a.width,
          height: a.height,
          fromLibrary: true,
        }));
        count += mapped.length;
        setTotal(page.totalCount);
        setItems((cur) => [...cur, ...mapped]);
        setSelected((cur) => {
          const next = new Set(cur);
          for (const id of preselect(mapped, importedKeys)) next.add(id);
          return next;
        });
        if (!page.hasNextPage || count >= MAX_ASSETS) break;
        after = page.endCursor;
      }
    } catch {
      if (token === loadToken.current) {
        setError("We couldn't read your library. You can still pick photos one by one.");
      }
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'smart' && window) void loadWindow(window, imported);
    // `imported` is deliberately read once per window change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, window, loadWindow]);

  // ---- derived -------------------------------------------------------------------------------
  const isDup = useCallback(
    (it: ImportItem) => it.fromLibrary && imported.has(importedKey(it.filename, it.creationTime)),
    [imported],
  );
  const sections = useMemo(() => groupByDay(items), [items]);
  const rows = useMemo(() => flattenSections(sections, 4), [sections]);
  const dupCount = useMemo(() => items.filter(isDup).length, [items, isDup]);
  const chosen = useMemo(
    () => items.filter((i) => selected.has(i.id) && !isDup(i)),
    [items, selected, isDup],
  );
  const sizeBytes = useMemo(
    () =>
      chosen.every((c) => c.bytes)
        ? chosen.reduce((n, c) => n + (c.bytes ?? 0), 0)
        : estimateBytes(chosen),
    [chosen],
  );

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setDay = (dayKeyStr: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const s of sections)
        if (s.key === dayKeyStr)
          for (const it of s.items) {
            if (isDup(it)) continue;
            if (on) next.add(it.id);
            else next.delete(it.id);
          }
      return next;
    });
  const allOn = items.length > 0 && items.every((i) => isDup(i) || selected.has(i.id));
  const toggleAll = () =>
    setSelected(allOn ? new Set() : new Set(items.filter((i) => !isDup(i)).map((i) => i.id)));

  const openDestination = () =>
    router.push({
      pathname: '/sheets/destination',
      params: { purpose: 'import', selectedRollId: roll?.id ?? '', count: String(chosen.length) },
    });

  // ---- add -----------------------------------------------------------------------------------
  const add = async () => {
    if (!roll) return openDestination();
    if (chosen.length === 0) return;
    setBusy(`Preparing ${chosen.length}…`);
    setError(null);
    try {
      const assets: EnqueueAsset[] = [];
      const keys: string[] = [];
      let i = 0;
      const worker = async () => {
        while (i < chosen.length) {
          const it = chosen[i++] as ImportItem;
          let uri = it.uri;
          if (it.fromLibrary) {
            try {
              const info = await MediaLibrary.getAssetInfoAsync(it.id);
              uri = info.localUri ?? info.uri ?? it.uri;
            } catch {
              continue; // skip a photo we cannot read
            }
          }
          assets.push({
            uri,
            width: it.width,
            height: it.height,
            takenAt: new Date(it.creationTime).toISOString(),
            fileName: it.filename,
            bytes: it.bytes,
          });
          keys.push(importedKey(it.filename, it.creationTime));
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (assets.length === 0) {
        setError("We couldn't read those photos. Try picking them one by one.");
        return;
      }
      await enqueueUploads(assets, { rollId: roll.id });
      void rememberImported(roll.id, keys);
      useDestinationStore.getState().setLast(roll.id);
      toast.show({
        message: `Adding ${assets.length} to ${roll.name}`,
      });
      router.replace('/uploads');
    } catch {
      setError("Those didn't get added. Nothing was lost; try again.");
    } finally {
      setBusy(null);
    }
  };

  // ---- render --------------------------------------------------------------------------------
  if (mode === 'checking') {
    return (
      <Screen header={{ close: true, title: 'Add from gallery' }}>
        <View className="mt-6 flex-row flex-wrap" style={{ gap: GAP }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} width={tile} height={tile} radius={4} />
          ))}
        </View>
      </Screen>
    );
  }

  if (mode === 'primer') {
    return (
      <Screen header={{ close: true }} scroll>
        <PermissionPrimer
          kind="photos"
          context={{
            rollName: roll?.name,
            dates: window && !window.isFallback ? window.label : undefined,
          }}
          initialDenied={denied}
          request={async () =>
            toPermissionOutcome(await MediaLibrary.requestPermissionsAsync(false, PHOTO_ONLY))
          }
          check={async () =>
            toPermissionOutcome(await MediaLibrary.getPermissionsAsync(false, PHOTO_ONLY))
          }
          onGranted={(o) => {
            setLimited(o === 'limited');
            setMode('smart');
          }}
          onNotNow={goBack}
          onPickManually={() => {
            cameFromPrimer.current = true;
            void pickFromSystem();
          }}
        />
      </Screen>
    );
  }

  const rollName = roll?.name ?? 'a Roll';
  const showEmpty = !loading && !error && items.length === 0;
  const suggestWifi = shouldSuggestWifi(chosen.length) && !queue.wifiOnly && !wifiAsked;

  const footer = (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="body" className="flex-1" numberOfLines={2}>
          {chosen.length} selected · {chosen.length ? `~${formatBytes(sizeBytes)} · ` : ''}Original
          quality
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Destination: ${rollName}. Change`}
          onPress={openDestination}
          className="h-9 flex-row items-center gap-1.5 rounded-pill bg-tint-lilac px-3.5 dark:bg-tint-lilac-dark"
        >
          <Text variant="caption" tone="default" className="font-body-semibold" numberOfLines={1}>
            {roll ? roll.name : 'Choose where'}
          </Text>
          <Icon name="chevronDown" size={14} color={colors.ink} />
        </PressableScale>
      </View>
      {suggestWifi ? (
        <View className="flex-row items-center justify-between rounded-input bg-tint-sky p-3 dark:bg-tint-sky-dark">
          <Text variant="caption" tone="default" className="flex-1 pr-3">
            That is a lot of photos. Upload on Wi-Fi only to save your data?
          </Text>
          <ToggleSwitch
            label="Upload on Wi-Fi only"
            value={queue.wifiOnly}
            onValueChange={(v) => {
              setWifiOnly(v);
              setWifiAsked(true);
            }}
          />
        </View>
      ) : null}
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        label={roll ? addLabel(chosen.length, roll.name) : 'Choose where to add'}
        variant="primary"
        size="lg"
        loading={!!busy}
        disabled={!!roll && chosen.length === 0}
        disabledReason="Select at least one photo"
        onPress={() => void add()}
      />
      {busy ? (
        <Text variant="caption" className="text-center">
          {busy}
        </Text>
      ) : null}
    </View>
  );

  const header = (
    <View>
      {mode === 'smart' && window ? (
        <View className="mt-1 rounded-card bg-flash p-4">
          <Text variant="stamp" tone="onFlash" className="text-[11px]">
            SMART PICK · {window.label.toUpperCase()}
          </Text>
          <Text variant="title" heading tone="onFlash" className="mt-1 text-[24px] leading-[26px]">
            {bannerTitle(total, rollName)}
          </Text>
          <Text variant="body" tone="onFlash" className="mt-1">
            {chosen.length} pre-selected
            {dupCount
              ? ` · ${dupCount} already in the Roll ${dupCount === 1 ? 'is' : 'are'} skipped`
              : ''}
            {' · '}
            <Text
              variant="body"
              tone="onFlash"
              className="font-body-bold underline"
              onPress={() => setWindowOpen(true)}
              accessibilityRole="button"
            >
              Change dates
            </Text>
          </Text>
        </View>
      ) : null}
      {mode === 'smart' && limited ? (
        <View className="mt-3 flex-row items-center gap-2">
          <Icon name="lock" size={16} color={colors.ink3} />
          <Text variant="caption" className="flex-1">
            Limited access — Dumpr sees only photos you allowed.
          </Text>
          <Text
            variant="caption"
            tone="default"
            className="font-body-bold underline"
            accessibilityRole="button"
            onPress={() =>
              void MediaLibrary.presentPermissionsPickerAsync(['photo'])
                .then(() => window && loadWindow(window, imported))
                .catch(() => undefined)
            }
          >
            Choose more
          </Text>
        </View>
      ) : null}
      {mode === 'picked' ? (
        <View className="mt-1 flex-row items-center justify-between">
          <Text variant="caption">{items.length} picked from your gallery</Text>
          <Text
            variant="caption"
            tone="default"
            className="font-body-bold underline"
            accessibilityRole="button"
            onPress={() => void pickFromSystem()}
          >
            Choose more photos
          </Text>
        </View>
      ) : null}
      {loading ? (
        <View className="mt-3 flex-row items-center gap-2">
          <ActivityIndicator size="small" color={colors.ink3} />
          <Text variant="caption">Finding photos…</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen
      padded={false}
      header={{
        close: true,
        title: 'Add from gallery',
        right:
          items.length > 0 ? (
            <Button
              label={allOn ? 'Clear' : 'Select all'}
              variant="tertiary"
              size="sm"
              onPress={toggleAll}
            />
          ) : undefined,
      }}
      footer={<View className="px-4">{footer}</View>}
    >
      {showEmpty ? (
        <View className="flex-1 px-4">
          <EdgeState
            layout="screen"
            icon="image"
            tone="sky"
            title="Nothing from those dates"
            body={
              mode === 'smart'
                ? 'No photos on this phone were taken in that window. Change the dates or browse everything.'
                : 'You did not pick any photos.'
            }
            primary={{ label: 'Browse all photos', onPress: () => void pickFromSystem() }}
            secondary={
              mode === 'smart'
                ? { label: 'Change dates', onPress: () => setWindowOpen(true) }
                : { label: 'Close', onPress: goBack }
            }
            primaryVariant="strong"
          />
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.key}
          getItemType={(r) => r.type}
          ListHeaderComponent={<View className="px-4 pb-2">{header}</View>}
          contentContainerStyle={{ paddingBottom: 12 }}
          extraData={selected}
          renderItem={({ item: r }) => {
            if (r.type === 'header') {
              const sec = sections.find((s) => s.key === r.dayKey);
              const pickable = (sec?.items ?? []).filter((i) => !isDup(i));
              const on = pickable.filter((i) => selected.has(i.id)).length;
              const allDay = pickable.length > 0 && on === pickable.length;
              return (
                <View className="mt-3 flex-row items-center justify-between px-4 py-1">
                  <Text variant="heading" tone="default">
                    {mode === 'picked' ? 'Picked photos' : r.label}
                    <Text variant="caption">
                      {' '}
                      · {on} of {r.total}
                    </Text>
                  </Text>
                  <Button
                    label={allDay ? 'Deselect day' : 'Select day'}
                    variant="tertiary"
                    size="sm"
                    onPress={() => setDay(r.dayKey, !allDay)}
                  />
                </View>
              );
            }
            return (
              <View className="flex-row" style={{ gap: GAP, marginBottom: GAP }}>
                {r.items.map((it) => {
                  const dup = isDup(it);
                  return (
                    <View key={it.id} style={{ width: tile }}>
                      <PhotoTile
                        uri={it.uri}
                        state={dup ? 'duplicate' : selected.has(it.id) ? 'selected' : 'default'}
                        selectable={!dup}
                        radius={4}
                        label={`Photo from ${dayLabel(it.creationTime)}`}
                        onPress={dup ? undefined : () => toggle(it.id)}
                      />
                    </View>
                  );
                })}
              </View>
            );
          }}
        />
      )}

      {window ? (
        <DateWindowModal
          visible={windowOpen}
          window={window}
          rollWindow={roll0}
          onClose={() => setWindowOpen(false)}
          onApply={(w) => {
            setWindowOpen(false);
            setWindow(w);
          }}
        />
      ) : null}
    </Screen>
  );
}

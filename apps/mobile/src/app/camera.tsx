import { Camera, CameraView } from 'expo-camera';

const getCameraPermissionsAsync = () => Camera.getCameraPermissionsAsync();
const requestCameraPermissionsAsync = () => Camera.requestCameraPermissionsAsync();
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDestinationRoll, useDestinationStore } from '@/data/useDestinations';
import { destinationLabel, postedMessage } from '@/features/camera/destination';
import { cancelUpload, enqueueUploads } from '@/features/uploads';
import { formatStamp } from '@/lib/format';
import {
  Button,
  EdgeState,
  edge,
  FLASH,
  goBack,
  haptic,
  Icon,
  IconButton,
  INK,
  PermissionPrimer,
  PressableScale,
  Screen,
  SHUTTER,
  Text,
  toPermissionOutcome,
} from '@/ui';

type Perm = 'checking' | 'primer' | 'denied' | 'ready';

const MAX_IN_FLIGHT = 3;
const UNDO_MS = 5000;

/**
 * C1 Camera (fullScreenModal). Dark, edge to edge. Shoot posts straight to the destination Roll
 * (auto-post + 5 s Undo, burst allowed); the permission always goes through the A6 primer; the
 * gallery import and the destination sheet are one tap away.
 */
export default function CameraScreen() {
  const params = useLocalSearchParams<{ rollId?: string }>();
  const [perm, setPerm] = useState<Perm>('checking');

  useEffect(() => {
    let alive = true;
    getCameraPermissionsAsync()
      .then((r) => {
        if (!alive) return;
        if (r.granted) setPerm('ready');
        else setPerm(r.canAskAgain === false ? 'denied' : 'primer');
      })
      .catch(() => alive && setPerm('primer'));
    return () => {
      alive = false;
    };
  }, []);

  if (perm === 'checking') {
    return <View className="flex-1 bg-black" accessibilityLabel="Opening the camera" />;
  }
  if (perm !== 'ready') {
    return (
      <Screen header={{ close: true }} scroll>
        <PermissionPrimer
          kind="camera"
          initialDenied={perm === 'denied'}
          request={async () => toPermissionOutcome(await requestCameraPermissionsAsync())}
          check={async () => toPermissionOutcome(await getCameraPermissionsAsync())}
          onGranted={() => setPerm('ready')}
          onNotNow={goBack}
          onPickManually={() =>
            router.replace({ pathname: '/import', params: { rollId: params.rollId } })
          }
          pickManuallyLabel="Add from gallery"
        />
      </Screen>
    );
  }
  return <Viewfinder rollId={params.rollId} />;
}

function Viewfinder({ rollId }: { rollId?: string }) {
  const insets = useSafeAreaInsets();
  const cam = useRef<CameraView>(null);
  const inflight = useRef(0);
  const { roll, isLoading, isError, refetch } = useDestinationRoll('camera', rollId);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [ready, setReady] = useState(false);
  const [mountError, setMountError] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const [shots, setShots] = useState(0);
  const [lastUri, setLastUri] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ ids: string[]; rollName: string } | null>(null);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now, setNow] = useState(Date.now());

  // The date stamp in the corner ticks like the film-camera mockup.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(
    () => () => {
      if (batchTimer.current) clearTimeout(batchTimer.current);
    },
    [],
  );

  const openDestination = useCallback(() => {
    router.push({
      pathname: '/sheets/destination',
      params: { purpose: 'camera', selectedRollId: roll?.id ?? '' },
    });
  }, [roll?.id]);

  const openImport = useCallback(() => {
    router.push({ pathname: '/import', params: { rollId: roll?.id } });
  }, [roll?.id]);

  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-24, 24])
    .onEnd((e) => {
      if (e.translationY < -60) openImport();
    });

  const showHint = (text: string) => {
    setHint(text);
    setTimeout(() => setHint((h) => (h === text ? null : h)), 2200);
  };

  const rememberShot = (id: string, rollName: string) => {
    setBatch((cur) => ({ ids: [...(cur?.ids ?? []), id], rollName }));
    if (batchTimer.current) clearTimeout(batchTimer.current);
    batchTimer.current = setTimeout(() => setBatch(null), UNDO_MS);
  };

  const undo = () => {
    batch?.ids.forEach((id) => cancelUpload(id));
    setShots((n) => Math.max(0, n - (batch?.ids.length ?? 0)));
    setBatch(null);
    if (batchTimer.current) clearTimeout(batchTimer.current);
  };

  const onShutter = async () => {
    if (!roll) {
      openDestination();
      return;
    }
    if (!ready || inflight.current >= MAX_IN_FLIGHT) return;
    inflight.current += 1;
    haptic.heavy();
    try {
      const pic = await cam.current?.takePictureAsync({ quality: 1, exif: true });
      if (!pic) return;
      setLastUri(pic.uri);
      setShots((n) => n + 1);
      const [id] = await enqueueUploads(
        [
          {
            uri: pic.uri,
            width: pic.width,
            height: pic.height,
            takenAt: new Date().toISOString(),
            mime: 'image/jpeg',
          },
        ],
        { rollId: roll.id },
      );
      useDestinationStore.getState().setLast(roll.id);
      if (id) rememberShot(id, roll.name);
    } catch {
      showHint("That one didn't save. Try again.");
    } finally {
      inflight.current -= 1;
    }
  };

  if (mountError) {
    const c = edge.permissionDenied('camera');
    return (
      <Screen header={{ close: true }}>
        <EdgeState
          layout="screen"
          icon="camera"
          tone="lilac"
          title="The camera is busy"
          body="Another app is using it. Close that app and try again, or add from your gallery."
          primary={{
            label: 'Try again',
            onPress: () => {
              setMountError(false);
              setReady(false);
              setMountKey((k) => k + 1);
            },
          }}
          secondary={{
            label: c.secondaryLabel ?? 'Add from gallery',
            onPress: () => router.replace('/import'),
          }}
        />
      </Screen>
    );
  }

  const pillLabel = isLoading ? ' ' : destinationLabel(roll);
  const canShoot = ready && !isLoading;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <View className="flex-1 bg-black">
        <View className="flex-1 overflow-hidden rounded-b-[28px] bg-ink">
          <CameraView
            key={mountKey}
            ref={cam}
            style={{ flex: 1 }}
            facing={facing}
            flash={flash}
            mode="picture"
            animateShutter
            onCameraReady={() => setReady(true)}
            onMountError={() => setMountError(true)}
          />

          {/* top bar */}
          <View
            pointerEvents="box-none"
            className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4"
            style={{ paddingTop: insets.top + 8 }}
          >
            <IconButton icon="close" label="Close camera" variant="onDark" onPress={goBack} />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Destination: ${destinationLabel(roll)}. Change`}
              onPress={openDestination}
              className="h-11 flex-row items-center gap-2 rounded-pill bg-black/55 px-4"
            >
              {roll?.live ? <View className="h-2.5 w-2.5 rounded-pill bg-shutter" /> : null}
              <Text variant="heading" tone="inverse" numberOfLines={1} className="max-w-[170px]">
                {pillLabel}
              </Text>
              <Icon name="chevronDown" size={16} color="#F4F3F6" />
            </PressableScale>
            <IconButton
              icon="flash"
              label={flash === 'on' ? 'Flash on' : 'Flash off'}
              variant={flash === 'on' ? 'flash' : 'onDark'}
              onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))}
            />
          </View>

          {/* corner tags */}
          <View
            pointerEvents="none"
            className="absolute bottom-4 left-4 right-4 flex-row items-end justify-between"
          >
            <View className="rounded-pill bg-black/45 px-3 py-1.5">
              <Text variant="stamp" tone="inverse" className="text-[11px]">
                YOUR SHOT #{shots + 1}
              </Text>
            </View>
            <Text variant="stamp" className="text-[12px]" style={{ color: SHUTTER }}>
              {formatStamp(now, { seconds: false })}
            </Text>
          </View>

          {!ready ? (
            <Animated.View
              exiting={FadeOut.duration(200)}
              pointerEvents="none"
              className="absolute inset-0 bg-black"
            />
          ) : null}
        </View>

        {/* controls */}
        <GestureDetector gesture={swipe}>
          <View style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }} className="pt-3">
            <View className="mb-3 flex-row items-center justify-center gap-5">
              {(['SNAP', 'PHOTO', 'MULTI-ANGLE'] as const).map((m) =>
                m === 'PHOTO' ? (
                  <View key={m} className="h-9 justify-center rounded-pill bg-white/15 px-4">
                    <Text variant="stamp" tone="inverse" className="text-[12px]">
                      {m}
                    </Text>
                  </View>
                ) : (
                  <PressableScale
                    key={m}
                    accessibilityRole="button"
                    accessibilityLabel={`${m === 'SNAP' ? 'Snap' : 'Multi-Angle'}, coming soon`}
                    accessibilityState={{ disabled: true }}
                    onPress={() =>
                      showHint(`${m === 'SNAP' ? 'Snaps' : 'Multi-Angle'} are coming soon`)
                    }
                    haptics={false}
                    className="h-9 justify-center px-1 opacity-50"
                  >
                    <Text variant="stamp" tone="inverse" className="text-[12px]">
                      {m}
                    </Text>
                  </PressableScale>
                ),
              )}
            </View>

            <View className="flex-row items-center justify-between px-8">
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Add from gallery"
                onPress={openImport}
                className="h-14 w-14 items-center justify-center overflow-hidden rounded-[14px] border-2 border-white/80 bg-white/10"
              >
                {lastUri ? (
                  <Image
                    source={{ uri: lastUri }}
                    contentFit="cover"
                    style={{ width: 52, height: 52 }}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <Icon name="image" size={24} color="#F4F3F6" />
                )}
              </PressableScale>

              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={roll ? `Take photo for ${roll.name}` : 'Choose where to post'}
                accessibilityState={{ disabled: !canShoot }}
                disabled={!canShoot && !!roll}
                haptics={false}
                scaleTo={0.92}
                onPress={() => void onShutter()}
                wrapperStyle={{ minWidth: 88, minHeight: 88, alignItems: 'center' }}
                className={`h-[88px] w-[88px] items-center justify-center rounded-pill border-[4px] border-white ${
                  canShoot || !roll ? '' : 'opacity-60'
                }`}
              >
                <View
                  className="h-[68px] w-[68px] items-center justify-center rounded-pill"
                  style={{ backgroundColor: FLASH }}
                >
                  <View
                    className="h-[28px] w-[28px] rounded-pill border-2"
                    style={{ borderColor: INK }}
                  />
                </View>
              </PressableScale>

              <IconButton
                icon="flip"
                label="Flip camera"
                variant="onDark"
                size={52}
                onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              />
            </View>

            <Text variant="caption" tone="inverse" className="mt-3 text-center opacity-70">
              {hint ??
                (isError
                  ? "Can't load your Rolls. Tap the name above to retry."
                  : !roll && !isLoading
                    ? 'Tap the shutter to choose where to post'
                    : !ready
                      ? 'Getting the camera ready…'
                      : 'Swipe up for gallery')}
            </Text>
            {isError ? (
              <View className="mt-1 items-center">
                <Button label="Try again" variant="tertiary" size="sm" onDark onPress={refetch} />
              </View>
            ) : null}
          </View>
        </GestureDetector>

        {batch ? (
          <Animated.View
            entering={FadeIn.duration(140)}
            exiting={FadeOut.duration(120)}
            accessibilityLiveRegion="polite"
            className="absolute left-4 right-4 min-h-[48px] flex-row items-center justify-between rounded-input bg-ink-dark/95 py-1 pl-4 pr-2 dark:bg-surface-dark"
            style={{ bottom: Math.max(insets.bottom, 12) + 150, backgroundColor: '#2A2830' }}
          >
            <Text variant="body" tone="inverse" className="flex-1 pr-2" numberOfLines={1}>
              {postedMessage(batch.ids.length, batch.rollName)}
            </Text>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Undo"
              onPress={undo}
              className="px-3"
            >
              <Text variant="heading" tone="flash">
                Undo
              </Text>
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>
    </GestureHandlerRootView>
  );
}

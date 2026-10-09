import { Image } from 'expo-image';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSignedUrl } from '../data/media';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { FLASH, INK, SHUTTER } from './theme';

export type PhotoTileState =
  'default' | 'selected' | 'uploading' | 'failed' | 'duplicate' | 'sealed';

export interface PhotoTileProps {
  /** Photo id: resolves the signed URL (batched) and is used for expo-image `cacheKey`/`recyclingKey`. */
  photoId?: string;
  /** thumb for grids (default), display for the viewer. */
  variant?: 'thumb' | 'display';
  /** Explicit image URI (local file for pending uploads). Overrides the signed URL. */
  uri?: string | null;
  blurhash?: string | null;
  state?: PhotoTileState;
  /** 0..1 for `uploading`; omit for an indeterminate ring. */
  progress?: number;
  /** Width/height ratio. Default 1 (square). */
  aspectRatio?: number;
  /** Show an empty selection circle (select mode, not yet selected). */
  selectable?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Tap on the retry badge (`failed`). Falls back to onPress. */
  onRetry?: () => void;
  /** Spoken description, e.g. "Photo by Diya, 13 March". */
  label?: string;
  /** Corner radius (tile = 10). */
  radius?: number;
}

const RING = 44;
const RING_STROKE = 4;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

function ProgressRing({ progress }: { progress?: number }) {
  const p = progress === undefined ? 0.28 : Math.min(1, Math.max(0, progress));
  return (
    <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={RING_R}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={RING_STROKE}
        fill="none"
      />
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={RING_R}
        stroke={FLASH}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${RING_C} ${RING_C}`}
        strokeDashoffset={RING_C * (1 - p)}
        rotation={-90}
        origin={`${RING / 2}, ${RING / 2}`}
      />
    </Svg>
  );
}

function describe(state: PhotoTileState, progress?: number, label?: string): string {
  const base = label ?? 'Photo';
  switch (state) {
    case 'selected':
      return `${base}, selected`;
    case 'uploading':
      return `${base}, uploading${progress !== undefined ? ` ${Math.round(progress * 100)} percent` : ''}`;
    case 'failed':
      return `${base}, upload failed. Double tap to retry`;
    case 'duplicate':
      return `${base}, already in this Roll`;
    case 'sealed':
      return `${base}, sealed until the reveal`;
    default:
      return base;
  }
}

/**
 * Grid / import tile with six states (design-system §7): default, selected (lime outline + check),
 * uploading (grey overlay + progress ring), failed (retry badge), duplicate ("IN ROLL"), sealed (ink + lock).
 * Images use expo-image with a blurhash placeholder and a stable `cacheKey` = `photoId:variant`.
 */
export function PhotoTile({
  photoId,
  variant = 'thumb',
  uri,
  blurhash,
  state = 'default',
  progress,
  aspectRatio = 1,
  selectable = false,
  onPress,
  onLongPress,
  onRetry,
  label,
  radius = 10,
}: PhotoTileProps) {
  const signed = useSignedUrl(uri ? null : photoId, variant);
  const src = uri ?? signed;
  const sealed = state === 'sealed';
  const cacheKey = photoId ? `${photoId}:${variant}` : undefined;

  const surface = (
    <View
      className="w-full overflow-hidden bg-line dark:bg-line-dark"
      style={{ aspectRatio, borderRadius: radius, backgroundColor: sealed ? INK : undefined }}
    >
      {sealed ? (
        <View className="flex-1 items-center justify-center">
          <Icon name="lock" size={28} color={FLASH} />
        </View>
      ) : (
        <Image
          source={src ? { uri: src, cacheKey } : undefined}
          placeholder={blurhash ? { blurhash } : undefined}
          recyclingKey={photoId}
          contentFit="cover"
          transition={140}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          accessibilityIgnoresInvertColors
        />
      )}

      {state === 'uploading' ? (
        <View className="absolute inset-0 items-center justify-center bg-black/45">
          <ProgressRing progress={progress} />
        </View>
      ) : null}

      {state === 'duplicate' ? (
        <View className="absolute inset-0 justify-end bg-black/45">
          <View className="items-center pb-1.5">
            <Text variant="stamp" tone="inverse" className="text-[10px]">
              IN ROLL
            </Text>
          </View>
        </View>
      ) : null}

      {state === 'selected' ? (
        <View
          pointerEvents="none"
          className="absolute inset-0"
          style={{ borderWidth: 3, borderColor: FLASH, borderRadius: radius }}
        />
      ) : null}

      {state === 'selected' ? (
        <View
          className="absolute right-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-pill"
          style={{ backgroundColor: FLASH }}
        >
          <Icon name="check" size={14} color={INK} strokeWidth={3} />
        </View>
      ) : selectable && state === 'default' ? (
        <View
          className="absolute right-1.5 top-1.5 h-6 w-6 rounded-pill"
          style={{
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.9)',
            backgroundColor: 'rgba(0,0,0,0.15)',
          }}
        />
      ) : null}
    </View>
  );

  const failedBadge =
    state === 'failed' ? (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Retry upload"
        onPress={onRetry ?? onPress}
        wrapperStyle={{
          position: 'absolute',
          right: -8,
          top: -8,
          minHeight: 44,
          minWidth: 44,
          alignItems: 'center',
        }}
        className="h-7 w-7 items-center justify-center rounded-pill"
        style={{ backgroundColor: SHUTTER }}
      >
        <Icon name="refresh" size={15} color="#FFFFFF" strokeWidth={2.5} />
      </PressableScale>
    ) : null;

  return (
    <View>
      <PressableScale
        accessibilityRole="imagebutton"
        accessibilityLabel={describe(state, progress, label)}
        accessibilityState={{ selected: state === 'selected', busy: state === 'uploading' }}
        onPress={onPress}
        onLongPress={onLongPress}
        haptics={false}
        scaleTo={0.97}
        hitSlop={0}
        wrapperStyle={{ minHeight: 0, minWidth: 0 }}
      >
        {surface}
      </PressableScale>
      {failedBadge}
    </View>
  );
}

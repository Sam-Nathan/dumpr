import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useAvatarUrl } from '../data/media';
import type { CrewTint, RingColor } from '../data/types';
import { initials } from '../lib/format';
import { Text } from './Text';
import { RING_HEX, TINT_BG, tintFor } from './theme';

export interface AvatarProps {
  /** Display name: used for initials and the stable fallback tint. */
  name: string;
  /** Signed / local image URL. */
  uri?: string | null;
  /** `profiles.avatar_key`: resolved to a signed URL through the batched cache. */
  avatarKey?: string | null;
  /** Diameter in dp. Default 40. */
  size?: number;
  /** Ring colour (profile `ring_color`). 'none' draws no ring. */
  ring?: RingColor | 'none';
  /** Fallback tint; defaults to a stable colour derived from the name. */
  tint?: CrewTint;
  /** Small node at the bottom-right (camera badge, online dot). */
  badge?: ReactNode;
}

/** Avatar with initials fallback on a stable "random" crew tint and an optional ring. */
export function Avatar({ name, uri, avatarKey, size = 40, ring = 'none', tint, badge }: AvatarProps) {
  const signed = useAvatarUrl(uri ? null : avatarKey);
  const src = uri ?? signed;
  const ringWidth = ring === 'none' ? 0 : size >= 64 ? 4 : size >= 40 ? 3 : 2;
  const inner = size - ringWidth * 2 - (ring === 'none' ? 0 : 2);
  const fontSize = Math.max(10, Math.round(inner * 0.38));
  const fallback = TINT_BG[tint ?? tintFor(name)];

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name || 'Someone'}'s photo`}
      style={{ width: size, height: size }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ringWidth,
          borderColor: ring === 'none' ? 'transparent' : RING_HEX[ring],
          alignItems: 'center',
          justifyContent: 'center',
          padding: ring === 'none' ? 0 : 1,
        }}
      >
        {src ? (
          <Image
            source={{ uri: src, cacheKey: avatarKey ?? undefined }}
            recyclingKey={avatarKey ?? undefined}
            contentFit="cover"
            transition={120}
            style={{ width: inner, height: inner, borderRadius: inner / 2 }}
          />
        ) : (
          <View
            className={`items-center justify-center ${fallback}`}
            style={{ width: inner, height: inner, borderRadius: inner / 2 }}
          >
            <Text
              variant="heading"
              tone="default"
              className="font-body-bold"
              style={{ fontSize, lineHeight: fontSize + 4 }}
              maxFontSizeMultiplier={1.2}
            >
              {initials(name)}
            </Text>
          </View>
        )}
      </View>
      {badge ? <View className="absolute -bottom-0.5 -right-0.5">{badge}</View> : null}
    </View>
  );
}

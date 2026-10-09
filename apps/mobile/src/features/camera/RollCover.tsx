import { Image } from 'expo-image';
import { View } from 'react-native';
import { useSignedUrl } from '@/data/media';
import type { CrewTint } from '@/data/types';
import { TINT_BG } from '@/ui';

/** Small rounded roll cover: the cover photo's thumb, or the Crew tint while there is none. */
export function RollCover({
  photoId,
  tint,
  size = 48,
  radius = 12,
}: {
  photoId: string | null | undefined;
  tint: CrewTint;
  size?: number;
  radius?: number;
}) {
  const url = useSignedUrl(photoId, 'thumb');
  return (
    <View
      className={`overflow-hidden ${TINT_BG[tint]}`}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {photoId && url ? (
        <Image
          source={{ uri: url, cacheKey: `${photoId}:thumb` }}
          recyclingKey={photoId}
          contentFit="cover"
          transition={120}
          style={{ width: size, height: size }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

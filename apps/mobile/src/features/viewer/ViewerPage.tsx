import { Image } from 'expo-image';
import { View, useWindowDimensions } from 'react-native';
import { Pressable } from 'react-native';
import { useSignedUrl } from '@/data/media';
import type { GridPhoto } from '@/data/types-b';
import { Button, Skeleton, Text } from '@/ui';
import { edge } from '@/ui';

/** One full-bleed page: thumbnail (placeholder) cross-fading into the display image. */
export function PhotoPage({ photo, onTap }: { photo: GridPhoto; onTap: () => void }) {
  const { width, height } = useWindowDimensions();
  const display = useSignedUrl(photo.id, 'display');
  const thumb = useSignedUrl(photo.id, 'thumb');
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={photo.caption ? `Photo: ${photo.caption}` : 'Photo'}
      accessibilityHint="Double tap to show or hide the controls"
      onPress={onTap}
      style={{ width, height, backgroundColor: '#000' }}
    >
      <Image
        source={display ? { uri: display, cacheKey: `${photo.id}:display` } : undefined}
        placeholder={
          thumb
            ? { uri: thumb, cacheKey: `${photo.id}:thumb` }
            : photo.blurhash
              ? { blurhash: photo.blurhash }
              : undefined
        }
        placeholderContentFit="contain"
        recyclingKey={photo.id}
        contentFit="contain"
        transition={220}
        style={{ width, height }}
        accessibilityIgnoresInvertColors
      />
    </Pressable>
  );
}

/** "This photo was removed": shown in place of the photo, with a way to move on. */
export function RemovedPage({
  who,
  onNext,
  onBack,
  hasNext,
}: {
  who?: string | null;
  onNext: () => void;
  onBack: () => void;
  hasNext: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const c = edge.photoRemoved(who);
  return (
    <View style={{ width, height }} className="items-center justify-center bg-black px-8">
      <Text variant="title" heading tone="inverse" className="text-center">
        {c.title}
      </Text>
      <Text variant="body" tone="inverse" className="mt-2 text-center opacity-80">
        {c.body}
      </Text>
      <View className="mt-6 w-full gap-1">
        {hasNext ? (
          <Button label="Next photo" variant="strong" size="lg" onDark onPress={onNext} />
        ) : null}
        <Button label="Back to the Roll" variant="secondary" size="lg" onDark onPress={onBack} />
      </View>
    </View>
  );
}

export function ViewerSkeleton() {
  return (
    <View className="flex-1 items-center justify-center bg-black">
      <Skeleton width="80%" height={320} radius={16} className="bg-white/10" />
    </View>
  );
}

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSession } from '@/data/session';
import { fetchRollPhotoPage, type RollPhotoCursor } from '@/features/downloads/rollPhotos';
import { BottomModal, Chip, EdgeState, PhotoTile, Skeleton, Text, useColors } from '@/ui';

export interface PickerRoll {
  id: string;
  name: string;
  sealed: boolean;
}

/** Attach a photo from a Roll to a chat message (MVP: choose from the Roll's photos). */
export function PhotoPickerModal({
  visible,
  onClose,
  rolls,
  initialRollId,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  rolls: PickerRoll[];
  initialRollId?: string | null;
  onPick: (photoId: string) => void;
}) {
  const { user } = useSession();
  const colors = useColors();
  const [rollId, setRollId] = useState<string | null>(initialRollId ?? rolls[0]?.id ?? null);
  useEffect(() => {
    if (visible && !rollId) setRollId(initialRollId ?? rolls[0]?.id ?? null);
  }, [visible, rollId, initialRollId, rolls]);

  const q = useInfiniteQuery({
    queryKey: ['chat-photos', rollId],
    enabled: visible && !!rollId,
    initialPageParam: null as RollPhotoCursor | null,
    queryFn: ({ pageParam }) =>
      fetchRollPhotoPage(rollId as string, pageParam, { meId: user?.id, limit: 60 }),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const photos = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <BottomModal visible={visible} onClose={onClose} title="Choose a photo" scroll={false}>
      {rolls.length > 1 ? (
        <FlatList
          horizontal
          data={rolls}
          keyExtractor={(r) => r.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
          style={{ flexGrow: 0 }}
          renderItem={({ item }) => (
            <Chip
              label={item.name}
              selected={item.id === rollId}
              onPress={() => setRollId(item.id)}
            />
          )}
        />
      ) : null}
      <View style={{ height: 360 }}>
        {q.isLoading ? (
          <View className="flex-row flex-wrap gap-1">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} width="32%" height={100} radius={8} />
            ))}
          </View>
        ) : q.isError ? (
          <EdgeState
            icon="alert"
            tone="sky"
            title="Can't load photos"
            body="Check your connection and try again."
            primary={{ label: 'Try again', onPress: () => void q.refetch() }}
          />
        ) : photos.length === 0 ? (
          <Text variant="body" className="mt-4 text-center">
            No photos in this Roll yet.
          </Text>
        ) : (
          <FlatList
            data={photos}
            numColumns={3}
            keyExtractor={(p) => p.id}
            columnWrapperStyle={{ gap: 4 }}
            contentContainerStyle={{ gap: 4 }}
            onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
            ListFooterComponent={
              q.isFetchingNextPage ? <ActivityIndicator color={colors.ink3} /> : null
            }
            renderItem={({ item }) => (
              <View style={{ flex: 1 / 3 }}>
                <PhotoTile
                  photoId={item.id}
                  blurhash={item.blurhash}
                  radius={8}
                  label="Photo from this Roll"
                  onPress={() => {
                    onPick(item.id);
                    onClose();
                  }}
                />
              </View>
            )}
          />
        )}
      </View>
    </BottomModal>
  );
}

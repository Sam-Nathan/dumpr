import { useState } from 'react';
import { View } from 'react-native';
import type { GridPhoto } from '@/data/types-b';
import { Button, EdgeState, ModalSheet, PhotoTile, Skeleton, Text } from '@/ui';

/** Admin queue for guest photos: tap to select, then approve or reject. */
export function ReviewModal({
  visible,
  onClose,
  photos,
  loading,
  busy,
  onDecide,
}: {
  visible: boolean;
  onClose: () => void;
  photos: GridPhoto[];
  loading: boolean;
  busy: boolean;
  onDecide: (ids: string[], approve: boolean) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ids = picked.size > 0 ? [...picked] : photos.map((p) => p.id);
  const scope = picked.size > 0 ? `${picked.size} selected` : 'all';
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <ModalSheet
      visible={visible}
      onClose={() => {
        setPicked(new Set());
        onClose();
      }}
      title="Guest photos"
      eyebrow="WAITING FOR YOU"
      footer={
        photos.length > 0 ? (
          <View className="gap-1">
            <Button
              label={picked.size > 0 ? `Approve ${picked.size}` : 'Approve all'}
              variant="primary"
              size="lg"
              loading={busy}
              onPress={() => {
                onDecide(ids, true);
                setPicked(new Set());
              }}
            />
            <Button
              label={`Reject ${scope}`}
              variant="destructive"
              fullWidth
              disabled={busy}
              onPress={() => {
                onDecide(ids, false);
                setPicked(new Set());
              }}
            />
          </View>
        ) : undefined
      }
    >
      {loading ? (
        <View className="flex-row flex-wrap gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} width="31%" height={96} radius={10} />
          ))}
        </View>
      ) : photos.length === 0 ? (
        <EdgeState
          icon="checkCircle"
          tone="mint"
          title="All caught up"
          body="No guest photos are waiting for review."
        />
      ) : (
        <View>
          <Text variant="caption" className="mb-2">
            Tap photos to choose. With none chosen, the buttons apply to all {photos.length}.
          </Text>
          <View className="flex-row flex-wrap" style={{ gap: 6 }}>
            {photos.map((p) => (
              <View key={p.id} style={{ width: '31.5%' }}>
                <PhotoTile
                  photoId={p.id}
                  blurhash={p.blurhash}
                  state={picked.has(p.id) ? 'selected' : 'default'}
                  selectable
                  onPress={() => toggle(p.id)}
                  label="Guest photo"
                />
              </View>
            ))}
          </View>
        </View>
      )}
    </ModalSheet>
  );
}

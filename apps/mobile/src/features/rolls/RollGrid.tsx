import { View } from 'react-native';
import type { UploadItemView } from '@/features/uploads';
import type { GridPhoto } from '@/data/types-b';
import { Icon, PhotoTile, Text, FLASH, INK, type PhotoTileState } from '@/ui';
import type { GridRow } from './grid';

export type Cell =
  | { kind: 'photo'; id: string; photo: GridPhoto }
  | { kind: 'upload'; id: string; item: UploadItemView }
  | { kind: 'sealed'; id: string };

export const GAP = 2;

function uploadState(s: UploadItemView['state']): PhotoTileState {
  if (s === 'failed' || s === 'blocked') return 'failed';
  if (s === 'duplicate') return 'duplicate';
  return 'uploading';
}

export interface GridCtx {
  columns: number;
  selectMode: boolean;
  selected: ReadonlySet<string>;
  meId: string | undefined;
  sealed: boolean;
  onOpen: (photo: GridPhoto) => void;
  onLongPress: (photo: GridPhoto) => void;
  onRetry: (uploadId: string) => void;
}

function renderCell(cell: Cell, ctx: GridCtx) {
  if (cell.kind === 'sealed') {
    return <PhotoTile state="sealed" label="Sealed photo" />;
  }
  if (cell.kind === 'upload') {
    const it = cell.item;
    return (
      <PhotoTile
        uri={it.thumbUri ?? it.localUri}
        state={uploadState(it.state)}
        progress={it.progress}
        onRetry={() => ctx.onRetry(it.id)}
        onPress={uploadState(it.state) === 'failed' ? () => ctx.onRetry(it.id) : undefined}
        label="Your photo"
      />
    );
  }
  const p = cell.photo;
  const selected = ctx.selected.has(p.id);
  const mine = p.uploader_id === ctx.meId;
  return (
    <View>
      <PhotoTile
        photoId={p.id}
        blurhash={p.blurhash}
        state={selected ? 'selected' : 'default'}
        selectable={ctx.selectMode}
        onPress={() => ctx.onOpen(p)}
        onLongPress={() => ctx.onLongPress(p)}
        label={p.caption ? `Photo: ${p.caption}` : 'Photo'}
      />
      {ctx.sealed && mine ? (
        <View
          pointerEvents="none"
          className="absolute bottom-1.5 left-1.5 h-6 w-6 items-center justify-center rounded-pill"
          style={{ backgroundColor: FLASH }}
        >
          <Icon name="lock" size={13} color={INK} strokeWidth={2.5} />
        </View>
      ) : null}
      {p.status === 'review' ? (
        <View
          pointerEvents="none"
          className="absolute left-1.5 top-1.5 rounded-pill bg-ink px-2 py-0.5"
        >
          <Text variant="stamp" className="text-[10px]">
            REVIEW
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** One list row: a section header or `columns` tiles. */
export function GridRowView({ row, ctx }: { row: GridRow<Cell>; ctx: GridCtx }) {
  if (row.type === 'header') {
    return (
      <View className="flex-row items-baseline justify-between bg-paper px-4 pb-2 pt-4 dark:bg-paper-dark">
        <Text variant="heading" heading className="text-[18px]">
          {row.title}
          {row.subtitle ? (
            <Text variant="caption" className="text-[13px]">
              {'  '}
              {row.subtitle}
            </Text>
          ) : null}
        </Text>
      </View>
    );
  }
  const filler = Math.max(0, ctx.columns - row.photos.length);
  return (
    <View className="flex-row px-1" style={{ gap: GAP, marginBottom: GAP }}>
      {row.photos.map((c) => (
        <View key={c.id} style={{ flex: 1 }}>
          {renderCell(c, ctx)}
        </View>
      ))}
      {Array.from({ length: filler }, (_, i) => (
        <View key={`f${i}`} style={{ flex: 1 }} />
      ))}
    </View>
  );
}

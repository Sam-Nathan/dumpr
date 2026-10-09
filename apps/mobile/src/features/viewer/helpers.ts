/** Pure helpers for the B4 viewer and the Save flow. */
import type { ReactionKind } from '../../data/types';
import type { ReactionState } from '../../data/types-b';

export interface ViewerRow {
  id: string;
  /** The photo was taken down while the viewer was open: render "This photo was removed". */
  removed?: boolean;
}

/**
 * Keep a placeholder where a photo vanished (removed by its uploader or a host) so the pager does
 * not jump: every id that was in `prev` (or already a placeholder) but is missing from `next` is
 * re-inserted at its old index, flagged `removed`.
 */
export function withTombstones<T extends { id: string }>(
  prev: readonly (T | ViewerRow)[],
  next: readonly T[],
): (T | ViewerRow)[] {
  const present = new Set(next.map((r) => r.id));
  const out: (T | ViewerRow)[] = [...next];
  prev.forEach((row, index) => {
    if (present.has(row.id)) return;
    const tomb: ViewerRow = { id: row.id, removed: true };
    out.splice(Math.min(index, out.length), 0, tomb);
  });
  return out;
}

export function isRemovedRow(row: ViewerRow | { status?: string }): boolean {
  return ('removed' in row && row.removed === true) || ('status' in row && row.status === 'removed');
}

/** Android albums are directories: strip characters they cannot hold. "Dumpr/Goa '26". */
export function albumName(rollName: string): string {
  const clean = rollName
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return clean ? `Dumpr/${clean}` : 'Dumpr';
}

export type SaveVariant = 'original' | 'display';

/**
 * Which file to save. Default is the original. HEIC / HEIF does not open in most Android galleries
 * and chat apps, so Android gets the "High · JPG" display variant instead.
 */
export function saveVariantFor(mime: string | null | undefined, platform: string): SaveVariant {
  const heic = /hei[cf]/i.test(mime ?? '');
  return heic && platform === 'android' ? 'display' : 'original';
}

export function extensionFor(mime: string | null | undefined, variant: SaveVariant): string {
  if (variant === 'display') return 'jpg';
  const m = (mime ?? '').toLowerCase();
  if (m.includes('heic')) return 'heic';
  if (m.includes('heif')) return 'heif';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  return 'jpg';
}

export type CaptionPart = { text: string; tag: boolean };

/** Split a caption so #hashtags can be highlighted. */
export function captionParts(caption: string): CaptionPart[] {
  return caption
    .split(/(#[\p{L}\p{N}_-]+)/u)
    .filter((t) => t.length > 0)
    .map((text) => ({ text, tag: text.startsWith('#') && text.length > 1 }));
}

/** Counts after I switch my single reaction to `next` (`null` removes it). */
export function applyReaction(state: ReactionState, next: ReactionKind | null): ReactionState {
  const counts = { ...state.counts };
  if (state.mine) counts[state.mine] = Math.max(0, (counts[state.mine] ?? 1) - 1);
  if (next) counts[next] = (counts[next] ?? 0) + 1;
  return { counts, mine: next };
}

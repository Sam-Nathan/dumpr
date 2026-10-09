import { toAppError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import type { RollPhotoRef } from '../../data/types-cf';

export interface RollPhotoCursor {
  sortAt: string;
  id: string;
}

export interface RollPhotoPage {
  items: RollPhotoRef[];
  next: RollPhotoCursor | null;
}

interface Row {
  id: string;
  uploader_id: string;
  sort_at: string;
  mime: string;
  bytes: number;
  chapter_id: string | null;
  blurhash: string | null;
  visibility: 'everyone' | 'selected' | 'only_me';
}

/**
 * One keyset page of a Roll's ready photos, newest first (same ordering as the B3 grid:
 * `(sort_at, id) desc`). Used by the download job and the chat photo picker.
 *
 * `forDownload` leaves out Ghost photos that are not the viewer's own ("Ghost photos never
 * included"); `onlyMine` keeps just the viewer's photos (host turned downloads off).
 */
export async function fetchRollPhotoPage(
  rollId: string,
  cursor: RollPhotoCursor | null,
  opts: {
    limit?: number;
    chapterId?: string | null;
    meId?: string | null;
    onlyMine?: boolean;
    forDownload?: boolean;
  } = {},
): Promise<RollPhotoPage> {
  const limit = opts.limit ?? 60;
  let q = supabase
    .from('photos')
    .select('id, uploader_id, sort_at, mime, bytes, chapter_id, blurhash, visibility')
    .eq('roll_id', rollId)
    .eq('status', 'ready')
    .order('sort_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (opts.chapterId) q = q.eq('chapter_id', opts.chapterId);
  if (opts.onlyMine && opts.meId) q = q.eq('uploader_id', opts.meId);
  if (cursor) {
    q = q.or(`sort_at.lt.${cursor.sortAt},and(sort_at.eq.${cursor.sortAt},id.lt.${cursor.id})`);
  }
  const { data, error } = await q;
  if (error) throw toAppError(error);
  const rows = (data ?? []) as unknown as Row[];
  const last = rows[rows.length - 1];
  const items = rows
    .filter((r) => !opts.forDownload || r.visibility === 'everyone' || r.uploader_id === opts.meId)
    .map<RollPhotoRef>((r) => ({
      id: r.id,
      sortAt: r.sort_at,
      uploaderId: r.uploader_id,
      mime: r.mime,
      bytes: r.bytes,
      chapterId: r.chapter_id,
      blurhash: r.blurhash,
    }));
  return {
    items,
    next: rows.length >= limit && last ? { sortAt: last.sort_at, id: last.id } : null,
  };
}

/** Every photo of a Roll (all pages), for the download job. */
export async function fetchAllRollPhotos(
  rollId: string,
  opts: Parameters<typeof fetchRollPhotoPage>[2] & { signal?: { aborted: boolean } } = {},
): Promise<RollPhotoRef[]> {
  const out: RollPhotoRef[] = [];
  let cursor: RollPhotoCursor | null = null;
  for (;;) {
    if (opts.signal?.aborted) break;
    const page: RollPhotoPage = await fetchRollPhotoPage(rollId, cursor, { ...opts, limit: 500 });
    out.push(...page.items);
    if (!page.next) break;
    cursor = page.next;
  }
  return out;
}

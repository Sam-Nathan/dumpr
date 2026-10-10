// Page trimming for the Roll grid infinite query. Pure (types only): unit-tested with vitest.
import type { InfiniteData } from '@tanstack/react-query';

/**
 * Keyset pages are contiguous: when new photos land on top, refetching page 1 alone would leave a hole
 * between page 1 and page 2, while refetching every loaded page costs N requests per upload. So a refresh
 * keeps page 1 only and lets the list's `onEndReached` page forward again.
 */
export function trimToFirstPage<T, P>(
  data: InfiniteData<T, P> | undefined,
): InfiniteData<T, P> | undefined {
  if (!data || data.pages.length <= 1) return data;
  return { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
}

/** The slice of QueryClient the refresh needs (so the upload worker can hold a structural client). */
export interface RollPhotosQueryClient {
  setQueriesData(
    filters: { queryKey: readonly unknown[] },
    updater: (
      old: InfiniteData<unknown, unknown> | undefined,
    ) => InfiniteData<unknown, unknown> | undefined,
  ): unknown;
  invalidateQueries(filters: { queryKey: readonly unknown[] }): unknown;
}

/** Trim every cached grid of the roll (all chapters) to page 1, then refetch it. */
export function refreshRollPhotos(qc: RollPhotosQueryClient, rollId: string): void {
  const queryKey = ['roll-photos', rollId] as const;
  qc.setQueriesData({ queryKey }, (old) => trimToFirstPage(old));
  void qc.invalidateQueries({ queryKey });
}

import { QueryClient } from '@tanstack/react-query';
import { isRetryable, toAppError } from '../lib/errors';

/**
 * App-wide QueryClient. Nothing is persisted to disk yet (cached content shows first while the
 * app is open; a persister can be added here later without touching screens).
 *
 * Query key conventions: see docs/mobile-conventions.md.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      // Retry only connectivity / server hiccups, never permission or validation errors.
      retry: (failureCount, error) => failureCount < 2 && isRetryable(toAppError(error)),
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

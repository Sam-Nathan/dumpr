import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

/** Pop one level, or go Home when there is nothing to pop (deep link / cold start). */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Intercept Android hardware back (and the header back) on the focused screen.
 * Return true from `handler` when you handled it (e.g. closed a step or a select mode); return false
 * to let the default "pop one level" happen.
 */
export function useBackHandler(handler: () => boolean, enabled = true): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', handler);
      return () => sub.remove();
    }, [handler, enabled]),
  );
}

import { type Href, router } from 'expo-router';
import { useEffect } from 'react';
import { notificationUrlToPath } from '../../lib/deeplinks';
import { pushSupported } from './register';

/** Notification ids already navigated for (a cold-start response is also replayed by the listener). */
let lastHandledId: string | null = null;

interface TapResponse {
  actionIdentifier: string;
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> } } };
}

function open(response: TapResponse | null | undefined, defaultAction: string) {
  if (!response || response.actionIdentifier !== defaultAction) return;
  const id = response.notification.request.identifier;
  if (id === lastHandledId) return;
  lastHandledId = id;
  const url = response.notification.request.content.data?.url;
  const path = notificationUrlToPath(typeof url === 'string' ? url : null);
  if (path) router.push(path as Href);
}

/**
 * Push tap -> screen. Mount it only while the auth gate is `ready` (so the destination route exists):
 * handles the tap that cold-started the app (`getLastNotificationResponseAsync`) and taps while it runs.
 * No-op in Expo Go / without a project id, where remote push is not available.
 */
export function useNotificationTaps(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !pushSupported()) return;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;
    void import('expo-notifications')
      .then(async (N) => {
        if (cancelled) return;
        sub = N.addNotificationResponseReceivedListener((r) =>
          open(r as TapResponse, N.DEFAULT_ACTION_IDENTIFIER),
        );
        const last = await N.getLastNotificationResponseAsync();
        if (!cancelled) open(last as TapResponse | null, N.DEFAULT_ACTION_IDENTIFIER);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);
}

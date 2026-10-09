import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { getSessionSnapshot } from '../../data/session';
import { supabase } from '../../lib/supabase';
import type { PermissionOutcome } from '../../ui/PermissionPrimer';

/**
 * Push registration. Rules (flows.md cross-platform table): ask only AFTER the first join, never on
 * launch, always through the A6 primer; one Android channel per type.
 *
 * expo-notifications is imported lazily so Expo Go (no remote push since SDK 53) never loads the push
 * code paths at startup.
 */

const PRIMER_SHOWN_KEY = 'dumpr.push.primer-shown';

/** Android channels, one per notification type (ids match push-dispatch `channelId`). */
export const ANDROID_CHANNELS = [
  { id: 'invites', name: 'Invites', importance: 'HIGH' },
  { id: 'uploads', name: 'Uploads', importance: 'LOW' },
  { id: 'chats', name: 'Chats', importance: 'DEFAULT' },
  { id: 'reveals', name: 'Reveals', importance: 'HIGH' },
  { id: 'games', name: 'Games', importance: 'DEFAULT' },
] as const;

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/** Remote push needs a dev/production build with an EAS project id. */
export function pushSupported(): boolean {
  if (Platform.OS === 'web') return false;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false; // Expo Go
  return !!projectId();
}

let configured = false;

/** Foreground behaviour + Android channels. Safe to call on every launch. */
export async function configureNotifications(): Promise<void> {
  if (configured || !pushSupported()) return;
  configured = true;
  try {
    const N = await import('expo-notifications');
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      for (const c of ANDROID_CHANNELS) {
        await N.setNotificationChannelAsync(c.id, {
          name: c.name,
          importance: N.AndroidImportance[c.importance],
          lightColor: '#D4FF3F',
        });
      }
    }
  } catch {
    configured = false;
  }
}

async function currentOutcome(): Promise<PermissionOutcome> {
  const N = await import('expo-notifications');
  const r = await N.getPermissionsAsync();
  if (r.granted) return 'granted';
  return r.canAskAgain ? 'denied' : 'blocked';
}

/** Get the Expo push token and upsert it into `push_tokens` (direct upsert of own row). */
async function saveToken(): Promise<boolean> {
  const session = getSessionSnapshot();
  const id = projectId();
  if (!session || session.user.is_anonymous || !id) return false;
  const N = await import('expo-notifications');
  const { data: token } = await N.getExpoPushTokenAsync({ projectId: id });
  const { error } = await supabase.from('push_tokens').upsert(
    {
      token,
      user_id: session.user.id,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'token' },
  );
  return !error;
}

/** OS prompt + token save. Used by the notifications primer sheet's "Allow". */
export async function requestPushPermissionAndRegister(): Promise<PermissionOutcome> {
  if (!pushSupported()) return 'denied';
  await configureNotifications();
  const N = await import('expo-notifications');
  const r = await N.requestPermissionsAsync();
  const outcome: PermissionOutcome = r.granted ? 'granted' : r.canAskAgain ? 'denied' : 'blocked';
  if (outcome === 'granted') await saveToken().catch(() => false);
  return outcome;
}

/** Re-check (back from Settings). */
export async function checkPushPermission(): Promise<PermissionOutcome> {
  if (!pushSupported()) return 'denied';
  return currentOutcome();
}

/**
 * Call after a successful join (and on later launches). Never prompts on its own:
 * - unsupported (Expo Go, no projectId, guest) -> silently skips;
 * - already granted -> refreshes the token;
 * - undecided and the primer was never shown -> opens the A6 notifications primer sheet once.
 */
export async function maybeRegisterForPush(): Promise<'registered' | 'primer' | 'skipped'> {
  try {
    if (!pushSupported()) return 'skipped';
    const session = getSessionSnapshot();
    if (!session || session.user.is_anonymous) return 'skipped';
    await configureNotifications();
    const outcome = await currentOutcome();
    if (outcome === 'granted') return (await saveToken()) ? 'registered' : 'skipped';
    if (outcome === 'blocked') return 'skipped';
    if (await AsyncStorage.getItem(PRIMER_SHOWN_KEY)) return 'skipped';
    await AsyncStorage.setItem(PRIMER_SHOWN_KEY, '1');
    router.push('/sheets/notifications');
    return 'primer';
  } catch {
    return 'skipped';
  }
}

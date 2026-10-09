import '../../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import {
  DarkTheme,
  DefaultTheme,
  router,
  Stack,
  ThemeProvider,
  usePathname,
  useRootNavigationState,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthGate } from '../data/gate';
import { queryClient } from '../data/queryClient';
import type { AuthGateState } from '../data/profileGate';
import { usePendingInvite } from '../features/invites/pendingInvite';
import { configureNotifications } from '../features/notifications/register';
import { setUploadQueryClient, startUploadWorker } from '../features/uploads';
import { inviteHref } from '../lib/deeplinks';
import { fontMap } from '../lib/fonts';
import { DialogHost, EdgeState, edge, ToastHost, useColors, useScheme, useSheetOptions } from '../ui';

void SplashScreen.preventAutoHideAsync();

// Finished uploads refresh ['roll-photos', id] / ['roll-header', id] through this client.
setUploadQueryClient(queryClient);

const ONBOARDING_PATHS = new Set(['/welcome', '/phone', '/profile']);
const PUBLIC_PREFIXES = ['/invite/', '/auth/', '/dev/'];

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontMap);
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    void configureNotifications();
    startUploadWorker(); // idempotent; resumes the persisted queue
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <Themed>{fontsReady ? <AuthGate /> : null}</Themed>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Themed({ children }: { children: React.ReactNode }) {
  const scheme = useScheme();
  const colors = useColors();
  const theme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.paper,
        card: colors.surface,
        text: colors.ink,
        border: colors.line,
        primary: colors.ink,
        notification: colors.shutter,
      },
    };
  }, [scheme, colors]);
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      {children}
    </ThemeProvider>
  );
}

function AuthGate() {
  const { state, retry } = useAuthGate();

  useEffect(() => {
    if (state !== 'loading') void SplashScreen.hideAsync();
  }, [state]);
  // Never keep the splash forever (slow network on a cold start with a stored session).
  useEffect(() => {
    const t = setTimeout(() => void SplashScreen.hideAsync(), 6000);
    return () => clearTimeout(t);
  }, []);

  if (state === 'loading') return null;
  if (state === 'error') {
    const c = edge.offline();
    return (
      <View className="flex-1 bg-paper dark:bg-paper-dark">
        <EdgeState
          layout="screen"
          icon={c.icon}
          tone={c.tone}
          title={c.title}
          body={c.body}
          primary={{ label: 'Try again', onPress: retry }}
        />
      </View>
    );
  }
  return (
    <>
      <RootStack state={state} />
      <GateRedirects state={state} />
      <ToastHost />
      <DialogHost />
    </>
  );
}

function RootStack({ state }: { state: AuthGateState }) {
  const colors = useColors();
  const sheet = useSheetOptions('halfAndFull');
  const tallSheet = useSheetOptions('tall');
  const fullSheet = useSheetOptions('full');
  const onboarding = state === 'signed-out' || state === 'needs-profile';

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.paper },
        animation: 'default',
      }}
    >
      <Stack.Protected guard={onboarding}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>

      <Stack.Protected guard={state === 'ready'}>
        <Stack.Screen name="(main)" />
        <Stack.Screen name="crew/[id]" />
        <Stack.Screen name="roll/[id]" />
        <Stack.Screen name="photo/[id]" options={{ presentation: 'modal', contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="import" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="uploads" />
        <Stack.Screen name="chat/[thread]" />
        <Stack.Screen name="you/index" />
        <Stack.Screen name="you/privacy" />
        <Stack.Screen name="you/storage" />
        <Stack.Screen name="you/edit" />
        <Stack.Screen name="sheets/create" options={fullSheet} />
        <Stack.Screen name="sheets/invite" options={tallSheet} />
        <Stack.Screen name="sheets/destination" options={sheet} />
        <Stack.Screen name="sheets/download" options={sheet} />
        <Stack.Screen name="sheets/photo-actions" options={sheet} />
        <Stack.Screen name="sheets/roll-settings" options={sheet} />
        <Stack.Screen name="sheets/notifications" options={fullSheet} />
      </Stack.Protected>

      {/* Reachable signed in or out: invite preview (A4), OAuth return, dev catalogue. */}
      <Stack.Screen name="invite/[code]" />
      <Stack.Screen name="auth/callback" options={{ animation: 'none' }} />
      <Stack.Screen name="dev/kit" />
      <Stack.Screen name="dev/edge-states" />
    </Stack>
  );
}

/**
 * Keeps the URL consistent with the gate (protected routes already hide screens; this covers
 * cold starts on a now-hidden path) and resumes a pending invite once sign-up is complete.
 */
function GateRedirects({ state }: { state: AuthGateState }) {
  const pathname = usePathname();
  const navReady = !!useRootNavigationState()?.key;
  const pending = usePendingInvite((s) => s.pending);
  const autoJoin = usePendingInvite((s) => s.autoJoin);
  const resumed = useRef<string | null>(null);

  useEffect(() => {
    if (!navReady) return;
    const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
    if (state === 'signed-out' && !isPublic && !ONBOARDING_PATHS.has(pathname)) {
      router.replace('/welcome');
    } else if (state === 'needs-profile' && pathname !== '/profile' && !isPublic) {
      router.replace('/profile');
    } else if (state === 'ready' && ONBOARDING_PATHS.has(pathname)) {
      router.replace('/');
    }
  }, [state, pathname, navReady]);

  // Sign-up finished with an invite waiting: open A4, which joins and lands in the Roll.
  useEffect(() => {
    if (!navReady || state !== 'ready' || !pending || !autoJoin) return;
    if (resumed.current === pending.code) return;
    resumed.current = pending.code;
    usePendingInvite.getState().setAutoJoin(false);
    router.replace({ pathname: inviteHref(pending.code), params: { autojoin: '1' } });
  }, [state, pending, autoJoin, navReady]);

  return null;
}

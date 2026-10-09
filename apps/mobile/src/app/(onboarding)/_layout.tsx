import { Stack } from 'expo-router';
import { useColors } from '@/ui';

export const unstable_settings = { initialRouteName: 'welcome' };

/** A1 Welcome -> A2 Phone -> A3 Profile. The root gate decides when this group is reachable. */
export default function OnboardingLayout() {
  const colors = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
      <Stack.Screen name="welcome" options={{ contentStyle: { backgroundColor: '#16141B' } }} />
      <Stack.Screen name="phone" />
      <Stack.Screen name="profile" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

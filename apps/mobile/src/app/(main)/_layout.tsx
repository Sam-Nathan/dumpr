import { router, Tabs, usePathname } from 'expo-router';
import { View } from 'react-native';
import { useInboxBadgeSync } from '@/data/useInbox';
import { useNavStore } from '@/state/nav';
import { NavPill } from '@/ui';

/**
 * Home + Inbox behind the floating nav pill (Crews · Shutter · Inbox). The built-in tab bar is
 * hidden; the pill floats above content (lists pad with `useNavClearance()`).
 */
export default function MainLayout() {
  const pathname = usePathname();
  const active = pathname.startsWith('/inbox') ? 'inbox' : 'crews';
  useInboxBadgeSync(); // unread chats + activity -> pill badge, realtime inserts
  const inboxBadge = useNavStore((s) => s.inboxBadge);
  const notifyRetap = useNavStore((s) => s.notifyRetap);

  return (
    <View className="flex-1 bg-paper dark:bg-paper-dark">
      <Tabs tabBar={() => null} screenOptions={{ headerShown: false, lazy: true }}>
        <Tabs.Screen name="index" options={{ title: 'Crews' }} />
        <Tabs.Screen name="inbox" options={{ title: 'Inbox' }} />
      </Tabs>
      <NavPill
        active={active}
        inboxBadge={inboxBadge}
        onCrews={() => (active === 'crews' ? notifyRetap('crews') : router.navigate('/'))}
        onInbox={() => (active === 'inbox' ? notifyRetap('inbox') : router.navigate('/inbox'))}
        onShutter={() => router.push('/camera')}
      />
    </View>
  );
}

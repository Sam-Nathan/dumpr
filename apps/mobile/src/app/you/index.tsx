import { router } from 'expo-router';
import { View } from 'react-native';
import { useProfile } from '@/data/profile';
import { useSession } from '@/data/session';
import { signOut } from '@/features/auth/phone';
import { Avatar, Button, confirmDialog, PressableScale, Screen, Text, useColors, Icon } from '@/ui';

/**
 * F5 You — minimal version from the foundation (profile header, settings rows, sign out).
 * TODO(track C+F): stats strip (my_profile_stats), tiles, Wrapped banner.
 */
export default function You() {
  const profile = useProfile();
  const { isGuest } = useSession();
  const colors = useColors();
  const p = profile.data;

  const rows: { label: string; href: string }[] = [
    { label: 'Edit profile', href: '/you/edit' },
    { label: 'Privacy & safety', href: '/you/privacy' },
    { label: 'Storage', href: '/you/storage' },
    { label: 'Uploads', href: '/uploads' },
  ];
  if (__DEV__) rows.push({ label: 'UI kit (dev)', href: '/dev/kit' }, { label: 'Edge states (dev)', href: '/dev/edge-states' });

  return (
    <Screen scroll header={{ back: true }}>
      <View className="mt-2 flex-row items-center gap-4">
        <Avatar name={p?.display_name ?? ''} avatarKey={p?.avatar_key} ring={p?.ring_color ?? 'lime'} size={72} />
        <View className="flex-1">
          <Text variant="title" heading numberOfLines={2}>
            {p?.display_name ?? ' '}
          </Text>
          {p?.handle ? <Text variant="body">@{p.handle}</Text> : isGuest ? <Text variant="body">Guest</Text> : null}
        </View>
      </View>

      <View className="mt-8 overflow-hidden rounded-card border border-line bg-surface dark:border-line-dark dark:bg-surface-dark">
        {rows.map((r, i) => (
          <PressableScale
            key={r.href}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            onPress={() => router.push(r.href)}
            haptics={false}
            scaleTo={0.99}
            className={`min-h-[56px] flex-row items-center justify-between px-4 ${i > 0 ? 'border-t border-line dark:border-line-dark' : ''}`}
          >
            <Text variant="body" tone="default">
              {r.label}
            </Text>
            <Icon name="chevronRight" size={18} color={colors.ink3} />
          </PressableScale>
        ))}
      </View>

      <View className="mt-8 items-center">
        <Button
          label="Sign out"
          variant="destructive"
          onPress={async () => {
            // Dialogs are for irreversible actions only: a guest cannot sign back in to this account.
            if (isGuest) {
              const ok = await confirmDialog({
                title: 'Sign out of this guest account?',
                body: "Guests can't sign back in, so you'll lose access to this account. Photos you added stay in the Roll.",
                confirmLabel: 'Sign out',
              });
              if (!ok) return;
            }
            await signOut();
          }}
        />
      </View>
    </Screen>
  );
}

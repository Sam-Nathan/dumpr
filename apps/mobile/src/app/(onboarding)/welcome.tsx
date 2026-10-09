import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WEB_URL } from '@/config';
import { InviteLinkSheet } from '@/features/invites/InviteLinkSheet';
import { usePendingInvite } from '@/features/invites/pendingInvite';
import { Button, Chip, DumpStack, INK, LogoMark, Text } from '@/ui';

/**
 * A1 Welcome. Full-bleed ink, dump stack, wordmark, promise, value chips.
 * Primary: Get started · Secondary: I have an invite link (paste/scan) · Log in.
 * No network calls here: offline still lets people start (A2 waits for the network).
 */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const [linkOpen, setLinkOpen] = useState(false);
  const pending = usePendingInvite((s) => s.pending);

  return (
    <View className="flex-1" style={{ backgroundColor: INK }}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom, 16),
          paddingHorizontal: 20,
        }}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1 justify-center">
          <DumpStack
            aspectRatio={1.02}
            cards={[
              { art: 'beach' },
              { art: 'portrait' },
              { art: 'sunset', stamp: "09 10 '26" },
              { art: 'party', stamp: "31 12 '25" },
            ]}
          >
            <View
              className="absolute bottom-[14%] left-0"
              style={{ zIndex: 10, transform: [{ rotate: '-5deg' }] }}
            >
              <View className="rounded-pill bg-flash px-3 py-1.5">
                <Text variant="caption" tone="onFlash" className="font-body-bold">
                  from 9 phones
                </Text>
              </View>
            </View>
          </DumpStack>
        </View>

        <View className="mt-4">
          <View
            className="flex-row items-center gap-3"
            accessible
            accessibilityRole="header"
            accessibilityLabel="dumpr"
          >
            <LogoMark size={52} />
            <Text
              variant="displayXl"
              tone="flash"
              className="text-[64px] leading-[68px] tracking-[-2.6px]"
              accessibilityElementsHidden
            >
              dumpr
            </Text>
          </View>
          <Text variant="title" tone="inverse" className="mt-3 text-[30px] leading-[33px]">
            Everyone&rsquo;s photos.{'\n'}One place. No chasing.
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Chip label="Join from any link" onDark />
            <Chip label="Full-quality downloads" onDark />
            <Chip label="iPhone + Android" onDark />
          </View>
        </View>

        <View className="mt-6 gap-3">
          {pending ? (
            <Text variant="caption" tone="inverse" className="text-center">
              {pending.hostName ? `${pending.hostName} invited you` : 'You have an invite'}
              {pending.title ? ` to ${pending.title}` : ''}. Get started to join.
            </Text>
          ) : null}
          <Button
            label="Get started"
            variant="primary"
            size="lg"
            onPress={() => router.push('/phone')}
          />
          <Button
            label="I have an invite link"
            icon="link"
            variant="secondary"
            size="lg"
            onDark
            onPress={() => setLinkOpen(true)}
          />
          <View className="mt-1 items-center">
            <Text variant="caption" tone="inverse" className="text-center opacity-70">
              Already on Dumpr?{' '}
              <Text
                variant="caption"
                tone="inverse"
                className="font-body-bold"
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/phone', params: { mode: 'login' } })}
                suppressHighlighting
              >
                Log in
              </Text>
              {' · By continuing you agree to the '}
              <Text
                variant="caption"
                tone="inverse"
                className="underline"
                accessibilityRole="link"
                onPress={() => void Linking.openURL(`${WEB_URL}/terms`)}
              >
                Terms
              </Text>
              {' and '}
              <Text
                variant="caption"
                tone="inverse"
                className="underline"
                accessibilityRole="link"
                onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)}
              >
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        </View>
      </ScrollView>
      <InviteLinkSheet visible={linkOpen} onClose={() => setLinkOpen(false)} />
    </View>
  );
}

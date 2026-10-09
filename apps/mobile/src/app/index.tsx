import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Placeholder Welcome screen. TODO: wire "Get started" to phone sign-in / anonymous session.
export default function Welcome() {
  return (
    <SafeAreaView className="flex-1 bg-ink">
      <View className="flex-1 justify-between px-6 pb-8 pt-6">
        <Text className="font-display-extrabold text-[32px] tracking-tight text-flash">dumpr</Text>
        <View>
          <Text className="font-display-extrabold text-[44px] leading-[46px] text-[#F4F3F6]">
            Everyone&rsquo;s photos. One place. No chasing.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get started"
          className="h-14 items-center justify-center rounded-pill bg-flash active:opacity-80"
        >
          <Text className="font-body-bold text-[17px] text-ink">Get started</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

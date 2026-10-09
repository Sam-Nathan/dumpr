import { Image } from 'expo-image';
import { type ReactNode, useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Text } from './Text';
import { SHUTTER } from './theme';

/** Flat illustrations used where no real photo exists yet (Welcome, empty states, sealed covers). */
export type SampleArt = 'beach' | 'sunset' | 'party' | 'portrait';

export interface StackCard {
  /** Real image (signed thumb URL). */
  uri?: string | null;
  cacheKey?: string;
  blurhash?: string | null;
  /** Illustration when there is no image. */
  art?: SampleArt;
  /** Mono date stamp in the corner ("14 03 '26"). */
  stamp?: string;
  /** Blur the image (sealed / reveal pending). */
  blurred?: boolean;
}

export interface DumpStackProps {
  cards: readonly StackCard[];
  /** Width / height of the whole stack area. Default 1. */
  aspectRatio?: number;
  /** Width / height of each card. Default 0.82 (portrait prints). */
  cardAspect?: number;
  /** Gentle idle float after the first frame. Default true (off with Reduce Motion). */
  animated?: boolean;
  /** Overlay (e.g. a "from 9 phones" chip). */
  children?: ReactNode;
}

interface Slot {
  left: DimensionValue;
  top: DimensionValue;
  width: DimensionValue;
  rotate: number;
}

const LAYOUTS: Record<number, Slot[]> = {
  1: [{ left: '22%', top: '6%', width: '56%', rotate: -3 }],
  2: [
    { left: '6%', top: '8%', width: '50%', rotate: -7 },
    { left: '44%', top: '14%', width: '50%', rotate: 5 },
  ],
  3: [
    { left: '4%', top: '6%', width: '44%', rotate: -7 },
    { left: '52%', top: '2%', width: '44%', rotate: 6 },
    { left: '28%', top: '20%', width: '46%', rotate: -1 },
  ],
  4: [
    { left: '2%', top: '8%', width: '46%', rotate: -8 },
    { left: '50%', top: '0%', width: '46%', rotate: 7 },
    { left: '14%', top: '38%', width: '44%', rotate: -3 },
    { left: '44%', top: '42%', width: '46%', rotate: 4 },
  ],
};

function Circle({ size, color, style }: { size: DimensionValue; color: string; style: object }) {
  return (
    <View
      style={[
        {
          position: 'absolute',
          width: size,
          aspectRatio: 1,
          borderRadius: 999,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/** Simple coloured-shape "photos" in the style of the blueprint mockups. */
export function SampleArtwork({ art }: { art: SampleArt }) {
  switch (art) {
    case 'beach':
      return (
        <View style={{ flex: 1, backgroundColor: '#8AD3FF' }}>
          <Circle size="22%" color="#FFFFFF" style={{ left: '18%', top: '22%' }} />
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '62%',
              height: '10%',
              backgroundColor: '#2E8FB8',
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '72%',
              bottom: 0,
              backgroundColor: '#F2D9A0',
            }}
          />
        </View>
      );
    case 'sunset':
      return (
        <View style={{ flex: 1, backgroundColor: '#F4A27C' }}>
          <Circle size="26%" color="#F7C873" style={{ right: '16%', top: '22%' }} />
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              height: '8%',
              backgroundColor: '#E8835A',
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '58%',
              bottom: 0,
              backgroundColor: '#2F4A3A',
            }}
          />
        </View>
      );
    case 'party':
      return (
        <View style={{ flex: 1, backgroundColor: '#2B1B3D' }}>
          <Circle size="13%" color="#FF6FA5" style={{ left: '14%', top: '20%' }} />
          <Circle size="11%" color="#D4FF3F" style={{ left: '46%', top: '12%' }} />
          <Circle size="12%" color="#8AD3FF" style={{ right: '14%', top: '26%' }} />
          <Circle size="70%" color="#F7C531" style={{ left: '15%', top: '72%' }} />
          <Circle size="22%" color="#1A1A1A" style={{ left: '39%', top: '34%' }} />
          <Circle size="20%" color="#B07A55" style={{ left: '40%', top: '40%' }} />
        </View>
      );
    case 'portrait':
      return (
        <View style={{ flex: 1, backgroundColor: '#FFE08A' }}>
          <Circle size="14%" color="#FF7A1A" style={{ left: '12%', top: '10%' }} />
          <Circle size="12%" color="#FF7A1A" style={{ right: '12%', top: '22%' }} />
          <Circle size="76%" color="#F7B500" style={{ left: '12%', top: '70%' }} />
          <Circle size="24%" color="#1A1A1A" style={{ left: '38%', top: '28%' }} />
          <Circle size="22%" color="#C68A62" style={{ left: '39%', top: '35%' }} />
        </View>
      );
  }
}

function FloatingCard({
  card,
  slot,
  index,
  cardAspect,
  animated,
}: {
  card: StackCard;
  slot: Slot;
  index: number;
  cardAspect: number;
  animated: boolean;
}) {
  const t = useSharedValue(0);
  const reduce = useReducedMotion();
  const float = animated && !reduce;

  useEffect(() => {
    if (!float) return undefined;
    // Start after the first frame so the static stack paints immediately (A1 loading rule).
    const raf = requestAnimationFrame(() => {
      const ms = 2600 + index * 450;
      t.value = withDelay(
        index * 220,
        withRepeat(
          withSequence(
            withTiming(1, { duration: ms, easing: Easing.inOut(Easing.sin) }),
            withTiming(-1, { duration: ms, easing: Easing.inOut(Easing.sin) }),
          ),
          -1,
          true,
        ),
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [float, index, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: t.value * (4 + index) },
      { rotate: `${slot.rotate + t.value * 1.2}deg` },
    ],
  }));

  return (
    <Animated.View
      entering={float ? FadeInDown.delay(index * 90).duration(420) : undefined}
      style={[
        {
          position: 'absolute',
          left: slot.left,
          top: slot.top,
          width: slot.width,
          aspectRatio: cardAspect,
          zIndex: index,
        },
        style,
      ]}
    >
      <View
        className="flex-1 overflow-hidden rounded-[18px] bg-white"
        style={{
          padding: 5,
          shadowColor: '#000',
          shadowOpacity: 0.28,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
        }}
      >
        <View className="flex-1 overflow-hidden rounded-[14px]">
          {card.uri ? (
            <Image
              source={{ uri: card.uri, cacheKey: card.cacheKey }}
              placeholder={card.blurhash ? { blurhash: card.blurhash } : undefined}
              blurRadius={card.blurred ? 24 : 0}
              contentFit="cover"
              transition={160}
              style={{ flex: 1 }}
            />
          ) : (
            <SampleArtwork art={card.art ?? 'beach'} />
          )}
          {card.stamp ? (
            <Text
              variant="stamp"
              className="absolute bottom-2 right-2 text-[11px]"
              style={{ color: SHUTTER }}
            >
              {card.stamp}
            </Text>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * The "dump stack": a pile of tilted prints (Welcome, invite cover, Crew cards). Up to 4 cards; the
 * last card is on top. Decorative: hidden from screen readers.
 */
export function DumpStack({
  cards,
  aspectRatio = 1,
  cardAspect = 0.82,
  animated = true,
  children,
}: DumpStackProps) {
  const shown = cards.slice(0, 4);
  const layout = LAYOUTS[shown.length] ?? LAYOUTS[1] ?? [];
  return (
    <View
      style={{ width: '100%', aspectRatio }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shown.map((card, i) => (
        <FloatingCard
          key={i}
          card={card}
          slot={layout[i] as Slot}
          index={i}
          cardAspect={cardAspect}
          animated={animated}
        />
      ))}
      {children}
    </View>
  );
}

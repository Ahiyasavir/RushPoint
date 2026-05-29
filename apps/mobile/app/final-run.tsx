import React, { useEffect } from 'react';
import { View, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { useGameStore } from '../src/store/gameStore';
import { useSlotSound } from '../src/hooks/useSlotSound';
import { useTranslation } from '../src/i18n';

/**
 * Final Run celebration. Shown when all 8 slots are terminal. Plays a synth
 * fanfare, animates the trophy, and reveals the final effective score. The
 * leaderboard reveal itself is staged by the admin (sequential, last→first).
 */
export default function FinalRunScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { playFanfare } = useSlotSound();

  const teamName = useGameStore((s) => s.teamName);
  const live     = useGameStore((s) => s.live);
  const score    = live?.score ?? 0;
  const penalty  = live?.bonusPenalty ?? 0;
  const finalScore = Math.max(0, score - penalty);

  const trophyScale = useSharedValue(0.2);
  const trophyFloat = useSharedValue(0);
  const glow        = useSharedValue(0.3);

  useEffect(() => {
    playFanfare();
    trophyScale.value = withSpring(1, { damping: 8, stiffness: 90 });
    trophyFloat.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(0,   { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 1200 }),
        withTiming(0.3, { duration: 1200 }),
      ),
      -1,
      true,
    );
  }, [playFanfare, trophyScale, trophyFloat, glow]);

  const trophyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: trophyScale.value }, { translateY: trophyFloat.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    shadowColor: '#ffd700',
    shadowOpacity: glow.value,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  }));

  return (
    <View className="flex-1 bg-app-bg items-center justify-center px-6" style={{ paddingTop: insets.top }}>
      <Animated.View style={[trophyStyle, glowStyle]} className="mb-6">
        <Text className="text-8xl">🏆</Text>
      </Animated.View>

      <Text variant="label" className="text-neon-gold tracking-[0.3em] mb-2">{t('final.label')}</Text>
      <Text variant="display" className="font-brand text-white text-center mb-1">{t('final.title')}</Text>
      <Text variant="subheading" className="text-zinc-400 text-center mb-8">
        {teamName || '—'}
      </Text>

      <Card glowColor="gold" className="p-6 w-full items-center mb-8">
        <Text variant="label" className="text-zinc-500 mb-1">{t('final.finalScore')}</Text>
        <Text variant="display" className="font-brand text-neon-gold text-5xl">{finalScore}</Text>
        {penalty > 0 && (
          <Text variant="caption" className="text-neon-red font-mono mt-1">
            −{penalty} {t('dash.penalty')}
          </Text>
        )}
      </Card>

      <Text variant="bodySmall" className="text-zinc-500 text-center mb-8 leading-relaxed">
        {t('final.awaitReveal')}
      </Text>

      <Pressable
        onPress={() => router.replace('/dashboard')}
        hitSlop={8}
        className="px-5 py-2.5 rounded-xl border border-glass-border active:bg-white/5"
      >
        <Text variant="bodySmall" className="text-zinc-400">{t('final.backToDash')}</Text>
      </Pressable>
    </View>
  );
}

import React, { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { Text } from './Text';
import { GLOW } from './tokens';
import { useTranslation } from '../i18n';
import type { FlashMission } from '@rushpoint/shared';

/**
 * Overlay banner for an admin-broadcast flash mission. Slides in from the top,
 * pulses its purple glow, and shows a live countdown to expiry. Dismissible.
 * Re-appears if a newer mission arrives (keyed by mission id in the parent).
 */
export function FlashMissionBanner({
  mission,
  onDismiss,
}: {
  mission: FlashMission;
  onDismiss: () => void;
}) {
  const { t, isRtl } = useTranslation();
  const translateY = useSharedValue(-160);
  const glow = useSharedValue(0.3);
  const [secsLeft, setSecsLeft] = useState(() =>
    Math.max(0, Math.round((new Date(mission.expiresAt).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    translateY.value = withSpring(0, { damping: 16, stiffness: 130 });
    glow.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [glow, translateY]);

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((new Date(mission.expiresAt).getTime() - Date.now()) / 1000));
      setSecsLeft(left);
      if (left <= 0) onDismiss();
    }, 1000);
    return () => clearInterval(id);
  }, [mission.expiresAt, onDismiss]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    shadowColor: '#a855f7',
    shadowOpacity: glow.value,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 16,
  }));

  const title = isRtl ? (mission.titleHe ?? mission.title) : mission.title;
  const description = isRtl ? (mission.descriptionHe ?? mission.description) : mission.description;

  return (
    <Animated.View
      style={[
        animStyle,
        { backgroundColor: 'rgba(20,12,30,0.96)', borderColor: 'rgba(168,85,247,0.4)', borderWidth: 1 },
      ]}
      className="absolute left-4 right-4 top-2 z-50 rounded-2xl p-4"
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center gap-2">
          <Text className="text-base">⚡</Text>
          <Text className="text-neon-purple text-[10px] font-bold uppercase tracking-[0.2em]">
            {t('flash.label')}
          </Text>
        </View>
        <View className="px-2.5 py-0.5 rounded-full bg-neon-purple/15 border border-neon-purple/30">
          <Text className="text-neon-purple text-xs font-bold font-mono">
            {t('flash.bonus', { bonus: mission.bonusPoints })}
          </Text>
        </View>
      </View>

      <Text variant="subheading" className="text-white mb-1">{title}</Text>
      {description ? (
        <Text variant="bodySmall" className="text-zinc-400 mb-3">{description}</Text>
      ) : <View className="mb-3" />}

      <View className="flex-row items-center justify-between">
        <Text variant="caption" className="text-neon-purple/70 font-mono">
          {t('flash.expiresIn', { sec: secsLeft })}
        </Text>
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          className="px-3 py-1.5 rounded-lg bg-neon-purple/10 border border-neon-purple/30 active:bg-neon-purple/20"
        >
          <Text variant="caption" className="text-neon-purple font-semibold">{t('flash.dismiss')}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

/** Holds the dismissed-mission id so a dismissal sticks until a newer one arrives. */
export function useDismissableFlash(mission: FlashMission | null): {
  visible: FlashMission | null;
  dismiss: () => void;
} {
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const visible = mission && mission.id !== dismissedId ? mission : null;
  return {
    visible,
    dismiss: () => mission && setDismissedId(mission.id),
  };
}

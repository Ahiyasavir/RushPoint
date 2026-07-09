import React, { useState, useCallback } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../src/services/firebase.config';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { useToast } from '../src/components/Toast';
import { useTranslation } from '../src/i18n';

type StaffKind = 'emergency' | 'technical';

const HOLD_MS = 1800;     // hold duration to confirm an emergency
const RING = 220;         // panic-button diameter

/**
 * Hold-to-fire panic button. A real emergency must not be a single accidental
 * tap while running — the runner presses and HOLDS; a glowing fill rises over
 * ~1.8s and only then fires. Releasing early cancels. Built on Reanimated (no
 * react-native-svg), with a haptic pulse on commit.
 */
function HoldEmergencyButton({ onConfirm, label, hint }: { onConfirm: () => void; label: string; hint: string }) {
  const progress = useSharedValue(0);
  const [holding, setHolding] = useState(false);

  const fire = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    onConfirm();
  }, [onConfirm]);

  const start = () => {
    setHolding(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    progress.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(fire)();
    });
  };
  const cancel = () => {
    setHolding(false);
    cancelAnimation(progress);
    progress.value = withTiming(0, { duration: 200 });
  };

  // Rising fill clipped inside the circular button (the only motion — no aura).
  const fillStyle = useAnimatedStyle(() => ({ height: progress.value * RING }));

  return (
    <View className="items-center">
      <Pressable onPressIn={start} onPressOut={cancel} delayLongPress={HOLD_MS}>
        <View
          style={{
            width: RING,
            height: RING,
            borderRadius: RING / 2,
            borderWidth: holding ? 2 : 1.5,
            borderColor: '#EF4444',
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'transparent',
          }}
        >
          {/* Smooth rising fill — the progress indicator */}
          <Animated.View
            pointerEvents="none"
            style={[fillStyle, { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(239,68,68,0.22)' }]}
          />
          <Text className="text-6xl mb-1">🆘</Text>
          <Text variant="subheading" className="text-neon-red text-center">{label}</Text>
        </View>
      </Pressable>
      <Text variant="caption" className={`mt-4 text-center ${holding ? 'text-neon-red animate-pulse-neon' : 'text-zinc-500'}`}>
        {hint}
      </Text>
    </View>
  );
}

/**
 * "Call staff" screen. A real Emergency (loud alarm on the staff dashboards)
 * requires a HOLD to avoid accidental triggers while running; a Technical /
 * planned issue (soft chime) is a single tap. Either way the alert carries the
 * team roster, captain phone and GPS so staff can respond.
 */
export default function CallStaffScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { show } = useToast();
  const [sending, setSending] = useState<StaffKind | null>(null);
  const [sent, setSent]       = useState<StaffKind | null>(null);

  async function getCoords(): Promise<{ lat?: number; lng?: number }> {
    const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
    if (!geo) return {};
    return new Promise((resolve) => {
      const done = (c: { lat?: number; lng?: number }) => resolve(c);
      const timer = setTimeout(() => done({}), 4000);
      geo.getCurrentPosition(
        (pos) => { clearTimeout(timer); done({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        () => { clearTimeout(timer); done({}); },
        { timeout: 4000 },
      );
    });
  }

  async function call(kind: StaffKind) {
    setSending(kind);
    try {
      const coords = await getCoords();
      await httpsCallable(functions, 'triggerSOS')({ ...coords, kind });
      setSent(kind);
      show(t('staff.sent'), 'success');
    } catch {
      show(t('staff.error'), 'error');
    } finally {
      setSending(null);
    }
  }

  return (
    <View className="flex-1 bg-app-bg" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-4">
        <Pressable onPress={() => router.back()} hitSlop={16} className="py-2 self-start">
          <Text variant="bodySmall" className="text-neon-green">{t('map.back')}</Text>
        </Pressable>
      </View>

      <View className="flex-1 px-5 items-center justify-center">
        <Text variant="heading" className="mb-2 text-center">{t('staff.title')}</Text>
        <Text variant="bodySmall" className="text-zinc-400 mb-10 text-center leading-relaxed">
          {t('staff.subtitle')}
        </Text>

        {sent ? (
          <Card className="p-6 w-full items-center" style={{ borderColor: 'rgba(245,158,11,0.3)', borderWidth: 1 }}>
            <Text variant="subheading" className="text-neon-green mb-1 text-center">
              ✓ {sent === 'emergency' ? t('staff.sentEmergency') : t('staff.sentTechnical')}
            </Text>
            <Text variant="bodySmall" className="text-zinc-400 text-center">{t('staff.staySafe')}</Text>
          </Card>
        ) : sending ? (
          <View className="items-center py-6">
            <ActivityIndicator size="large" color={sending === 'emergency' ? '#EF4444' : '#ffb020'} />
            <Text variant="bodySmall" className="text-zinc-500 mt-3">{t('staff.sending')}</Text>
          </View>
        ) : (
          <View className="w-full items-center gap-8">
            {/* Emergency — hold to confirm (loud alarm on the staff side) */}
            <HoldEmergencyButton
              onConfirm={() => void call('emergency')}
              label={t('staff.emergency')}
              hint={t('staff.holdHint')}
            />

            {/* Technical / planned — soft chime on the staff side, single tap */}
            <Pressable
              onPress={() => void call('technical')}
              className="w-full rounded-2xl bg-neon-orange/10 border border-neon-orange/40 p-4 items-center active:bg-neon-orange/20 active:scale-95 transition-all duration-200"
            >
              <Text className="text-3xl mb-1">🛠️</Text>
              <Text variant="bodySmall" className="text-neon-orange text-center">{t('staff.technical')}</Text>
              <Text variant="caption" className="text-zinc-500 text-center mt-0.5">{t('staff.technicalDesc')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

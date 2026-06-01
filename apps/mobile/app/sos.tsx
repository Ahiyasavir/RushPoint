import React, { useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../src/services/firebase.config';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { useToast } from '../src/components/Toast';
import { useTranslation } from '../src/i18n';

type StaffKind = 'emergency' | 'technical';

/**
 * "Call staff" screen. Two one-tap actions — a real Emergency (raises a loud
 * alarm on the staff dashboards) and a Technical/planned issue (soft chime).
 * Either way the alert carries the team's roster, captain phone and GPS so staff
 * can respond. Single tap (no multi-step arming) by design.
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
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodySmall" className="text-neon-green">{t('map.back')}</Text>
        </Pressable>
      </View>

      <View className="flex-1 px-5 items-center justify-center">
        <Text className="text-5xl mb-3">📣</Text>
        <Text variant="heading" className="mb-2 text-center">{t('staff.title')}</Text>
        <Text variant="bodySmall" className="text-zinc-400 mb-10 text-center leading-relaxed">
          {t('staff.subtitle')}
        </Text>

        {sent ? (
          <Card className="p-6 w-full items-center" style={{ borderColor: 'rgba(0,255,170,0.3)', borderWidth: 1 }}>
            <Text variant="subheading" className="text-neon-green mb-1 text-center">
              ✓ {sent === 'emergency' ? t('staff.sentEmergency') : t('staff.sentTechnical')}
            </Text>
            <Text variant="bodySmall" className="text-zinc-400 text-center">{t('staff.staySafe')}</Text>
          </Card>
        ) : sending ? (
          <View className="items-center py-6">
            <ActivityIndicator size="large" color={sending === 'emergency' ? '#FF0055' : '#ffb020'} />
            <Text variant="bodySmall" className="text-zinc-500 mt-3">{t('staff.sending')}</Text>
          </View>
        ) : (
          <View className="w-full gap-4">
            {/* Emergency — loud alarm on the staff side */}
            <Pressable
              onPress={() => void call('emergency')}
              className="w-full rounded-2xl bg-neon-red/15 border-2 border-neon-red/50 p-5 items-center active:bg-neon-red/25"
              style={{ shadowColor: '#FF0055', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 }}
            >
              <Text className="text-4xl mb-1">🆘</Text>
              <Text variant="subheading" className="text-neon-red text-center">{t('staff.emergency')}</Text>
              <Text variant="caption" className="text-zinc-400 text-center mt-1">{t('staff.emergencyDesc')}</Text>
            </Pressable>

            {/* Technical / planned — soft chime on the staff side */}
            <Pressable
              onPress={() => void call('technical')}
              className="w-full rounded-2xl bg-neon-orange/10 border border-neon-orange/40 p-5 items-center active:bg-neon-orange/20"
            >
              <Text className="text-4xl mb-1">🛠️</Text>
              <Text variant="subheading" className="text-neon-orange text-center">{t('staff.technical')}</Text>
              <Text variant="caption" className="text-zinc-400 text-center mt-1">{t('staff.technicalDesc')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

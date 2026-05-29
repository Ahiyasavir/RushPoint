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

/**
 * Emergency SOS screen. A two-step confirm (arm → send) prevents accidental
 * alerts. On send, calls the triggerSOS callable which writes an AdminAlert the
 * dashboard surfaces live. Best-effort geolocation is attached when available.
 */
export default function SosScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { show } = useToast();
  const [armed, setArmed]     = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);

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

  async function handleSend() {
    setSending(true);
    try {
      const coords = await getCoords();
      const fn = httpsCallable(functions, 'triggerSOS');
      await fn(coords);
      setSent(true);
      show(t('sos.sent'), 'success');
    } catch {
      show(t('sos.error'), 'error');
      setArmed(false);
    } finally {
      setSending(false);
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
        <Text className="text-6xl mb-4">🆘</Text>
        <Text variant="heading" className="text-neon-red mb-2 text-center">{t('sos.title')}</Text>
        <Text variant="bodySmall" className="text-zinc-400 mb-10 text-center leading-relaxed">
          {t('sos.subtitle')}
        </Text>

        {sent ? (
          <Card className="p-6 w-full items-center" style={{ borderColor: 'rgba(0,255,170,0.3)', borderWidth: 1 }}>
            <Text variant="subheading" className="text-neon-green mb-1 text-center">✓ {t('sos.confirmed')}</Text>
            <Text variant="bodySmall" className="text-zinc-400 text-center">{t('sos.staySafe')}</Text>
          </Card>
        ) : sending ? (
          <View className="items-center py-6">
            <ActivityIndicator size="large" color="#ff3d00" />
            <Text variant="bodySmall" className="text-zinc-500 mt-3">{t('sos.sending')}</Text>
          </View>
        ) : !armed ? (
          <Pressable
            onPress={() => setArmed(true)}
            className="w-48 h-48 rounded-full bg-neon-red/15 border-2 border-neon-red/50 items-center justify-center active:bg-neon-red/25"
            style={{ shadowColor: '#ff3d00', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 0 }, elevation: 16 }}
          >
            <Text variant="subheading" className="text-neon-red text-center">{t('sos.tapToArm')}</Text>
          </Pressable>
        ) : (
          <View className="w-full items-center gap-4">
            <Text variant="bodySmall" className="text-neon-red text-center animate-pulse-neon">
              {t('sos.confirmPrompt')}
            </Text>
            <Pressable
              onPress={() => void handleSend()}
              className="w-full py-4 rounded-2xl bg-neon-red items-center active:opacity-90"
              style={{ shadowColor: '#ff3d00', shadowOpacity: 0.5, shadowRadius: 22, shadowOffset: { width: 0, height: 4 }, elevation: 14 }}
            >
              <Text className="text-white font-bold text-lg tracking-wide">{t('sos.sendNow')}</Text>
            </Pressable>
            <Pressable onPress={() => setArmed(false)} hitSlop={8} className="py-2">
              <Text variant="bodySmall" className="text-zinc-500">{t('sos.cancel')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

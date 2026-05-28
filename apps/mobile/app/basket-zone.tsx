import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Pressable, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../src/services/firebase.config';
import { useGameStore } from '../src/store/gameStore';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { useTranslation } from '../src/i18n';

interface ZoneInfo {
  zoneId: string;
  zoneName: string;
  zoneNameHe?: string;
  riddle: string;
  riddleHe?: string;
  currentLoad: number;
  maxTeams: number;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function BasketZoneScreen() {
  const insets  = useSafeAreaInsets();
  const { t, isRtl } = useTranslation();
  const live    = useGameStore((s) => s.live);

  const [zone, setZone]         = useState<ZoneInfo | null>(null);
  const [loading, setLoading]   = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError]       = useState('');

  // Crafting timer state (derived from live.craftingStartedAt).
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const CRAFTING_SECS = 20 * 60;
  const SPRINT_SECS   = 90;

  function toMs(v: unknown): number | null {
    if (!v) return null;
    if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
    if (typeof v === 'object') {
      const o = v as { toMillis?: () => number; seconds?: number };
      if (typeof o.toMillis === 'function') return o.toMillis();
      if (typeof o.seconds === 'number') return o.seconds * 1000;
    }
    return null;
  }

  const craftingStartMs  = toMs(live?.craftingStartedAt);
  const craftingActive   = craftingStartMs != null;
  const craftingElapsed  = craftingActive ? Math.floor((nowMs - craftingStartMs!) / 1000) : 0;
  const craftingLeft     = Math.max(0, CRAFTING_SECS - craftingElapsed);
  const craftingDone     = craftingElapsed >= CRAFTING_SECS;
  const sprintElapsed    = craftingDone ? Math.max(0, craftingElapsed - CRAFTING_SECS) : 0;
  const sprintLeft       = Math.max(0, SPRINT_SECS - sprintElapsed);
  const sprintExpired    = craftingDone && sprintElapsed > SPRINT_SECS;

  // Match delay: if team lost a match, show 90s delay before basket access.
  const matchStatus    = live?.matchStatus;
  const gateArrivedMs  = toMs(live?.gateArrivedAt);
  const matchDelaySecs = matchStatus === 'lost' && gateArrivedMs
    ? Math.max(0, SPRINT_SECS - Math.floor((nowMs - gateArrivedMs) / 1000))
    : 0;
  const underMatchDelay = matchDelaySecs > 0;

  useEffect(() => {
    if (craftingActive) return; // Already started — no need to fetch zone.
    const fn = httpsCallable<object, ZoneInfo>(functions, 'getBasketZone');
    fn({})
      .then((res) => { setZone(res.data); setLoading(false); })
      .catch(() => { setError('Could not load basket zone. Check connection.'); setLoading(false); });
  }, [craftingActive]);

  async function handleStartTimer() {
    if (!zone) return;
    setStarting(true);
    try {
      const fn = httpsCallable(functions, 'startCraftingTimer');
      await fn({ zoneId: zone.zoneId });
      // gameStore will mirror the update via useGameSync
    } catch {
      Alert.alert('Error', 'Could not start the timer. Try again.');
    } finally {
      setStarting(false);
    }
  }

  // ── Crafting countdown screen ──────────────────────────────────────────────
  if (craftingActive) {
    return (
      <View className="flex-1 bg-app-bg" style={{ paddingTop: insets.top + 8 }}>
        <View className="px-5 pb-4 border-b border-zinc-800">
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text variant="caption" className="text-neon-green">{t('map.back')}</Text>
          </Pressable>
        </View>
        <View className="flex-1 px-5 pt-8 items-center">
          <Text variant="heading" className="text-neon-gold mb-2 text-center">{t('craft.title')}</Text>

          {!craftingDone ? (
            <>
              <Text variant="label" className="text-zinc-500 mb-1">{t('craft.timeLeft')}</Text>
              <Text variant="display" className={`text-5xl font-mono mb-6 ${craftingLeft < 120 ? 'text-neon-orange animate-pulse-neon' : 'text-neon-gold'}`}>
                {formatCountdown(craftingLeft)}
              </Text>
            </>
          ) : (
            <>
              <Text variant="subheading" className="text-neon-red mb-4 text-center animate-pulse-neon">
                {t('craft.expired')}
              </Text>
              <Card className="p-5 w-full items-center">
                <Text variant="label" className="mb-1 text-zinc-400">
                  {sprintExpired ? t('craft.sprintExpired') : t('craft.sprintWindow')}
                </Text>
                <Text variant="display" className={`text-4xl font-mono ${sprintExpired ? 'text-neon-red animate-pulse-neon' : 'text-neon-orange'}`}>
                  {sprintExpired ? `+${formatCountdown(sprintElapsed - SPRINT_SECS)}` : formatCountdown(sprintLeft)}
                </Text>
                {!sprintExpired && (
                  <Text variant="bodySmall" className="text-zinc-500 mt-2 text-center">
                    {t('craft.sprintLeft', { sec: sprintLeft })}
                  </Text>
                )}
              </Card>
            </>
          )}
        </View>
      </View>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View className="flex-1 bg-app-bg items-center justify-center">
        <ActivityIndicator color="#00ffaa" />
      </View>
    );
  }

  // ── Zone riddle screen ─────────────────────────────────────────────────────
  const displayName   = isRtl ? (zone?.zoneNameHe ?? zone?.zoneName) : zone?.zoneName;
  const displayRiddle = isRtl ? (zone?.riddleHe ?? zone?.riddle) : zone?.riddle;

  return (
    <View className="flex-1 bg-app-bg" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-4 border-b border-zinc-800 flex-row items-center justify-between">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="caption" className="text-neon-green">{t('map.back')}</Text>
        </Pressable>
      </View>

      <View className="flex-1 px-5 pt-6">
        <Text variant="heading" className="text-neon-gold mb-1">{t('basket.title')}</Text>
        {displayName && (
          <Text variant="caption" className="text-zinc-500 mb-6">
            {t('basket.zone', { name: displayName })}
          </Text>
        )}

        {error ? (
          <Card className="p-5">
            <Text variant="bodySmall" className="text-red-400 text-center">{error}</Text>
          </Card>
        ) : (
          <>
            {/* Match delay banner */}
            {underMatchDelay && (
              <Card className="p-4 mb-4" style={{ borderColor: 'rgba(255,61,0,0.3)', borderWidth: 1, backgroundColor: 'rgba(255,61,0,0.05)' }}>
                <Text variant="bodySmall" className="text-neon-red text-center animate-pulse-neon">
                  {t('basket.delay', { sec: matchDelaySecs })}
                </Text>
              </Card>
            )}

            <Card glowColor="gold" className="p-5 mb-6">
              <Text variant="label" className="text-neon-gold mb-3">{t('basket.riddleLabel')}</Text>
              <Text variant="body" className="text-white leading-relaxed">
                {displayRiddle}
              </Text>
            </Card>

            <Text variant="bodySmall" className="text-zinc-500 text-center mb-6">
              {t('basket.scanPrompt')}
            </Text>

            <Button
              onPress={handleStartTimer}
              disabled={starting || underMatchDelay}
              fullWidth
            >
              {starting ? '…' : t('basket.startTimer')}
            </Button>
          </>
        )}
      </View>
    </View>
  );
}

import React, { useEffect, useState } from 'react';
import { View, ScrollView, ActivityIndicator, Pressable, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../src/services/firebase.config';
import { useGameStore, type LiveSlot, type LiveJudging, type MatchStatus } from '../src/store/gameStore';
import { useGameSync } from '../src/hooks/useGameSync';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import type { BadgeProps } from '../src/components/Badge';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { useOfflineToast } from '../src/hooks/useOfflineToast';
import { useTranslation } from '../src/i18n';

// Slot shape is mirrored from the store (LiveSlot / LiveJudging).
type SlotType   = 'green' | 'gate' | 'orange' | 'gold';
type SlotStatus = 'locked' | 'active' | 'completed' | 'skipped';
type FirestoreSlot = LiveSlot;
type JudgingState  = LiveJudging;

const CRAFTING_DURATION_SECS = 20 * 60;
const SPRINT_BUDGET_SECS     = 90;

// ─── Time helpers ─────────────────────────────────────────────────────────────

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === 'object') {
    const o = value as { toMillis?: () => number; seconds?: number };
    if (typeof o.toMillis === 'function') return o.toMillis();
    if (typeof o.seconds === 'number') return o.seconds * 1000;
  }
  return null;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Static maps (NativeWind requires fully-spelled-out strings) ──────────────

const SLOT_BADGE_VARIANT: Record<SlotType, BadgeProps['variant']> = {
  green:  'green',
  gate:   'info',
  orange: 'orange',
  gold:   'gold',
};

const SLOT_GLOW_COLOR: Record<SlotType, 'green' | 'orange' | 'gold'> = {
  green:  'green',
  gate:   'orange',
  orange: 'orange',
  gold:   'gold',
};

const DOT_COLOR: Record<SlotType, Record<SlotStatus, string>> = {
  green:  { completed: 'bg-emerald-500', active: 'bg-emerald-400', locked: 'bg-zinc-800', skipped: 'bg-zinc-600' },
  gate:   { completed: 'bg-sky-500',     active: 'bg-sky-400',     locked: 'bg-zinc-800', skipped: 'bg-zinc-600' },
  orange: { completed: 'bg-orange-500',  active: 'bg-orange-400',  locked: 'bg-zinc-800', skipped: 'bg-zinc-600' },
  gold:   { completed: 'bg-amber-400',   active: 'bg-amber-300',   locked: 'bg-zinc-800', skipped: 'bg-zinc-600' },
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const insets   = useSafeAreaInsets();
  const { t }    = useTranslation();
  const teamId   = useGameStore((s) => s.teamId);
  const teamName = useGameStore((s) => s.teamName);
  const gameState = useGameStore((s) => s.live);
  const syncState = useGameStore((s) => s.syncState);

  const [nowMs, setNowMs] = useState(Date.now());

  // Live Firestore mirror (drives score/slots) + offline notifications.
  useGameSync(teamId);
  useOfflineToast();

  // Tick once per second to drive the live elapsed-time clock.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loading         = syncState === 'loading' && !gameState;
  const snapError       = syncState === 'error' && !gameState;
  const activeSlot      = gameState?.slots.find((s) => s.status === 'active') ?? null;
  const completedCount  = gameState?.slots.filter((s) => s.status === 'completed').length ?? 0;
  const score           = gameState?.score ?? 0;

  // Phase 3 derived state
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

  const craftingStartMs = toMs(gameState?.craftingStartedAt);
  const craftingActive  = craftingStartMs != null;
  const craftingElapsed = craftingActive ? Math.max(0, Math.floor((nowMs - craftingStartMs!) / 1000)) : 0;
  const craftingLeft    = Math.max(0, CRAFTING_DURATION_SECS - craftingElapsed);
  const craftingDone    = craftingElapsed >= CRAFTING_DURATION_SECS;
  const sprintElapsed   = craftingDone ? Math.max(0, craftingElapsed - CRAFTING_DURATION_SECS) : 0;
  const sprintLeft      = Math.max(0, SPRINT_BUDGET_SECS - sprintElapsed);

  const isOrangeActive  = activeSlot?.type === 'orange';
  const gateArrivedMs   = toMs(gameState?.gateArrivedAt);
  const gateCheckedIn   = gateArrivedMs != null;

  return (
    <View className="flex-1 bg-zinc-950">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <View
        className="border-b border-zinc-800/60 px-5 pb-4"
        style={{ paddingTop: insets.top + 8 }}
      >
        <View className="flex-row justify-between items-center mb-3">
          <Pressable
            onPress={() => router.push('/map')}
            hitSlop={8}
            className="px-3 py-1.5 rounded-full border border-zinc-700 bg-zinc-900 active:bg-zinc-800"
          >
            <Text variant="caption" className="text-emerald-400">🗺  {t('map.open')}</Text>
          </Pressable>
          <LanguageToggle />
        </View>

        <View className="flex-row items-start justify-between">
          <View className="flex-1 me-4">
            <Text variant="label">{t('dash.team')}</Text>
            <Text variant="heading" numberOfLines={1}>{teamName || '—'}</Text>
          </View>

          <View className="items-end">
            <Text variant="label">{t('dash.score')}</Text>
            <Text variant="display" className="text-emerald-400 leading-tight">
              {score}
            </Text>
            <Text variant="label" className="text-zinc-600">{t('dash.pts')}</Text>
          </View>
        </View>

        <Text variant="caption" className="text-zinc-600 mt-2">
          {t('dash.slotsCompleted', { n: completedCount })}
        </Text>
      </View>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="label" className="mb-4">{t('dash.currentMission')}</Text>

        {loading ? (
          <View className="py-10 items-center">
            <ActivityIndicator color="#10b981" />
          </View>
        ) : snapError ? (
          <Card className="p-6 items-center">
            <Text variant="bodySmall" className="text-red-400 text-center">
              {t('dash.loadError')}
            </Text>
          </Card>
        ) : activeSlot?.type === 'gate' ? (
          <GateCard matchStatus={gameState?.matchStatus} teamId={teamId} />
        ) : activeSlot ? (
          <ActiveTaskCard slot={activeSlot} judging={gameState?.judging ?? null} nowMs={nowMs} />
        ) : (
          <Card className="p-6 items-center">
            <Text variant="bodySmall" className="text-zinc-500 text-center">
              {t('dash.noMission')}
            </Text>
          </Card>
        )}

        {/* ── Phase 3: Crafting countdown ───────────────────────────── */}
        {craftingActive && (
          <View className="mt-6">
            <CraftingCountdownCard
              craftingLeft={craftingLeft}
              craftingDone={craftingDone}
              sprintLeft={sprintLeft}
              sprintExpired={sprintElapsed > SPRINT_BUDGET_SECS}
            />
          </View>
        )}

        {/* ── Phase 3: Basket zone link ─────────────────────────────── */}
        {activeSlot?.type === 'orange' && !craftingActive && (
          <Pressable
            onPress={() => router.push('/basket-zone')}
            className="mt-4 rounded-xl border border-amber-700 bg-amber-950/30 p-4 active:opacity-70"
          >
            <Text variant="label" className="text-amber-400">🧺 {t('basket.title')}</Text>
            <Text variant="bodySmall" className="text-zinc-400 mt-1">{t('basket.scanPrompt')}</Text>
          </Pressable>
        )}

        {/* ── Slot progress dots ────────────────────────────────────── */}
        {gameState && (
          <View className="mt-10">
            <Text variant="label" className="mb-3">{t('dash.raceProgress')}</Text>
            <View className="flex-row gap-2 flex-wrap">
              {gameState.slots.map((s) => (
                <SlotDot key={s.index} slot={s} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Active task card ─────────────────────────────────────────────────────────

function ActiveTaskCard({
  slot, judging, nowMs,
}: {
  slot: FirestoreSlot;
  judging: JudgingState | null;
  nowMs: number;
}) {
  const { t } = useTranslation();
  const frozen  = !!judging && judging.slotIndex === slot.index;
  const startMs = toMillis(slot.startedAt);
  const endMs   = frozen ? (toMillis(judging?.arrivedAt) ?? nowMs) : nowMs;
  const elapsedSec = startMs != null ? Math.max(0, Math.floor((endMs - startMs) / 1000)) : null;

  return (
    <Card glowColor={SLOT_GLOW_COLOR[slot.type]} className="p-5">
      <View className="flex-row items-center justify-between mb-4">
        <Badge label={t(`slot.${slot.type}`)} variant={SLOT_BADGE_VARIANT[slot.type]} />
        <Text variant="mono" className="text-zinc-600">
          {String(slot.index + 1).padStart(2, '0')}
        </Text>
      </View>

      <Text variant="subheading" className="mb-2">
        {slot.taskTitle ?? t('dash.activeMission')}
      </Text>

      <Text variant="bodySmall" className="text-zinc-400 mb-4">
        {slot.taskId
          ? t('dash.taskLabel', { id: slot.taskId })
          : t('dash.assigning')}
      </Text>

      {/* Elapsed-time clock — freezes while a judge is evaluating */}
      {elapsedSec != null && (
        <View className="flex-row items-center justify-between border-t border-zinc-800 pt-4">
          <View>
            <Text variant="label" className={frozen ? 'text-sky-400' : 'text-zinc-600'}>
              {frozen ? t('dash.timeFrozen') : t('dash.elapsed')}
            </Text>
            <Text variant="mono" className={`text-2xl ${frozen ? 'text-sky-300' : 'text-white'}`}>
              {formatElapsed(elapsedSec)}
            </Text>
          </View>
          {frozen && <Badge label={t('dash.beingJudged')} variant="info" />}
        </View>
      )}
    </Card>
  );
}

// ─── Slot progress dot ────────────────────────────────────────────────────────

function SlotDot({ slot }: { slot: FirestoreSlot }) {
  const dotColor = DOT_COLOR[slot.type][slot.status];
  const sizeClass = slot.status === 'active' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5';

  return <View className={`${sizeClass} rounded-full ${dotColor}`} />;
}

// ─── Crafting countdown card ──────────────────────────────────────────────────

function CraftingCountdownCard({
  craftingLeft, craftingDone, sprintLeft, sprintExpired,
}: {
  craftingLeft: number;
  craftingDone: boolean;
  sprintLeft: number;
  sprintExpired: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card glowColor="gold" className="p-5">
      <View className="flex-row items-center justify-between mb-3">
        <Badge label={t('craft.title')} variant="gold" />
        <Text variant="mono" className="text-zinc-600">🧺</Text>
      </View>
      {!craftingDone ? (
        <View className="items-center">
          <Text variant="label" className="text-zinc-500 mb-1">{t('craft.timeLeft')}</Text>
          <Text
            variant="mono"
            className={`text-4xl font-bold ${craftingLeft < 120 ? 'text-red-400' : 'text-amber-300'}`}
          >
            {formatElapsed(craftingLeft)}
          </Text>
        </View>
      ) : (
        <View className="items-center">
          <Text variant="bodySmall" className="text-red-400 mb-2 text-center animate-pulse">
            {t('craft.expired')}
          </Text>
          <Text variant="label" className="text-zinc-500 mb-1">{t('craft.sprintWindow')}</Text>
          <Text
            variant="mono"
            className={`text-3xl font-bold ${sprintExpired ? 'text-red-500' : 'text-orange-300'}`}
          >
            {sprintExpired ? '⚠️ LATE' : formatElapsed(sprintLeft)}
          </Text>
          {!sprintExpired && (
            <Text variant="caption" className="text-zinc-500 mt-1 text-center">
              {t('craft.sprintLeft', { sec: sprintLeft })}
            </Text>
          )}
        </View>
      )}
    </Card>
  );
}

// ─── Gate card (matchmaking filter) ──────────────────────────────────────────

function GateCard({ matchStatus, teamId }: { matchStatus?: MatchStatus; teamId: string | null }) {
  const { t } = useTranslation();
  const [joining, setJoining]     = useState(false);
  const [bypassing, setBypassing] = useState(false);

  async function handleJoin() {
    setJoining(true);
    try {
      const fn = httpsCallable(functions, 'joinMatchQueue');
      const res = await fn({});
      const data = res.data as { matched: boolean; opponentName?: string };
      if (data.matched) {
        Alert.alert(t('match.title'), t('match.matched', { opponent: data.opponentName ?? '?' }));
      }
    } catch {
      Alert.alert('Error', 'Could not join match queue. Try again.');
    } finally {
      setJoining(false);
    }
  }

  async function handleBypass() {
    setBypassing(true);
    try {
      const fn = httpsCallable(functions, 'bypassMatchmaking');
      await fn({});
    } catch {
      Alert.alert('Error', 'Could not bypass. Try again.');
    } finally {
      setBypassing(false);
    }
  }

  return (
    <Card glowColor="orange" className="p-5">
      <View className="flex-row items-center justify-between mb-4">
        <Badge label={t('slot.gate')} variant="info" />
        <Text variant="mono" className="text-zinc-600">🥊</Text>
      </View>

      <Text variant="subheading" className="mb-1">{t('match.title')}</Text>

      {!matchStatus || matchStatus === 'bypassed' ? (
        <>
          <Text variant="bodySmall" className="text-zinc-400 mb-4">{t('match.waiting')}</Text>
          <View className="gap-3">
            <Button onPress={handleJoin} disabled={joining} fullWidth>
              {joining ? '…' : t('match.joinQueue')}
            </Button>
            <Button onPress={handleBypass} disabled={bypassing} variant="ghost" fullWidth>
              {bypassing ? '…' : t('match.bypassed')}
            </Button>
          </View>
        </>
      ) : matchStatus === 'waiting' ? (
        <>
          <Text variant="bodySmall" className="text-sky-400 mb-4 animate-pulse">{t('match.waiting')}</Text>
          <Button onPress={handleBypass} disabled={bypassing} variant="ghost" fullWidth>
            {bypassing ? '…' : t('match.bypassed')}
          </Button>
        </>
      ) : matchStatus === 'matched' ? (
        <Text variant="bodySmall" className="text-blue-400">{t('match.matched', { opponent: '?' })}</Text>
      ) : matchStatus === 'won' ? (
        <>
          <Text variant="bodySmall" className="text-emerald-400 mb-4">{t('match.won', { bonus: '150' })}</Text>
          <Button onPress={() => router.push('/basket-zone')} fullWidth>
            {t('basket.title')} →
          </Button>
        </>
      ) : matchStatus === 'lost' ? (
        <>
          <Text variant="bodySmall" className="text-red-400 mb-4">{t('match.lost', { delay: '90' })}</Text>
          <Button onPress={() => router.push('/basket-zone')} fullWidth>
            {t('basket.title')} →
          </Button>
        </>
      ) : null}
    </Card>
  );
}

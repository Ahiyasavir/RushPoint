import React, { useEffect, useState } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../src/services/firebase.config';
import { useGameStore } from '../src/store/gameStore';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { Badge } from '../src/components/Badge';
import type { BadgeProps } from '../src/components/Badge';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { useTranslation } from '../src/i18n';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';

// ─── Local types matching the Firestore gameState shape ───────────────────────
// (avoids depending on @rushpoint/shared until its dist/ is built)

type SlotType   = 'green' | 'orange' | 'gold';
type SlotStatus = 'locked' | 'active' | 'completed' | 'skipped';

interface FirestoreSlot {
  index:      number;
  type:       SlotType;
  status:     SlotStatus;
  taskId?:    string;
  taskTitle?: string;
  startedAt?: unknown; // ISO string or Firestore Timestamp
}

interface JudgingState {
  slotIndex: number;
  checkInId: string;
  arrivedAt: unknown;
}

interface FirestoreGameState {
  teamId:       string;
  slots:        FirestoreSlot[];
  score:        number;
  bonusPenalty: number;
  judging?:     JudgingState | null;
}

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
  orange: 'orange',
  gold:   'gold',
};

const SLOT_GLOW_COLOR: Record<SlotType, 'green' | 'orange' | 'gold'> = {
  green:  'green',
  orange: 'orange',
  gold:   'gold',
};

const DOT_COLOR: Record<SlotType, Record<SlotStatus, string>> = {
  green:  { completed: 'bg-emerald-500', active: 'bg-emerald-400', locked: 'bg-zinc-800', skipped: 'bg-zinc-600' },
  orange: { completed: 'bg-orange-500',  active: 'bg-orange-400',  locked: 'bg-zinc-800', skipped: 'bg-zinc-600' },
  gold:   { completed: 'bg-amber-400',   active: 'bg-amber-300',   locked: 'bg-zinc-800', skipped: 'bg-zinc-600' },
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const insets   = useSafeAreaInsets();
  const { t }    = useTranslation();
  const teamId   = useGameStore((s) => s.teamId);
  const teamName = useGameStore((s) => s.teamName);

  const [gameState, setGameState] = useState<FirestoreGameState | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [snapError, setSnapError] = useState(false);
  const [nowMs,     setNowMs]     = useState(Date.now());

  // Tick once per second to drive the live elapsed-time clock.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!teamId) return;

    const ref = doc(db, `artifacts/${APP_ID}/users/${teamId}/gameState/current`);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setGameState(snap.data() as FirestoreGameState);
          setSnapError(false);
        }
        setLoading(false);
      },
      () => {
        setSnapError(true);
        setLoading(false);
      },
    );

    return unsub;
  }, [teamId]);

  const activeSlot      = gameState?.slots.find((s) => s.status === 'active') ?? null;
  const completedCount  = gameState?.slots.filter((s) => s.status === 'completed').length ?? 0;
  const score           = gameState?.score ?? 0;

  return (
    <View className="flex-1 bg-zinc-950">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <View
        className="border-b border-zinc-800/60 px-5 pb-4"
        style={{ paddingTop: insets.top + 8 }}
      >
        <View className="flex-row justify-end mb-3">
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
        ) : activeSlot ? (
          <ActiveTaskCard slot={activeSlot} judging={gameState?.judging ?? null} nowMs={nowMs} />
        ) : (
          <Card className="p-6 items-center">
            <Text variant="bodySmall" className="text-zinc-500 text-center">
              {t('dash.noMission')}
            </Text>
          </Card>
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

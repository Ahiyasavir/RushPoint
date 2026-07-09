import React, { useRef, useMemo, useLayoutEffect } from 'react';
import { View, ScrollView, Pressable, Animated, Easing } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { Badge } from '../src/components/Badge';
import type { BadgeProps } from '../src/components/Badge';
import { useGameStore, type LiveSlot, type SlotType } from '../src/store/gameStore';
import { useTranslation } from '../src/i18n';

// ─── Time helpers ─────────────────────────────────────────────────────────────

function toMs(value: unknown): number | null {
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

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SLOT_BADGE_VARIANT: Record<SlotType, BadgeProps['variant']> = {
  green: 'green', gate: 'info', orange: 'orange', gold: 'gold',
};

interface StageStat {
  index: number;
  type: SlotType;
  durationSec: number | null; // null if not completed / missing timestamps
  completed: boolean;
}

function buildStats(slots: LiveSlot[]) {
  const stages: StageStat[] = slots.map((s) => {
    const start = toMs(s.startedAt);
    const end = toMs(s.completedAt);
    const durationSec =
      start != null && end != null && end >= start ? Math.round((end - start) / 1000) : null;
    return { index: s.index, type: s.type, durationSec, completed: s.status === 'completed' };
  });

  const completedCount = stages.filter((s) => s.completed).length;
  type TimedStage = StageStat & { durationSec: number };
  const timed = stages.filter((s): s is TimedStage => s.durationSec != null);

  // Total race time: earliest start → latest completion across all slots.
  const starts = slots.map((s) => toMs(s.startedAt)).filter((n): n is number => n != null);
  const ends = slots.map((s) => toMs(s.completedAt)).filter((n): n is number => n != null);
  const totalSec =
    starts.length && ends.length ? Math.max(0, Math.round((Math.max(...ends) - Math.min(...starts)) / 1000)) : null;

  // Fastest completed stage (by duration).
  const fastest = timed.length
    ? timed.reduce((a, b) => (b.durationSec < a.durationSec ? b : a))
    : null;

  return { stages, completedCount, totalSec, fastest };
}

/**
 * Race Wrapped — a personal end-of-event summary for the team: final score,
 * total time on course, stages completed, and per-stage durations with the
 * fastest highlighted. Built entirely from the local gameState mirror.
 *
 * Deliberately shows NO rank/placement: the leaderboard reveal is staged by the
 * admin (last→first), so surfacing rank here would spoil it. Reachable from the
 * Final Run screen.
 */
export default function WrappedScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const teamName = useGameStore((s) => s.teamName);
  const live = useGameStore((s) => s.live);
  const score = live?.score ?? 0;
  const penalty = live?.bonusPenalty ?? 0;
  const finalScore = Math.max(0, score - penalty);
  const teneCount = live?.teneSelection?.length ?? 0;

  const { stages, completedCount, totalSec, fastest } = buildStats(live?.slots ?? []);

  // ─── Entrance animation ──────────────────────────────────────────────────
  // Values start at 1 (final/visible state) so the screen is fully readable if
  // the layout effect never runs (e.g. JS animations skipped). useLayoutEffect
  // resets them to 0 and animates back to 1 before paint, so there is no flash.
  const row1 = useRef(new Animated.Value(1)).current;
  const row2 = useRef(new Animated.Value(1)).current;
  const fastestAnim = useRef(new Animated.Value(1)).current;
  const stageAnims = useMemo(
    () => Array.from({ length: stages.length }, () => new Animated.Value(1)),
    [stages.length],
  );

  useLayoutEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const fadeUp = (v: Animated.Value, delay: number) => {
      v.setValue(0);
      return Animated.timing(v, { toValue: 1, duration: 400, delay, easing: ease, useNativeDriver: true });
    };
    Animated.parallel([
      fadeUp(row1, 100),
      fadeUp(row2, 250),
      fadeUp(fastestAnim, 450),
      Animated.stagger(40, stageAnims.map((a) => fadeUp(a, 300))),
    ]).start();
  }, [row1, row2, fastestAnim, stageAnims]);

  const fadeUpStyle = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  });

  return (
    <View className="flex-1 bg-app-bg" style={{ paddingTop: insets.top }}>
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-8 pb-16">
        {/* Header */}
        <Text variant="label" className="text-neon-gold tracking-[0.3em] mb-1">
          {t('wrapped.label')}
        </Text>
        <Text variant="display" className="font-brand text-white mb-1">{t('wrapped.title')}</Text>
        <Text variant="subheading" className="text-zinc-400 mb-6" numberOfLines={1}>
          {teamName || '—'}
        </Text>

        {/* Headline stats */}
        <Animated.View style={fadeUpStyle(row1)}>
          <View className="flex-row gap-3 mb-3">
            <Card glowColor="gold" className="flex-1 p-4 items-center">
              <Text variant="label" className="text-zinc-500 mb-1">{t('wrapped.finalScore')}</Text>
              <Text variant="display" className="font-brand text-neon-gold text-4xl">{finalScore}</Text>
              {penalty > 0 && (
                <Text variant="caption" className="text-neon-red font-mono mt-1">−{penalty}</Text>
              )}
            </Card>
            <Card className="flex-1 p-4 items-center">
              <Text variant="label" className="text-zinc-500 mb-1">{t('wrapped.totalTime')}</Text>
              <Text variant="mono" className="text-white text-3xl mt-1">
                {totalSec != null ? fmtDuration(totalSec) : '—'}
              </Text>
            </Card>
          </View>
        </Animated.View>

        <Animated.View style={fadeUpStyle(row2)}>
          <View className="flex-row gap-3 mb-6">
            <Card className="flex-1 p-4 items-center">
              <Text variant="label" className="text-zinc-500 mb-1">{t('wrapped.stagesDone')}</Text>
              <Text variant="display" className="font-brand text-neon-green text-3xl">
                {completedCount}/{stages.length}
              </Text>
            </Card>
            <Card className="flex-1 p-4 items-center">
              <Text variant="label" className="text-zinc-500 mb-1">{t('wrapped.teneItems')}</Text>
              <Text variant="display" className="font-brand text-neon-orange text-3xl">{teneCount}</Text>
            </Card>
          </View>
        </Animated.View>

        {/* Fastest stage highlight */}
        {fastest && (
          <Animated.View
            style={{
              opacity: fastestAnim,
              transform: [{ scale: fastestAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
            }}
          >
            <Card glowColor="green" className="p-4 mb-6 flex-row items-center justify-between">
              <View className="flex-1 me-3">
                <Text variant="label" className="text-neon-green mb-1">⚡ {t('wrapped.fastest')}</Text>
                <Text variant="bodySmall" className="text-zinc-300">{t(`slot.${fastest.type}`)}</Text>
              </View>
              <Text variant="mono" className="text-2xl text-neon-green">{fmtDuration(fastest.durationSec)}</Text>
            </Card>
          </Animated.View>
        )}

        {/* Per-stage breakdown */}
        <Text variant="label" className="mb-3">{t('wrapped.breakdown')}</Text>
        <View className="rounded-2xl border border-glass-border bg-app-card/40 overflow-hidden">
          {stages.map((s, i) => (
            <Animated.View key={s.index} style={fadeUpStyle(stageAnims[i])}>
              <View
                className={`flex-row items-center justify-between px-4 py-3 ${
                  i < stages.length - 1 ? 'border-b border-glass-border' : ''
                }`}
              >
                <View className="flex-row items-center gap-3">
                  <Text variant="mono" className="text-zinc-600">{String(s.index + 1).padStart(2, '0')}</Text>
                  <Badge label={t(`slot.${s.type}`)} variant={SLOT_BADGE_VARIANT[s.type]} />
                </View>
                <Text
                  variant="mono"
                  className={
                    fastest && s.index === fastest.index
                      ? 'text-neon-green'
                      : s.durationSec != null ? 'text-white' : 'text-zinc-600'
                  }
                >
                  {s.durationSec != null ? fmtDuration(s.durationSec) : s.completed ? '—' : t('wrapped.notDone')}
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>

        <View className="mt-8 items-center">
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            className="px-5 py-2.5 rounded-xl border border-glass-border active:bg-white/5"
          >
            <Text variant="bodySmall" className="text-zinc-400">{t('wrapped.back')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

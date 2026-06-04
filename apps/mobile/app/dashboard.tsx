import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, ActivityIndicator, Pressable, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../src/services/firebase.config';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';
import { useGameStore, type LiveSlot, type LiveJudging, type MatchStatus } from '../src/store/gameStore';
import { useGameSync } from '../src/hooks/useGameSync';
import { useAdaptiveLocation } from '../src/hooks/useAdaptiveLocation';
import { useWakeLock } from '../src/hooks/useWakeLock';
import { useAnnouncements } from '../src/hooks/useAnnouncements';
import { AnnouncementBanner } from '../src/components/AnnouncementBanner';
import { Text } from '../src/components/Text';
import { Card } from '../src/components/Card';
import { Badge } from '../src/components/Badge';
import { Button } from '../src/components/Button';
import type { BadgeProps } from '../src/components/Badge';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { useToast } from '../src/components/Toast';
import { useOfflineToast } from '../src/hooks/useOfflineToast';
import { useFlashMissions } from '../src/hooks/useFlashMissions';
import { FlashMissionBanner, useDismissableFlash } from '../src/components/FlashMissionBanner';
import { useTranslation } from '../src/i18n';
import { GLOW } from '../src/components/tokens';
import Animated, {
  FadeInDown,
  ZoomIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

// Slot shape is mirrored from the store (LiveSlot / LiveJudging).
type SlotType   = 'green' | 'gate' | 'orange' | 'gold';
type FirestoreSlot = LiveSlot;
type JudgingState  = LiveJudging;

const CRAFTING_DURATION_SECS = 20 * 60;
const SPRINT_BUDGET_SECS     = 90;
// Smart-station speed streak: 3 fast completions in a row latch a 1.5x multiplier.
const STREAK_THRESHOLD       = 3;

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

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const insets   = useSafeAreaInsets();
  const { t }    = useTranslation();
  const teamId   = useGameStore((s) => s.teamId);
  const teamName = useGameStore((s) => s.teamName);
  const gameState = useGameStore((s) => s.live);
  const syncState = useGameStore((s) => s.syncState);
  const isOnline  = useGameStore((s) => s.isOnline);

  const [nowMs, setNowMs] = useState(Date.now());
  const { show: showToast } = useToast();

  // Live Firestore mirror (drives score/slots) + offline notifications.
  useGameSync(teamId);
  useOfflineToast();
  // Battery-aware location pings (fast in transit, slow when stationary).
  useAdaptiveLocation(teamId);
  // Keep the screen awake while racing — teams glance at this scoreboard for hours.
  useWakeLock(true);

  // Live flash-mission broadcast (admin-pushed), with local dismissal.
  const flashMission = useFlashMissions();
  const { visible: visibleFlash, dismiss: dismissFlash } = useDismissableFlash(flashMission);

  // Operational announcements (persistent marquee until dismissed per-device).
  const announcements = useAnnouncements();

  // Declared-arrival freeze: once the team taps "arrived at the judge" it creates
  // a pending check-in and joins the queue. The server already locks the sprint
  // penalty to that check-in timestamp, so the displayed crafting/sprint clocks
  // must freeze there too — otherwise they keep ticking (and flash "LATE") while
  // the team waits for a judge, which doesn't match the score and causes panic.
  const [declaredArrivalMs, setDeclaredArrivalMs] = useState<number | null>(null);
  useEffect(() => {
    if (!teamId) { setDeclaredArrivalMs(null); return; }
    const q = query(
      collection(db, `artifacts/${APP_ID}/users/${teamId}/checkIns`),
      where('status', '==', 'pending'),
    );
    const unsub = onSnapshot(q, (snap) => {
      let earliest: number | null = null;
      snap.forEach((d) => {
        const ts = toMillis((d.data() as { timestamp?: unknown }).timestamp);
        if (ts != null && (earliest == null || ts < earliest)) earliest = ts;
      });
      setDeclaredArrivalMs(earliest);
    }, () => setDeclaredArrivalMs(null));
    return unsub;
  }, [teamId]);

  // Auto-request task assignment when a green slot becomes active without a taskId.
  // requestNextTask writes the result back to gameState (server-authoritative),
  // so useGameSync picks it up via onSnapshot — no local state needed.
  // Only request a mission once the race is live for this team (post-launch).
  const launchedForAssign = gameState ? gameState.launched !== false : true;
  const launchAtMsForAssign = toMillis(gameState?.launchAt);
  const raceLiveForAssign = launchedForAssign && !(launchAtMsForAssign != null && launchAtMsForAssign > nowMs);
  const activeSlotForAssignment = gameState?.slots.find((s) => s.status === 'active');
  const needsAssignment = raceLiveForAssign && activeSlotForAssignment?.type === 'green' && !activeSlotForAssignment?.taskId;
  const assignmentKey   = `${activeSlotForAssignment?.index ?? -1}-${activeSlotForAssignment?.taskId ?? 'none'}`;
  useEffect(() => {
    if (!needsAssignment || !teamId) return;
    let cancelled = false;
    const assign = httpsCallable(functions, 'requestNextTask');

    async function request() {
      const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
      let lat = 31.7683, lng = 35.2137; // Jerusalem centre fallback
      if (geo) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5000);
          geo.getCurrentPosition(
            (pos) => { clearTimeout(timer); lat = pos.coords.latitude; lng = pos.coords.longitude; resolve(); },
            () => { clearTimeout(timer); resolve(); },
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 15_000 },
          );
        });
      }
      if (!cancelled) {
        try { await assign({ lat, lng, targetType: 'green' }); }
        catch { /* transient — will retry when gameState updates */ }
      }
    }

    void request();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentKey, needsAssignment, teamId]);

  // Surface a one-time toast when management evacuates the team off a station.
  const evacuatedFrom = (gameState as { evacuatedFrom?: string | null } | null)?.evacuatedFrom ?? null;
  const lastEvacRef = useRef<string | null>(null);
  useEffect(() => {
    if (evacuatedFrom && evacuatedFrom !== lastEvacRef.current) {
      lastEvacRef.current = evacuatedFrom;
      showToast(t('evac.moved', { station: evacuatedFrom }), 'info');
    }
    if (!evacuatedFrom) lastEvacRef.current = null;
  }, [evacuatedFrom, showToast, t]);

  // Smart-station speed streak (server-authoritative). Fire a celebration toast
  // exactly once on the 2→3 transition; the badge itself is rendered in the header.
  const smartStreak = gameState?.smartStreak ?? 0;
  const onFire = smartStreak >= STREAK_THRESHOLD;
  const prevStreakRef = useRef(smartStreak);
  useEffect(() => {
    if (prevStreakRef.current < STREAK_THRESHOLD && smartStreak >= STREAK_THRESHOLD) {
      showToast(t('dash.comboToast'), 'success');
    }
    prevStreakRef.current = smartStreak;
  }, [smartStreak, showToast, t]);

  // Tick once per second to drive the live elapsed-time clock.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // When every slot is terminal, sweep into the Final Run celebration once.
  const navigatedFinal = useRef(false);
  useEffect(() => {
    const slots = gameState?.slots;
    if (!slots || slots.length < 6) return;
    const allDone = slots.every((s) => s.status === 'completed' || s.status === 'skipped');
    if (allDone && !navigatedFinal.current) {
      navigatedFinal.current = true;
      router.push('/final-run');
    }
  }, [gameState?.slots]);

  // Reconnect banner: show a brief "Back online" confirmation for ~2s after the
  // connection is restored, then auto-dismiss. Tracks the previous online state
  // so the green flash only fires on an offline→online transition.
  const [showRestored, setShowRestored] = useState(false);
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (!wasOnlineRef.current && isOnline) {
      setShowRestored(true);
      const id = setTimeout(() => setShowRestored(false), 2000);
      wasOnlineRef.current = isOnline;
      return () => clearTimeout(id);
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline]);

  const loading         = syncState === 'loading' && !gameState;
  const snapError       = syncState === 'error' && !gameState;
  const activeSlot      = gameState?.slots.find((s) => s.status === 'active') ?? null;
  const completedCount  = gameState?.slots.filter((s) => s.status === 'completed').length ?? 0;
  const score           = gameState?.score ?? 0;
  const penalty         = gameState?.bonusPenalty ?? 0;
  const effectiveScore  = Math.max(0, score - penalty);

  // Staged start: a team stands by after registering until the admin launches it,
  // then a short countdown, then the race goes live. Absent `launched` (legacy /
  // seeded teams) counts as live, so this only gates freshly-registered teams.
  const launched      = gameState ? gameState.launched !== false : true;
  const launchAtMs    = toMillis(gameState?.launchAt);
  const counting      = launched && launchAtMs != null && launchAtMs > nowMs;
  const launchLeftSec = counting ? Math.max(0, Math.ceil((launchAtMs! - nowMs) / 1000)) : 0;
  const raceLive      = launched && !counting;

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
  // Freeze the clock once arrival is declared (pending check-in) or a judge has
  // taken the team (gameState.judging) — matches the server's penalty basis.
  const arrivalFreezeMs = toMillis(gameState?.judging?.arrivedAt) ?? declaredArrivalMs;
  const craftingClockMs = arrivalFreezeMs ?? nowMs;
  const craftingFrozen  = arrivalFreezeMs != null;
  const craftingElapsed = craftingActive ? Math.max(0, Math.floor((craftingClockMs - craftingStartMs!) / 1000)) : 0;
  const craftingLeft    = Math.max(0, CRAFTING_DURATION_SECS - craftingElapsed);
  const craftingDone    = craftingElapsed >= CRAFTING_DURATION_SECS;
  const sprintElapsed   = craftingDone ? Math.max(0, craftingElapsed - CRAFTING_DURATION_SECS) : 0;
  const sprintLeft      = Math.max(0, SPRINT_BUDGET_SECS - sprintElapsed);

  // Standby / countdown: until the admin launches this team, replace the whole
  // dashboard with a calm "waiting for the start" screen; then a 10→0 countdown.
  if (gameState && !raceLive) {
    return (
      <View className="flex-1 bg-app-bg items-center justify-center px-8" style={{ paddingTop: insets.top }}>
        <View className="absolute top-0 left-0 right-0 flex-row justify-end px-5" style={{ paddingTop: insets.top + 8 }}>
          <LanguageToggle />
        </View>
        <Text variant="label" className="text-zinc-500 mb-2">{teamName || '—'}</Text>
        {counting ? (
          <>
            <Text variant="label" className="text-neon-green tracking-[0.3em] mb-3">{t('launch.getReady')}</Text>
            <Text variant="display" className="font-brand text-neon-green" style={[GLOW.green, { fontSize: 96, lineHeight: 104 }]}>
              {launchLeftSec}
            </Text>
            <Text variant="bodySmall" className="text-zinc-400 mt-3 text-center">{t('launch.countdownHint')}</Text>
          </>
        ) : (
          <>
            <Text className="text-6xl mb-5">⏳</Text>
            <Text variant="heading" className="text-white text-center mb-2">{t('launch.waitTitle')}</Text>
            <Text variant="bodySmall" className="text-zinc-400 text-center leading-relaxed">
              {t('launch.waitBody')}
            </Text>
          </>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-app-bg">
      {/* ── Flash-mission overlay (admin broadcast) ──────────────────── */}
      {visibleFlash && (
        <FlashMissionBanner mission={visibleFlash} onDismiss={dismissFlash} />
      )}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <View
        className="bg-app-surface/80 border-b border-glass-border px-5 pb-4"
        style={{ paddingTop: insets.top + 8 }}
      >
        <View className="flex-row justify-between items-center mb-3">
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => router.push('/map')}
              hitSlop={8}
              className="px-3 py-1.5 rounded-full border border-neon-green/30 bg-neon-green/10 active:bg-neon-green/20 active:scale-95 transition-all duration-200"
            >
              <Text variant="caption" className="text-neon-green font-mono">🗺  {t('map.open')}</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/sos')}
              hitSlop={8}
              className="px-3 py-1.5 rounded-full border border-neon-red/30 bg-neon-red/10 active:bg-neon-red/20 active:scale-95 transition-all duration-200"
            >
              <Text variant="caption" className="text-neon-red font-mono">📣 {t('staff.open')}</Text>
            </Pressable>
          </View>
          <LanguageToggle />
        </View>

        <View className="flex-row items-start justify-between">
          <View className="flex-1 me-4">
            <Text variant="label">{t('dash.team')}</Text>
            <Text variant="heading" numberOfLines={1}>{teamName || '—'}</Text>
          </View>

          <View className="items-end">
            <Text variant="label" className="text-zinc-600">{t('dash.score')}</Text>
            {/* Telemetry — giant glanceable monospace numerals (readable mid-run) */}
            <Text className="text-neon-green font-mono text-5xl font-extrabold tracking-wider leading-tight" style={GLOW.green}>
              {effectiveScore}
            </Text>
            {penalty > 0 ? (
              <Text variant="caption" className="text-neon-red font-mono">−{penalty} {t('dash.penalty')}</Text>
            ) : (
              <Text variant="label" className="text-zinc-700">{t('dash.pts')}</Text>
            )}
          </View>
        </View>

        {onFire && <OnFireBadge label={t('dash.onFire')} />}

        <Text variant="caption" className="text-zinc-600 mt-2">
          {t('dash.slotsCompleted', { n: completedCount })}
        </Text>
      </View>

      {/* ── Operational announcement (persistent, until dismissed) ────── */}
      <AnnouncementBanner announcements={announcements} />

      {/* ── Reconnect strip: sticky, non-blocking, slim (<36px). Only when
          cached state is available; otherwise the loading spinner shows. ─ */}
      {gameState && !isOnline ? (
        <View className="bg-yellow-500/20 border-b border-yellow-500/40 px-4 py-2">
          <Text variant="caption" className="text-yellow-300 font-mono text-start">
            ⟳ {t('offline.reconnecting')}
          </Text>
        </View>
      ) : gameState && showRestored ? (
        <View className="bg-green-500/20 border-b border-green-500/40 px-4 py-2">
          <Text variant="caption" className="text-green-300 font-mono text-start">
            ✓ {t('offline.backOnline')}
          </Text>
        </View>
      ) : null}

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="label" className="mb-4">{t('dash.currentMission')}</Text>

        {loading ? (
          <View className="py-10 items-center">
            <ActivityIndicator color="#F59E0B" />
          </View>
        ) : snapError ? (
          <Card className="p-6 items-center">
            <Text variant="bodySmall" className="text-red-400 text-center">
              {t('dash.loadError')}
            </Text>
          </Card>
        ) : activeSlot?.type === 'gate' ? (
          <GateCard slot={activeSlot} matchStatus={gameState?.matchStatus} gateCooldownUntil={gameState?.gateCooldownUntil ?? null} nowMs={nowMs} />
        ) : activeSlot ? (
          <ActiveTaskCard slot={activeSlot} judging={gameState?.judging ?? null} nowMs={nowMs} craftingActive={craftingActive} />
        ) : (
          <Card className="p-6 items-center">
            <Text variant="bodySmall" className="text-zinc-500 text-center">
              {completedCount === 6 ? t('dash.noMission.done') : t('dash.noMission.waiting')}
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
              frozen={craftingFrozen}
            />
          </View>
        )}

        {/* ── Smart station: interactive task on the active slot ──────── */}
        {(activeSlot as (LiveSlot & { smart?: { enabled?: boolean } }) | null)?.smart?.enabled && (
          <Pressable
            onPress={() => router.push('/smart-station')}
            className="mt-4 rounded-2xl border border-neon-gold/30 bg-neon-gold/5 p-4 active:opacity-70 active:scale-95 transition-all duration-200"
          >
            <Text variant="label" className="text-neon-gold">🎯 {t('station.open')}</Text>
            <Text variant="bodySmall" className="text-zinc-500 mt-1">{t('station.openHint')}</Text>
          </Pressable>
        )}

        {/* ── Phase 3: Basket zone link ─────────────────────────────── */}
        {activeSlot?.type === 'orange' && !craftingActive && (
          <Pressable
            onPress={() => router.push('/basket-zone')}
            className="mt-4 rounded-2xl border border-neon-orange/30 bg-neon-orange/5 p-4 active:opacity-70 active:scale-95 transition-all duration-200"
          >
            <Text variant="label" className="text-neon-orange">🧺 {t('basket.title')}</Text>
            <Text variant="bodySmall" className="text-zinc-500 mt-1">{t('basket.scanPrompt')}</Text>
          </Pressable>
        )}

        {/* ── Race progress — 6-slot structural badge board ─────────── */}
        {gameState && (
          <View className="mt-10">
            <Text variant="label" className="mb-3">{t('dash.raceProgress')}</Text>
            <View className="flex-row gap-2">
              {gameState.slots.map((s, i) => (
                <SlotBadge key={s.index} slot={s} index={i} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Contextual next-step hint (what to physically DO on the active slot) ──────

function NextStepHint({
  slot, judging, craftingActive, matchStatus,
}: {
  slot: FirestoreSlot;
  judging: JudgingState | null;
  craftingActive: boolean;
  matchStatus?: MatchStatus;
}) {
  const { t } = useTranslation();
  const frozen = !!judging && judging.slotIndex === slot.index;

  let key: string | null = null;
  if (slot.type === 'green') {
    key = slot.taskId ? 'dash.hint.greenTask' : 'dash.hint.greenAssigning';
  } else if (slot.type === 'gold') {
    if (frozen) key = 'dash.hint.goldFrozen';
    else if (craftingActive) key = 'dash.hint.goldCrafting';
  } else if (slot.type === 'orange') {
    key = 'dash.hint.orange';
  } else if (slot.type === 'gate' && matchStatus !== 'waiting' && matchStatus !== 'matched') {
    // GateNextStepHint covers the in-queue states; this is the approach/pre-queue fallback.
    key = 'dash.hint.gate';
  }
  if (!key) return null;

  return (
    <Text variant="bodySmall" className="text-zinc-400 mb-3">
      📍 {t(key)}
    </Text>
  );
}

// ─── "ON FIRE" speed-streak badge (subtle pulse — UI-thread only) ─────────────

function OnFireBadge({ label }: { label: string }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.78 + pulse.value * 0.22,
    transform: [{ scale: 1 + pulse.value * 0.03 }],
  }));
  return (
    <Animated.View
      entering={ZoomIn.duration(300)}
      style={style}
      className="mt-3 self-start flex-row items-center px-3 py-1.5 rounded-full border border-neon-orange/50 bg-neon-orange/10"
    >
      <Text variant="caption" className="text-neon-orange font-mono font-bold">{label}</Text>
    </Animated.View>
  );
}

// ─── Active task card ─────────────────────────────────────────────────────────

function ActiveTaskCard({
  slot, judging, nowMs, craftingActive,
}: {
  slot: FirestoreSlot;
  judging: JudgingState | null;
  nowMs: number;
  craftingActive: boolean;
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

      {/* Contextual next-step guidance so the team knows what to physically do. */}
      <NextStepHint slot={slot} judging={judging} craftingActive={craftingActive} />

      {/* Only surface the friendly "assigning" hint when no task is set yet —
          never the raw task id (the title + badge already name the mission). */}
      {!slot.taskId && (
        <Text variant="bodySmall" className="text-zinc-400 mb-4">
          {t('dash.assigning')}
        </Text>
      )}

      {/* Elapsed-time clock — freezes while a judge is evaluating */}
      {elapsedSec != null && (
        <View className="flex-row items-center justify-between border-t border-zinc-800 pt-4">
          <View>
            <Text variant="label" className={frozen ? 'text-neon-blue' : 'text-zinc-600'}>
              {frozen ? t('dash.timeFrozen') : t('dash.elapsed')}
            </Text>
            <Text variant="mono" className={`text-2xl ${frozen ? 'text-neon-blue' : 'text-white'}`}>
              {formatElapsed(elapsedSec)}
            </Text>
          </View>
          {frozen && <Badge label={t('dash.beingJudged')} variant="info" />}
        </View>
      )}

      {/* Arrived at the judge → enter the pending queue for grading. ONLY for the
          gold stage, and ONLY once crafting has started (team has the Tene + the
          20-min fill timer). Green field missions are graded by the station
          operator, so they must NOT expose a self-serve "arrived at judge" button. */}
      {!frozen && slot.type === 'gold' && craftingActive && (
        <RequestCheckInButton slot={slot} />
      )}

      {/* Clue hint — costs points, only while actively working the task */}
      {!frozen && slot.taskId && <ClueHintButton />}
    </Card>
  );
}

// ─── Request judge check-in (creates a pending check-in) ───────────────────────

function RequestCheckInButton({ slot }: { slot: FirestoreSlot }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const teamId = useGameStore((s) => s.teamId);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);

  // Green slots must have a real taskId before the team can check in.
  // The auto-assignment effect writes it to Firestore; this guard prevents
  // a phantom 'tene-basket' entry while the assignment is in flight.
  if (slot.type === 'green' && !slot.taskId) {
    return (
      <View className="border-t border-zinc-800 mt-4 pt-4 items-center">
        <Text variant="bodySmall" className="text-neon-blue animate-pulse-neon">
          {t('dash.assigning')}
        </Text>
      </View>
    );
  }

  async function request() {
    if (!teamId) return;
    setBusy(true);
    try {
      await addDoc(collection(db, `artifacts/${APP_ID}/users/${teamId}/checkIns`), {
        teamId,
        taskId:    slot.taskId ?? 'tene-basket',
        taskTitle: slot.taskTitle ?? (slot.type === 'gold' ? t('checkin.basketTitle') : t('dash.activeMission')),
        status:    'pending',
        timestamp: new Date().toISOString(),
      });
      setRequested(true);
      show(t('checkin.requested'), 'success');
    } catch {
      show(t('checkin.error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (requested) {
    return (
      <View className="border-t border-zinc-800 mt-4 pt-4">
        <Text variant="bodySmall" className="text-neon-blue text-center animate-pulse-neon">
          {t('checkin.waiting')}
        </Text>
      </View>
    );
  }

  return (
    <View className="border-t border-zinc-800 mt-4 pt-4">
      <Pressable
        onPress={() => void request()}
        disabled={busy}
        className="py-2.5 rounded-xl bg-neon-green/10 border border-neon-green/30 items-center active:bg-neon-green/20 active:scale-95 transition-all duration-200"
      >
        <Text variant="bodySmall" className="text-neon-green font-semibold">
          {busy ? '…' : t('checkin.arrived')}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Clue hint button (two-step confirm) ──────────────────────────────────────

function ClueHintButton() {
  const { t } = useTranslation();
  const { show } = useToast();
  const [armed, setArmed]   = useState(false);
  const [busy, setBusy]     = useState(false);

  async function request() {
    setBusy(true);
    try {
      await httpsCallable(functions, 'requestClueHint')({});
      show(t('hint.applied'), 'info');
    } catch {
      show(t('hint.error'), 'error');
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <View className="border-t border-zinc-800 mt-4 pt-4">
      {!armed ? (
        <Pressable onPress={() => setArmed(true)} hitSlop={6} className="flex-row items-center justify-between">
          <Text variant="bodySmall" className="text-neon-gold">💡 {t('hint.ask')}</Text>
          <Text variant="caption" className="text-zinc-600">{t('hint.cost')}</Text>
        </Pressable>
      ) : (
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => void request()}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-neon-gold/10 border border-neon-gold/30 items-center active:bg-neon-gold/20"
          >
            <Text variant="bodySmall" className="text-neon-gold font-semibold">
              {busy ? '…' : t('hint.confirm')}
            </Text>
          </Pressable>
          <Pressable onPress={() => setArmed(false)} hitSlop={6} className="px-3 py-2.5">
            <Text variant="bodySmall" className="text-zinc-500">{t('hint.cancel')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ─── Stage tracker row ─────────────────────────────────────────────────────────
// One labeled row per stage: status marker + stage name + status chip. Replaces
// the old anonymous colour dots so a participant can read exactly where they are.

// Stage-type identity glyph for the progress board badges.
const SLOT_TYPE_GLYPH: Record<SlotType, string> = {
  green: '⛳', gate: '⚔️', orange: '🧺', gold: '🏆',
};

/**
 * One structural progress-board badge. Locked → dark & clean; active → sharp
 * amber border + bright number; completed → solid slate with a subtle gold ✓;
 * skipped → muted dash. No glow — crisp borders only (premium look).
 */
function SlotBadge({ slot, index }: { slot: FirestoreSlot; index: number }) {
  const active  = slot.status === 'active';
  const done    = slot.status === 'completed';
  const skipped = slot.status === 'skipped';
  const locked  = slot.status === 'locked';

  return (
    <Animated.View entering={FadeInDown.delay(index * 45).duration(300)} className="flex-1 items-center">
      <View
        className={`w-full h-14 rounded-2xl items-center justify-center border ${
          active
            ? 'border-2 border-neon-green bg-neon-green/10'
            : done
              ? 'border border-glass-border bg-app-raised'
              : 'border border-glass-border bg-app-card/40'
        } ${active ? 'animate-pulse-neon' : ''}`}
      >
        {done ? (
          <Text className="text-neon-gold text-lg font-bold">✓</Text>
        ) : skipped ? (
          <Text className="text-zinc-600 text-base">–</Text>
        ) : locked ? (
          <Text className="text-zinc-600 text-xs">🔒</Text>
        ) : (
          <Text className={`font-mono font-black text-base ${active ? 'text-neon-green' : 'text-zinc-400'}`}>
            {index + 1}
          </Text>
        )}
      </View>
      <Text className="text-[10px] mt-1 opacity-80">{SLOT_TYPE_GLYPH[slot.type]}</Text>
    </Animated.View>
  );
}

// ─── Crafting countdown card ──────────────────────────────────────────────────

function CraftingCountdownCard({
  craftingLeft, craftingDone, sprintLeft, sprintExpired, frozen,
}: {
  craftingLeft: number;
  craftingDone: boolean;
  sprintLeft: number;
  sprintExpired: boolean;
  frozen: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card glowColor="gold" className="p-5">
      <View className="flex-row items-center justify-between mb-3">
        <Badge label={t('craft.title')} variant="gold" />
        <Text variant="mono" className="text-zinc-600">🧺</Text>
      </View>
      {/* Arrival declared / judge engaged → clock is paused. Show a calm "waiting"
          state instead of a ticking or LATE timer (the score is already locked). */}
      {frozen ? (
        <View className="items-center">
          <Text variant="label" className="text-neon-blue mb-1">{t('craft.paused')}</Text>
          <Text variant="mono" className="text-3xl font-bold text-neon-blue">
            {craftingDone ? formatElapsed(Math.max(0, sprintLeft)) : formatElapsed(craftingLeft)}
          </Text>
          <Text variant="caption" className="text-zinc-500 mt-1 text-center">
            {t('craft.waitingJudge')}
          </Text>
        </View>
      ) : !craftingDone ? (
        <View className="items-center">
          <Text variant="label" className="text-zinc-500 mb-1">{t('craft.timeLeft')}</Text>
          <Text
            variant="mono"
            className={`text-4xl font-bold ${craftingLeft < 120 ? 'text-neon-orange animate-pulse-neon' : 'text-neon-gold'}`}
          >
            {formatElapsed(craftingLeft)}
          </Text>
        </View>
      ) : (
        <View className="items-center">
          <Text variant="bodySmall" className="text-neon-red mb-2 text-center animate-pulse-neon">
            {t('craft.expired')}
          </Text>
          <Text variant="label" className="text-zinc-500 mb-1">{t('craft.sprintWindow')}</Text>
          <Text
            variant="mono"
            className={`text-3xl font-bold ${sprintExpired ? 'text-neon-red animate-pulse-neon' : 'text-neon-orange'}`}
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

// ─── Matchmaking radar (rotating sapphire sweep — UI-thread only) ─────────────

function MatchRadar() {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(withTiming(360, { duration: 2600, easing: Easing.linear }), -1, false);
  }, [spin]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const ring = (size: number) => ({
    position: 'absolute' as const,
    width: size, height: size, borderRadius: size / 2,
    borderWidth: 1, borderColor: 'rgba(37,99,235,0.30)',
  });
  return (
    <View className="items-center my-4">
      <View style={{ width: 132, height: 132, alignItems: 'center', justifyContent: 'center' }}>
        <View style={ring(132)} />
        <View style={ring(88)} />
        <View style={ring(44)} />
        {/* rotating arm — a blip orbits the rings */}
        <Animated.View style={[sweep, { position: 'absolute', width: 132, height: 132, alignItems: 'center' }]}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#2563EB', marginTop: 2 }} />
        </Animated.View>
        {/* center pulse */}
        <View className="animate-pulse-neon" style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#2563EB' }} />
      </View>
    </View>
  );
}

// ─── Gate card (matchmaking filter) ──────────────────────────────────────────

function GateCard({ slot, matchStatus, gateCooldownUntil, nowMs }: {
  slot: FirestoreSlot;
  matchStatus?: MatchStatus;
  gateCooldownUntil?: string | null;
  nowMs: number;
}) {
  const { t } = useTranslation();
  const [joining, setJoining]     = useState(false);
  const rejoinedAfterCooldown = useRef(false);

  // Seconds left on the post-loss cooldown (0 when none / elapsed).
  const cooldownLeft = gateCooldownUntil
    ? Math.max(0, Math.ceil((new Date(gateCooldownUntil).getTime() - nowMs) / 1000))
    : 0;

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

  // After a loss the team waits out a 90s cooldown, THEN auto re-enters the queue
  // exactly once. The guard resets whenever they leave the 'lost' state.
  useEffect(() => {
    if (matchStatus === 'lost' && cooldownLeft === 0 && !rejoinedAfterCooldown.current) {
      rejoinedAfterCooldown.current = true;
      void handleJoin();
    } else if (matchStatus !== 'lost') {
      rejoinedAfterCooldown.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchStatus, cooldownLeft]);

  return (
    <Card glowColor="orange" className="p-5">
      <View className="flex-row items-center justify-between mb-4">
        <Badge label={t('slot.gate')} variant="info" />
        <Text variant="mono" className="text-zinc-600">🥊</Text>
      </View>

      <Text variant="subheading" className="mb-1">{t('match.title')}</Text>

      {!matchStatus ? (
        <>
          <Text variant="bodySmall" className="text-zinc-400 mb-4">{t('match.mustDuel')}</Text>
          <Button onPress={handleJoin} disabled={joining} fullWidth>
            {joining ? '…' : t('match.joinQueue')}
          </Button>
        </>
      ) : matchStatus === 'waiting' ? (
        <View className="items-center">
          <MatchRadar />
          <Text variant="bodySmall" className="text-neon-cyan animate-pulse-neon">{t('match.waiting')}</Text>
        </View>
      ) : matchStatus === 'matched' ? (
        <Animated.View entering={ZoomIn.duration(280)} className="items-center py-3">
          <View className="flex-row items-center gap-4">
            <View className="px-4 py-2 rounded-xl border border-neon-cyan/50 bg-neon-cyan/10">
              <Text variant="label" className="text-neon-cyan">{t('dash.team')}</Text>
            </View>
            <Text className="text-neon-cyan font-mono font-black text-3xl tracking-tight">VS</Text>
            <View className="px-4 py-2 rounded-xl border border-neon-red/50 bg-neon-red/10">
              <Text variant="label" className="text-neon-red">{t('match.rival')}</Text>
            </View>
          </View>
          <Text variant="bodySmall" className="text-neon-cyan mt-3 animate-pulse-neon">{t('match.matchedShort')}</Text>
        </Animated.View>
      ) : matchStatus === 'won' ? (
        <>
          <Text variant="bodySmall" className="text-neon-green mb-4">{t('match.won', { bonus: '150' })}</Text>
          <Button onPress={() => router.push('/basket-zone')} fullWidth>
            {t('basket.title')} →
          </Button>
        </>
      ) : matchStatus === 'lost' ? (
        <View className="items-center py-2">
          <Text variant="subheading" className="text-neon-red mb-1 text-center">{t('match.lostTitle')}</Text>
          {cooldownLeft > 0 ? (
            <>
              <Text variant="mono" className="text-neon-orange text-2xl text-center mb-2 font-black tracking-tight">
                {Math.floor(cooldownLeft / 60)}:{String(cooldownLeft % 60).padStart(2, '0')}
              </Text>
              {/* Depleting "energy shield" — drains each second toward re-queue */}
              <View className="w-full h-2 rounded-full bg-app-raised overflow-hidden mb-2">
                <View
                  className="h-full rounded-full bg-neon-cyan"
                  style={{ width: `${Math.min(100, Math.max(0, (cooldownLeft / 90) * 100))}%` }}
                />
              </View>
              <Text variant="bodySmall" className="text-zinc-400 text-center">
                {t('match.cooldown')}
              </Text>
            </>
          ) : (
            <Text variant="bodySmall" className="text-neon-blue text-center animate-pulse-neon">
              {t('match.rematchWaiting')}
            </Text>
          )}
        </View>
      ) : matchStatus === 'bypassed' ? (
        <>
          <Text variant="bodySmall" className="text-neon-green mb-4">{t('match.soloClear')}</Text>
          <Button onPress={() => router.push('/basket-zone')} fullWidth>
            {t('basket.title')} →
          </Button>
        </>
      ) : null}

      <GateNextStepHint matchStatus={matchStatus} />
      <NextStepHint slot={slot} judging={null} craftingActive={false} matchStatus={matchStatus} />
    </Card>
  );
}

// ─── Gate next-step hint (physical prompt, only while waiting / matched) ───────

function GateNextStepHint({ matchStatus }: { matchStatus?: MatchStatus }) {
  const { t } = useTranslation();
  if (matchStatus !== 'waiting' && matchStatus !== 'matched') return null;
  return (
    <Text variant="caption" className="text-zinc-500 mt-3 text-center">
      📍 {t('dash.hint.gate')}
    </Text>
  );
}

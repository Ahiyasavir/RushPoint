import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, ActivityIndicator, Pressable, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection } from 'firebase/firestore';
import { functions, db } from '../src/services/firebase.config';

const APP_ID = process.env.EXPO_PUBLIC_RUSHPOINT_APP_ID ?? 'race-to-tzion-2026';
import { useGameStore, type LiveSlot, type LiveJudging, type MatchStatus } from '../src/store/gameStore';
import { useGameSync } from '../src/hooks/useGameSync';
import { useAdaptiveLocation } from '../src/hooks/useAdaptiveLocation';
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
  green:  { completed: 'bg-neon-green',  active: 'bg-neon-green',  locked: 'bg-app-raised', skipped: 'bg-zinc-700' },
  gate:   { completed: 'bg-neon-blue',   active: 'bg-neon-blue',   locked: 'bg-app-raised', skipped: 'bg-zinc-700' },
  orange: { completed: 'bg-neon-orange', active: 'bg-neon-orange', locked: 'bg-app-raised', skipped: 'bg-zinc-700' },
  gold:   { completed: 'bg-neon-gold',   active: 'bg-neon-gold',   locked: 'bg-app-raised', skipped: 'bg-zinc-700' },
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
  const { show: showToast } = useToast();

  // Live Firestore mirror (drives score/slots) + offline notifications.
  useGameSync(teamId);
  useOfflineToast();
  // Battery-aware location pings (fast in transit, slow when stationary).
  useAdaptiveLocation(teamId);

  // Live flash-mission broadcast (admin-pushed), with local dismissal.
  const flashMission = useFlashMissions();
  const { visible: visibleFlash, dismiss: dismissFlash } = useDismissableFlash(flashMission);

  // Operational announcements (persistent marquee until dismissed per-device).
  const announcements = useAnnouncements();

  // Auto-request task assignment when a green slot becomes active without a taskId.
  // requestNextTask writes the result back to gameState (server-authoritative),
  // so useGameSync picks it up via onSnapshot — no local state needed.
  const activeSlotForAssignment = gameState?.slots.find((s) => s.status === 'active');
  const needsAssignment = activeSlotForAssignment?.type === 'green' && !activeSlotForAssignment?.taskId;
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

  const loading         = syncState === 'loading' && !gameState;
  const snapError       = syncState === 'error' && !gameState;
  const activeSlot      = gameState?.slots.find((s) => s.status === 'active') ?? null;
  const completedCount  = gameState?.slots.filter((s) => s.status === 'completed').length ?? 0;
  const score           = gameState?.score ?? 0;
  const penalty         = gameState?.bonusPenalty ?? 0;
  const effectiveScore  = Math.max(0, score - penalty);

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
              className="px-3 py-1.5 rounded-full border border-neon-green/30 bg-neon-green/10 active:bg-neon-green/20"
            >
              <Text variant="caption" className="text-neon-green font-mono">🗺  {t('map.open')}</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/sos')}
              hitSlop={8}
              className="px-3 py-1.5 rounded-full border border-neon-red/30 bg-neon-red/10 active:bg-neon-red/20"
            >
              <Text variant="caption" className="text-neon-red font-mono">🆘 {t('sos.open')}</Text>
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
            <Text variant="display" className="text-neon-green leading-tight font-brand" style={GLOW.green}>
              {effectiveScore}
            </Text>
            {penalty > 0 ? (
              <Text variant="caption" className="text-neon-red font-mono">−{penalty} {t('dash.penalty')}</Text>
            ) : (
              <Text variant="label" className="text-zinc-700">{t('dash.pts')}</Text>
            )}
          </View>
        </View>

        <Text variant="caption" className="text-zinc-600 mt-2">
          {t('dash.slotsCompleted', { n: completedCount })}
        </Text>
      </View>

      {/* ── Operational announcement (persistent, until dismissed) ────── */}
      <AnnouncementBanner announcements={announcements} />

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-6 pb-16"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="label" className="mb-4">{t('dash.currentMission')}</Text>

        {loading ? (
          <View className="py-10 items-center">
            <ActivityIndicator color="#00ffaa" />
          </View>
        ) : snapError ? (
          <Card className="p-6 items-center">
            <Text variant="bodySmall" className="text-red-400 text-center">
              {t('dash.loadError')}
            </Text>
          </Card>
        ) : activeSlot?.type === 'gate' ? (
          <GateCard matchStatus={gameState?.matchStatus} />
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
            className="mt-4 rounded-2xl border border-neon-orange/30 bg-neon-orange/5 p-4 active:opacity-70"
          >
            <Text variant="label" className="text-neon-orange">🧺 {t('basket.title')}</Text>
            <Text variant="bodySmall" className="text-zinc-500 mt-1">{t('basket.scanPrompt')}</Text>
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

      {/* Arrived at the judge → enter the pending queue for grading */}
      {!frozen && (slot.type === 'green' || slot.type === 'gold') && (
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
        className="py-2.5 rounded-xl bg-neon-green/10 border border-neon-green/30 items-center active:bg-neon-green/20"
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

// ─── Slot progress dot ────────────────────────────────────────────────────────

function SlotDot({ slot }: { slot: FirestoreSlot }) {
  const dotColor = DOT_COLOR[slot.type][slot.status];
  const sizeClass = slot.status === 'active' ? 'w-4 h-4' : 'w-2.5 h-2.5';
  const isActive = slot.status === 'active';
  return <View className={`${sizeClass} rounded-full ${dotColor} ${isActive ? 'animate-pulse-neon' : ''}`} />;
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

// ─── Gate card (matchmaking filter) ──────────────────────────────────────────

function GateCard({ matchStatus }: { matchStatus?: MatchStatus }) {
  const { t } = useTranslation();
  const [joining, setJoining]     = useState(false);
  const rejoinedAfterLoss = useRef(false);

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

  // After a loss the team must face a new opponent. Re-enter the queue once
  // (the server keeps them 'waiting'); reset the guard when they leave 'lost'.
  useEffect(() => {
    if (matchStatus === 'lost' && !rejoinedAfterLoss.current) {
      rejoinedAfterLoss.current = true;
      void handleJoin();
    } else if (matchStatus !== 'lost') {
      rejoinedAfterLoss.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchStatus]);

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
        <Text variant="bodySmall" className="text-neon-blue mb-2 animate-pulse-neon">{t('match.waiting')}</Text>
      ) : matchStatus === 'matched' ? (
        <Text variant="bodySmall" className="text-neon-blue">{t('match.matched', { opponent: '?' })}</Text>
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
          <Text variant="bodySmall" className="text-neon-blue text-center animate-pulse-neon">
            {t('match.rematchWaiting')}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

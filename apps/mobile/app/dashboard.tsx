import React, { useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useGameStore, completedCount, isGameComplete } from '../src/store/gameStore';
import type { SlotState } from '../src/store/gameStore';
import { SlotCard } from '../src/components/SlotCard';
import { ProgressBar } from '../src/components/ProgressBar';
import { useSlotSound } from '../src/hooks/useSlotSound';

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label, emoji, unlocked }: { label: string; emoji: string; unlocked: boolean }) {
  return (
    <View className="flex-row items-center gap-2 mb-3">
      <Text className="text-base">{emoji}</Text>
      <Text
        className={`text-xs font-bold uppercase tracking-[0.18em] ${
          unlocked ? 'text-zinc-300' : 'text-zinc-600'
        }`}
      >
        {label}
      </Text>
      {!unlocked && (
        <View className="px-2 py-0.5 rounded-full bg-zinc-800">
          <Text className="text-zinc-600 text-[10px] font-semibold tracking-wide">LOCKED</Text>
        </View>
      )}
    </View>
  );
}

// ─── Score counter ────────────────────────────────────────────────────────────

function ScoreDisplay({ score }: { score: number }) {
  const bump = useSharedValue(1);
  const prev = useRef(score);

  useEffect(() => {
    if (score !== prev.current) {
      prev.current = score;
      bump.value = withSequence(
        withSpring(1.25, { damping: 5, stiffness: 200 }),
        withSpring(1,    { damping: 10, stiffness: 150 }),
      );
    }
  }, [score]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));

  return (
    <Animated.View style={style}>
      <Text className="text-emerald-400 text-3xl font-black tabular-nums">{score}</Text>
      <Text className="text-zinc-600 text-xs font-semibold tracking-widest uppercase -mt-0.5">pts</Text>
    </Animated.View>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const insets     = useSafeAreaInsets();
  const { playUnlock } = useSlotSound();

  const teamName    = useGameStore((s) => s.teamName);
  const memberNames = useGameStore((s) => s.memberNames);
  const score       = useGameStore((s) => s.score);
  const slots       = useGameStore((s) => s.slots);
  const completeSlot = useGameStore((s) => s.completeSlot);
  const addScore     = useGameStore((s) => s.addScore);

  const done     = completedCount(slots);
  const finished = isGameComplete(slots);

  const greenSlots  = slots.slice(0, 4);
  const orangeSlot  = slots[4];
  const goldSlots   = slots.slice(5, 8);

  const orangeUnlocked = orangeSlot.status !== 'locked';
  const goldUnlocked   = goldSlots.some((s) => s.status !== 'locked');

  // DEV helper: tap a slot to complete it (replace with QR scan in Phase 2)
  async function handleSlotPress(slot: SlotState) {
    if (slot.status !== 'active') return;

    // Haptic feedback
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Play unlock sound for the NEXT slot's type before completing current
    await playUnlock(slot.type);

    // Complete the slot and award points
    completeSlot(slot.index, `Mission ${slot.index + 1}`);
    addScore(
      slot.type === 'green'  ? 100 :
      slot.type === 'orange' ? 150 : 200,
    );
  }

  return (
    <View className="flex-1 bg-app-bg">
      {/* ── Sticky Header ─────────────────────────────────────────────── */}
      <View
        className="bg-app-bg border-b border-zinc-800/60 px-5 pb-4"
        style={{ paddingTop: insets.top + 8 }}
      >
        {/* Team name + score */}
        <View className="flex-row items-start justify-between mb-4">
          <View className="flex-1 mr-4">
            <Text className="text-zinc-500 text-xs tracking-widest uppercase mb-0.5">Team</Text>
            <Text className="text-white text-2xl font-black leading-tight" numberOfLines={1}>
              {teamName}
            </Text>
            <Text className="text-zinc-600 text-xs mt-1" numberOfLines={1}>
              {memberNames.join(' · ')}
            </Text>
          </View>
          <ScoreDisplay score={score} />
        </View>

        {/* Progress bar */}
        <ProgressBar completed={done} />
      </View>

      {/* ── Scrollable Slot Board ──────────────────────────────────────── */}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-5 pb-10"
        showsVerticalScrollIndicator={false}
      >

        {/* ── GREEN: Open Field Missions (2×2 grid) ── */}
        <SectionHeader label="Open Field Missions" emoji="🌿" unlocked={true} />
        <View className="flex-row gap-3 mb-3">
          <SlotCard slot={greenSlots[0]} onPress={handleSlotPress} />
          <SlotCard slot={greenSlots[1]} onPress={handleSlotPress} />
        </View>
        <View className="flex-row gap-3 mb-6">
          <SlotCard slot={greenSlots[2]} onPress={handleSlotPress} />
          <SlotCard slot={greenSlots[3]} onPress={handleSlotPress} />
        </View>

        {/* Divider */}
        <View className="h-px bg-zinc-800 mb-6" />

        {/* ── ORANGE: Find the Tene ── */}
        <SectionHeader label="Find the Tene" emoji="🧺" unlocked={orangeUnlocked} />
        <View className="mb-6">
          <SlotCard slot={orangeSlot} onPress={handleSlotPress} fullWidth />
        </View>

        {/* Divider */}
        <View className="h-px bg-zinc-800 mb-6" />

        {/* ── GOLD: Fill the Basket (1×3 row) ── */}
        <SectionHeader label="Fill the Basket" emoji="✨" unlocked={goldUnlocked} />
        <View className="flex-row gap-3 mb-8">
          {goldSlots.map((slot) => (
            <SlotCard key={slot.index} slot={slot} onPress={handleSlotPress} />
          ))}
        </View>

        {/* ── ALL DONE: Final Run banner ── */}
        {finished && <FinalRunBanner />}

        {/* DEV note strip */}
        {__DEV__ && (
          <View className="mt-4 p-3 rounded-xl bg-zinc-800/50 border border-zinc-700">
            <Text className="text-zinc-500 text-xs text-center">
              DEV MODE — tap any active slot to complete it
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Final Run Banner ─────────────────────────────────────────────────────────

function FinalRunBanner() {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value    = withTiming(1,  { duration: 600 });
    translateY.value = withSpring(0, { damping: 12, stiffness: 80 });
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[style, { shadowColor: '#eab308', shadowOpacity: 0.5, shadowRadius: 20, elevation: 12 }]}
      className="rounded-2xl bg-amber-950 border-2 border-amber-400 p-5 items-center"
    >
      <Text className="text-3xl mb-2">🏁</Text>
      <Text className="text-amber-300 text-xl font-black tracking-tight text-center">
        All Slots Filled!
      </Text>
      <Text className="text-amber-500 text-sm mt-1 text-center leading-relaxed">
        The finish line location is now revealed.{'\n'}Run — every second counts!
      </Text>
    </Animated.View>
  );
}

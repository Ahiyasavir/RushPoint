import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import type { SlotState, SlotType } from '../store/gameStore';

// ─── Static class maps (must be fully spelled out for NativeWind to pick up) ──

const CARD_CLASSES: Record<SlotType, Record<string, string>> = {
  green: {
    locked:    'bg-zinc-900 border border-zinc-800',
    active:    'bg-emerald-950 border-2 border-emerald-500',
    completed: 'bg-emerald-950/60 border border-emerald-700',
  },
  orange: {
    locked:    'bg-zinc-900 border border-zinc-800',
    active:    'bg-orange-950 border-2 border-orange-500',
    completed: 'bg-orange-950/60 border border-orange-700',
  },
  gold: {
    locked:    'bg-zinc-900 border border-zinc-800',
    active:    'bg-amber-950 border-2 border-amber-400',
    completed: 'bg-amber-950/60 border border-amber-600',
  },
};

const LABEL_CLASSES: Record<SlotType, Record<string, string>> = {
  green:  { active: 'text-emerald-400', completed: 'text-emerald-300', locked: 'text-zinc-600' },
  orange: { active: 'text-orange-400',  completed: 'text-orange-300',  locked: 'text-zinc-600' },
  gold:   { active: 'text-amber-400',   completed: 'text-amber-300',   locked: 'text-zinc-600' },
};

const TYPE_LABELS: Record<SlotType, string> = {
  green:  'Open Field',
  orange: 'Find Tene',
  gold:   'Fill Basket',
};

// Native shadow values per type (can't do glow with pure Tailwind on RN)
const GLOW_SHADOW: Record<SlotType, object> = {
  green:  { shadowColor: '#22c55e', shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  orange: { shadowColor: '#f97316', shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  gold:   { shadowColor: '#eab308', shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  slot: SlotState;
  onPress?: (slot: SlotState) => void;
  /** Full-width card (used for the orange slot) */
  fullWidth?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SlotCard({ slot, onPress, fullWidth = false }: Props) {
  const { type, status, index, taskTitle } = slot;

  // Entry animation: card scales in when it becomes active
  const scale   = useSharedValue(status === 'locked' ? 0.94 : 1);
  const opacity = useSharedValue(status === 'locked' ? 0.45 : 1);

  // Border pulse for active slots
  const borderOpacity = useSharedValue(1);

  const prevStatus = useRef(status);

  useEffect(() => {
    const changed = prevStatus.current !== status;
    prevStatus.current = status;

    if (status === 'active') {
      if (changed) {
        // Unlock entry animation
        scale.value   = withSpring(1, { damping: 12, stiffness: 120 });
        opacity.value = withTiming(1, { duration: 350 });
      }
      // Subtle breathing pulse on border
      borderOpacity.value = withRepeat(
        withSequence(
          withTiming(1,    { duration: 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.35, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      );
    } else if (status === 'completed') {
      borderOpacity.value = withTiming(0.7, { duration: 300 });
      scale.value         = withSpring(1,   { damping: 10, stiffness: 100 });
      opacity.value       = withTiming(1,   { duration: 200 });
    } else {
      // locked
      scale.value         = withSpring(0.94);
      opacity.value       = withTiming(0.45, { duration: 200 });
      borderOpacity.value = withTiming(1,    { duration: 200 });
    }
  }, [status]);

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity:   opacity.value,
  }));

  const animatedBorderStyle = useAnimatedStyle(() => ({
    opacity: borderOpacity.value,
  }));

  const cardClass  = CARD_CLASSES[type][status];
  const labelClass = LABEL_CLASSES[type][status];
  const glowStyle  = status !== 'locked' ? GLOW_SHADOW[type] : {};
  const sizeClass  = fullWidth ? 'w-full' : 'flex-1';

  return (
    <Pressable
      onPress={() => onPress?.(slot)}
      disabled={status === 'locked'}
      className={`${sizeClass}`}
    >
      <Animated.View
        style={[animatedCardStyle, glowStyle]}
        className={`rounded-2xl p-4 min-h-[110px] justify-between ${cardClass}`}
      >
        {/* Top row: status dot + slot number */}
        <View className="flex-row items-center justify-between">
          <Animated.View style={animatedBorderStyle}>
            <StatusDot type={type} status={status} />
          </Animated.View>
          <Text className="text-zinc-600 text-xs font-mono">
            {String(index + 1).padStart(2, '0')}
          </Text>
        </View>

        {/* Centre: task title or placeholder */}
        <View className="mt-2">
          {status === 'completed' && taskTitle ? (
            <Text className={`text-sm font-semibold leading-tight ${labelClass}`} numberOfLines={2}>
              {taskTitle}
            </Text>
          ) : status === 'active' ? (
            <Text className={`text-sm font-semibold ${labelClass}`}>Active</Text>
          ) : (
            <Text className="text-zinc-700 text-sm">Locked</Text>
          )}
        </View>

        {/* Bottom: type label + checkmark */}
        <View className="flex-row items-center justify-between mt-3">
          <Text className={`text-[10px] tracking-widest uppercase font-semibold ${labelClass}`}>
            {TYPE_LABELS[type]}
          </Text>
          {status === 'completed' && (
            <Text className={`text-base font-bold ${labelClass}`}>✓</Text>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

function StatusDot({ type, status }: { type: SlotType; status: string }) {
  const dotClass =
    status === 'completed' ? (
      type === 'green'  ? 'bg-emerald-500' :
      type === 'orange' ? 'bg-orange-500'  : 'bg-amber-400'
    ) : status === 'active' ? (
      type === 'green'  ? 'bg-emerald-500' :
      type === 'orange' ? 'bg-orange-500'  : 'bg-amber-400'
    ) : 'bg-zinc-700';

  return <View className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />;
}

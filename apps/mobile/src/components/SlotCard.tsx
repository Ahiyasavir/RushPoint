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
    locked:    'border border-white/5',
    active:    'border-2 border-neon-green/60',
    completed: 'border border-neon-green/20',
  },
  gate: {
    locked:    'border border-white/5',
    active:    'border-2 border-neon-blue/60',
    completed: 'border border-neon-blue/20',
  },
  orange: {
    locked:    'border border-white/5',
    active:    'border-2 border-neon-orange/60',
    completed: 'border border-neon-orange/20',
  },
  gold: {
    locked:    'border border-white/5',
    active:    'border-2 border-neon-gold/60',
    completed: 'border border-neon-gold/20',
  },
};

const LABEL_CLASSES: Record<SlotType, Record<string, string>> = {
  green:  { active: 'text-neon-green',  completed: 'text-neon-green/70',  locked: 'text-zinc-700' },
  gate:   { active: 'text-neon-blue',   completed: 'text-neon-blue/70',   locked: 'text-zinc-700' },
  orange: { active: 'text-neon-orange', completed: 'text-neon-orange/70', locked: 'text-zinc-700' },
  gold:   { active: 'text-neon-gold',   completed: 'text-neon-gold/70',   locked: 'text-zinc-700' },
};

const TYPE_LABELS: Record<SlotType, string> = {
  green:  'Open Field',
  gate:   'Gate Filter',
  orange: 'Find Tene',
  gold:   'Craft & Judge',
};

// Native shadow values per type (can't do glow with pure Tailwind on RN)
const GLOW_SHADOW: Record<SlotType, object> = {
  green:  { shadowColor: '#00ffaa', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  gate:   { shadowColor: '#00aaff', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  orange: { shadowColor: '#ff6b00', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  gold:   { shadowColor: '#ffd700', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
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
  const opacity = useSharedValue(status === 'locked' ? 0.35 : 1);

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
          withTiming(1,    { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3,  { duration: 1200, easing: Easing.inOut(Easing.ease) }),
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
      opacity.value       = withTiming(0.35, { duration: 200 });
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
  const glowStyle  = status === 'active' ? GLOW_SHADOW[type] : {};
  const sizeClass  = fullWidth ? 'w-full' : 'flex-1';

  return (
    <Pressable
      onPress={() => onPress?.(slot)}
      disabled={status === 'locked'}
      className={`${sizeClass}`}
    >
      <Animated.View
        style={[
          animatedCardStyle,
          glowStyle,
          { backgroundColor: status === 'locked' ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)' },
        ]}
        className={`rounded-2xl p-4 min-h-[110px] justify-between ${cardClass}`}
      >
        {/* Top row: status dot + slot number */}
        <View className="flex-row items-center justify-between">
          <Animated.View style={animatedBorderStyle}>
            <StatusDot type={type} status={status} />
          </Animated.View>
          <Text className="text-zinc-600 text-xs font-mono tracking-wider">
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
            <Text className={`text-sm font-bold ${labelClass}`}>Active</Text>
          ) : (
            <Text className="text-zinc-700 text-sm">Locked</Text>
          )}
        </View>

        {/* Bottom: type label + checkmark */}
        <View className="flex-row items-center justify-between mt-3">
          <Text className={`text-[10px] tracking-[0.2em] uppercase font-bold ${labelClass}`}>
            {TYPE_LABELS[type]}
          </Text>
          {status === 'completed' && (
            <View className="w-5 h-5 rounded-full bg-neon-green/20 items-center justify-center">
              <Text className="text-neon-green text-[10px] font-bold">✓</Text>
            </View>
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
      type === 'green'  ? 'bg-neon-green' :
      type === 'gate'   ? 'bg-neon-blue' :
      type === 'orange' ? 'bg-neon-orange' : 'bg-neon-gold'
    ) : status === 'active' ? (
      type === 'green'  ? 'bg-neon-green' :
      type === 'gate'   ? 'bg-neon-blue' :
      type === 'orange' ? 'bg-neon-orange' : 'bg-neon-gold'
    ) : 'bg-zinc-700/50';

  return <View className={`w-2.5 h-2.5 rounded-full ${dotClass}`} />;
}

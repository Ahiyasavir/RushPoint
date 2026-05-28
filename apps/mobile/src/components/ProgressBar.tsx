import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

interface Props {
  completed: number; // 0–8
  total?: number;
}

export function ProgressBar({ completed, total = 8 }: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(completed / total, { damping: 14, stiffness: 80 });
  }, [completed, total]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <View className="w-full">
      <View className="flex-row justify-between mb-2">
        <Text className="text-zinc-500 text-xs font-bold tracking-[0.15em] uppercase">
          Progress
        </Text>
        <Text className="text-zinc-300 text-xs font-bold tabular-nums">
          {completed}/{total} slots
        </Text>
      </View>

      {/* Track */}
      <View className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
        {/* Fill */}
        <Animated.View
          style={[
            barStyle,
            { shadowColor: '#00ffaa', shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
          ]}
          className="h-full rounded-full bg-neon-green"
        />
      </View>

      {/* Slot pips */}
      <View className="flex-row justify-between mt-2.5">
        {Array.from({ length: total }).map((_, i) => {
          const done = i < completed;
          const isGreen  = i < 4;
          const isOrange = i === 4;

          const dotColor = done
            ? isGreen  ? 'bg-neon-green'
            : isOrange ? 'bg-neon-orange'
            : 'bg-neon-gold'
            : 'bg-white/10';

          return (
            <View
              key={i}
              className={`w-2.5 h-2.5 rounded-full ${dotColor}`}
            />
          );
        })}
      </View>
    </View>
  );
}

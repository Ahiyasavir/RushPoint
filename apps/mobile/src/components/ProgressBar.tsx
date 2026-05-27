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
      <View className="flex-row justify-between mb-1.5">
        <Text className="text-zinc-400 text-xs font-semibold tracking-widest uppercase">
          Progress
        </Text>
        <Text className="text-zinc-300 text-xs font-bold">
          {completed}/{total} slots
        </Text>
      </View>

      {/* Track */}
      <View className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
        {/* Fill — gradient via inline shadow trick */}
        <Animated.View
          style={barStyle}
          className="h-full rounded-full bg-emerald-500"
        />
      </View>

      {/* Slot pips */}
      <View className="flex-row justify-between mt-2">
        {Array.from({ length: total }).map((_, i) => {
          const done = i < completed;
          const isGreen  = i < 4;
          const isOrange = i === 4;

          const dotColor = done
            ? isGreen  ? 'bg-emerald-500'
            : isOrange ? 'bg-orange-500'
            : 'bg-amber-400'
            : 'bg-zinc-700';

          return (
            <View
              key={i}
              className={`w-2 h-2 rounded-full ${dotColor}`}
            />
          );
        })}
      </View>
    </View>
  );
}

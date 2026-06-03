import React from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps {
  children: React.ReactNode;
  disabled?: boolean;
  /** Scale target while pressed (subtle by default). */
  scaleTo?: number;
  className?: string;
}

/**
 * Additive tactile-feedback wrapper: dips its child's scale/opacity on press-in
 * and springs back on release. It owns no onPress — the wrapped control keeps its
 * own handler — so it layers feedback without changing any behaviour.
 */
export function PressableScale({
  children,
  disabled = false,
  scaleTo = 0.96,
  className,
}: PressableScaleProps) {
  const pressed = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }],
    opacity: 1 - pressed.value * 0.12,
  }));

  return (
    <AnimatedPressable
      disabled={disabled}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.quad) });
      }}
      style={animStyle}
      className={className}
    >
      {children}
    </AnimatedPressable>
  );
}

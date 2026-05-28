import React from 'react';
import { View, Text } from 'react-native';

export interface BadgeProps {
  label: string;
  variant: 'green' | 'orange' | 'gold' | 'neutral' | 'error' | 'info';
  size?: 'sm' | 'md';
}

// Static class maps — NativeWind requires fully-spelled-out strings.
const VARIANT_BG_CLASSES = {
  green:   'bg-neon-green/10 border border-neon-green/30',
  orange:  'bg-neon-orange/10 border border-neon-orange/30',
  gold:    'bg-neon-gold/10 border border-neon-gold/30',
  neutral: 'bg-white/5 border border-white/10',
  error:   'bg-red-500/10 border border-red-500/30',
  info:    'bg-neon-blue/10 border border-neon-blue/30',
} as const;

const VARIANT_TEXT_CLASSES = {
  green:   'text-neon-green',
  orange:  'text-neon-orange',
  gold:    'text-neon-gold',
  neutral: 'text-zinc-400',
  error:   'text-red-400',
  info:    'text-neon-blue',
} as const;

const SIZE_CLASSES = {
  sm: 'px-2.5 py-0.5',
  md: 'px-3 py-1',
} as const;

const SIZE_TEXT_CLASSES = {
  sm: 'text-[10px]',
  md: 'text-xs',
} as const;

export function Badge({ label, variant, size = 'md' }: BadgeProps) {
  return (
    <View className={`rounded-full self-start ${SIZE_CLASSES[size]} ${VARIANT_BG_CLASSES[variant]}`}>
      <Text className={`font-bold tracking-wider ${SIZE_TEXT_CLASSES[size]} ${VARIANT_TEXT_CLASSES[variant]}`}>
        {label}
      </Text>
    </View>
  );
}

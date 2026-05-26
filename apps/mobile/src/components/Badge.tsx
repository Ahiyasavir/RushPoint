import React from 'react';
import { View, Text } from 'react-native';

export interface BadgeProps {
  label: string;
  variant: 'green' | 'orange' | 'gold' | 'neutral' | 'error' | 'info';
  size?: 'sm' | 'md';
}

// Static class maps — NativeWind requires fully-spelled-out strings.
const VARIANT_BG_CLASSES = {
  green:   'bg-emerald-950 border border-emerald-800',
  orange:  'bg-orange-950 border border-orange-800',
  gold:    'bg-amber-950 border border-amber-800',
  neutral: 'bg-zinc-800 border border-zinc-700',
  error:   'bg-red-950 border border-red-800',
  info:    'bg-blue-950 border border-blue-800',
} as const;

const VARIANT_TEXT_CLASSES = {
  green:   'text-emerald-400',
  orange:  'text-orange-400',
  gold:    'text-amber-400',
  neutral: 'text-zinc-400',
  error:   'text-red-400',
  info:    'text-blue-400',
} as const;

const SIZE_CLASSES = {
  sm: 'px-2 py-0.5',
  md: 'px-2.5 py-1',
} as const;

const SIZE_TEXT_CLASSES = {
  sm: 'text-[10px]',
  md: 'text-xs',
} as const;

export function Badge({ label, variant, size = 'md' }: BadgeProps) {
  return (
    <View className={`rounded-full self-start ${SIZE_CLASSES[size]} ${VARIANT_BG_CLASSES[variant]}`}>
      <Text className={`font-semibold ${SIZE_TEXT_CLASSES[size]} ${VARIANT_TEXT_CLASSES[variant]}`}>
        {label}
      </Text>
    </View>
  );
}

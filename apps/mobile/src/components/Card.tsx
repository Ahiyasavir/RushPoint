import React from 'react';
import { View, Pressable } from 'react-native';
import { GLOW } from './tokens';

export interface CardProps {
  children: React.ReactNode;
  /** Applies a coloured native shadow glow (default: 'none'). */
  glowColor?: 'green' | 'orange' | 'gold' | 'none';
  /** Extra NativeWind classes for layout overrides (padding, margin, width). */
  className?: string;
  /** Makes the card pressable — renders as Pressable instead of View. */
  onPress?: () => void;
}

const BASE_CLASS = 'bg-zinc-900 rounded-2xl border border-zinc-800';

export function Card({ children, glowColor = 'none', className = '', onPress }: CardProps) {
  const glowStyle = glowColor !== 'none' ? GLOW[glowColor] : {};
  const classes   = `${BASE_CLASS} ${className}`;

  if (onPress) {
    return (
      <Pressable style={glowStyle} className={classes} onPress={onPress}>
        {children}
      </Pressable>
    );
  }

  return (
    <View style={glowStyle} className={classes}>
      {children}
    </View>
  );
}

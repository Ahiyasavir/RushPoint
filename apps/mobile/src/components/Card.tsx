import React from 'react';
import { View, Pressable, ViewStyle } from 'react-native';
import { GLOW, GLASS } from './tokens';

export interface CardProps {
  children: React.ReactNode;
  /** Applies a coloured native shadow glow (default: 'none'). */
  glowColor?: 'green' | 'orange' | 'gold' | 'blue' | 'none';
  /** Extra NativeWind classes for layout overrides (padding, margin, width). */
  className?: string;
  /** Makes the card pressable — renders as Pressable instead of View. */
  onPress?: () => void;
  /** Additional native style overrides (e.g. custom border color). */
  style?: ViewStyle;
}

const BASE_CLASS = 'rounded-2xl overflow-hidden';

export function Card({ children, glowColor = 'none', className = '', onPress, style }: CardProps) {
  const glowStyle = glowColor !== 'none' ? GLOW[glowColor] : {};
  const classes   = `${BASE_CLASS} ${className}`;

  const surfaceStyle = {
    ...GLASS,
    ...glowStyle,
    ...style,
  };

  if (onPress) {
    return (
      <Pressable style={surfaceStyle} className={classes} onPress={onPress}>
        {children}
      </Pressable>
    );
  }

  return (
    <View style={surfaceStyle} className={classes}>
      {children}
    </View>
  );
}

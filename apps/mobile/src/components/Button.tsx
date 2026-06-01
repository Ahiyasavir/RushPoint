import React, { useState } from 'react';
import { Pressable, ActivityIndicator, Text } from 'react-native';
import { GLOW } from './tokens';

export interface ButtonProps {
  children: React.ReactNode;
  /** May be async — component manages loading state internally. */
  onPress: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** Caller-controlled loading state (e.g. while awaiting a network call). */
  loading?: boolean;
  fullWidth?: boolean;
}

// Static class maps — NativeWind requires fully-spelled-out strings.
const SIZE_CLASSES = {
  sm: 'px-4 py-2.5',
  md: 'px-6 py-3.5',
  lg: 'px-8 py-4.5',
} as const;

const SIZE_TEXT_CLASSES = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
} as const;

const VARIANT_CLASSES = {
  primary:   'bg-neon-green active:bg-neon-cyan',
  secondary: 'bg-transparent border border-zinc-600/50 active:bg-white/5',
  ghost:     'bg-transparent active:bg-white/5',
  danger:    'bg-red-600 active:bg-red-700',
} as const;

const VARIANT_TEXT_CLASSES = {
  primary:   'text-black',
  secondary: 'text-zinc-200',
  ghost:     'text-neon-green',
  danger:    'text-white',
} as const;

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
}: ButtonProps) {
  const [internalLoading, setInternalLoading] = useState(false);

  const isLoading  = loading || internalLoading;
  const isDisabled = disabled || isLoading;

  async function handlePress() {
    if (isDisabled) return;
    const result = onPress();
    if (result instanceof Promise) {
      setInternalLoading(true);
      try {
        await result;
      } finally {
        setInternalLoading(false);
      }
    }
  }

  const glowStyle = variant === 'primary' && !isDisabled ? GLOW.cta : {};

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      style={glowStyle}
      className={[
        'items-center justify-center flex-row rounded-2xl',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        fullWidth ? 'w-full' : '',
        isDisabled ? 'opacity-40' : '',
      ].join(' ')}
    >
      {isLoading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'ghost' ? '#39FF14' : variant === 'primary' ? '#000000' : '#ffffff'}
        />
      ) : (
        <Text
          className={`font-bold tracking-wide ${SIZE_TEXT_CLASSES[size]} ${VARIANT_TEXT_CLASSES[variant]}`}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
}

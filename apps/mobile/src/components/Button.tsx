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
  sm: 'px-3 py-2',
  md: 'px-5 py-3',
  lg: 'px-6 py-4',
} as const;

const SIZE_TEXT_CLASSES = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
} as const;

const VARIANT_CLASSES = {
  primary:   'bg-emerald-500 active:bg-emerald-600',
  secondary: 'bg-transparent border border-zinc-600 active:bg-zinc-800',
  ghost:     'bg-transparent active:bg-zinc-900',
  danger:    'bg-red-600 active:bg-red-700',
} as const;

const VARIANT_TEXT_CLASSES = {
  primary:   'text-white',
  secondary: 'text-zinc-300',
  ghost:     'text-emerald-400',
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
        'items-center justify-center flex-row rounded-xl',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        fullWidth ? 'w-full' : '',
        isDisabled ? 'opacity-50' : '',
      ].join(' ')}
    >
      {isLoading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'ghost' ? '#34d399' : '#ffffff'}
        />
      ) : (
        <Text
          className={`font-semibold ${SIZE_TEXT_CLASSES[size]} ${VARIANT_TEXT_CLASSES[variant]}`}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
}

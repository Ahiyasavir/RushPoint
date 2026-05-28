import React from 'react';
import { View, TextInput, Text, type TextInputProps } from 'react-native';

export interface InputProps extends Omit<TextInputProps, 'className'> {
  /** Field label rendered above the input. */
  label?: string;
  /** Inline validation error rendered below the input. */
  error?: string;
  /** Extra NativeWind classes for outer container (margin, width). */
  className?: string;
}

export function Input({ label, error, className = '', ...rest }: InputProps) {
  const borderClass = error
    ? 'border-red-500/60'
    : 'border-white/10';

  return (
    <View className={className}>
      {label ? (
        <Text className="text-zinc-400 text-xs font-bold uppercase tracking-[0.15em] mb-2">
          {label}
        </Text>
      ) : null}

      <TextInput
        placeholderTextColor="#3f3f46"
        className={`bg-white/[0.03] border ${borderClass} rounded-2xl px-4 py-3.5 text-white text-base`}
        {...rest}
      />

      {error ? (
        <Text className="text-red-400 text-xs font-medium mt-1.5">{error}</Text>
      ) : null}
    </View>
  );
}

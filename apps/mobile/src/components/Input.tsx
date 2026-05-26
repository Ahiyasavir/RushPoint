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
  const borderClass = error ? 'border-red-600' : 'border-zinc-700';

  return (
    <View className={className}>
      {label ? (
        <Text className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-2">
          {label}
        </Text>
      ) : null}

      <TextInput
        placeholderTextColor="#52525b"
        className={`bg-zinc-900 border ${borderClass} rounded-xl px-4 py-3.5 text-white text-base`}
        {...rest}
      />

      {error ? (
        <Text className="text-red-400 text-xs mt-1.5">{error}</Text>
      ) : null}
    </View>
  );
}

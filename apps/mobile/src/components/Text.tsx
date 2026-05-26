import React from 'react';
import { Text as RNText, type TextProps } from 'react-native';

export type TextVariant =
  | 'display'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodySmall'
  | 'label'
  | 'caption'
  | 'mono';

// Static class map — must be fully spelled out for NativeWind to pick up at build time.
const VARIANT_CLASSES: Record<TextVariant, string> = {
  display:    'text-4xl font-black tracking-tight text-white',
  heading:    'text-2xl font-bold text-white',
  subheading: 'text-lg font-semibold text-white',
  body:       'text-base font-normal leading-relaxed text-white',
  bodySmall:  'text-sm font-normal text-white',
  label:      'text-xs font-semibold uppercase tracking-widest text-zinc-400',
  caption:    'text-[10px] font-medium text-zinc-400',
  mono:       'text-sm font-mono text-white',
};

interface Props extends TextProps {
  variant?: TextVariant;
  /** Additional NativeWind classes — use to override colour or layout only. */
  className?: string;
  children: React.ReactNode;
}

export function Text({ variant = 'body', className = '', children, ...rest }: Props) {
  return (
    <RNText className={`${VARIANT_CLASSES[variant]} ${className}`} {...rest}>
      {children}
    </RNText>
  );
}

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
  heading:    'text-2xl font-bold tracking-tight text-white',
  subheading: 'text-lg font-semibold text-white',
  body:       'text-base font-normal leading-relaxed text-zinc-200',
  bodySmall:  'text-sm font-normal text-zinc-300',
  label:      'text-xs font-bold uppercase tracking-[0.15em] text-zinc-400',
  caption:    'text-[10px] font-semibold tracking-wider text-zinc-500',
  mono:       'text-sm font-mono text-white tracking-wide',
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

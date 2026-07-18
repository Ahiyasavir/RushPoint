import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { C, FONT, FIRE_GRAD } from '../lib/theme';

const fireText: React.CSSProperties = {
  background: FIRE_GRAD,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  color: 'transparent',
};

// Word-by-word kinetic line. Words wrapped in *asterisks* render in the fire gradient.
export const KineticLine: React.FC<{
  text: string;
  size?: number;
  weight?: number;
  startAt?: number;
  stagger?: number;
  color?: string;
  align?: 'center' | 'flex-start' | 'flex-end';
  lineHeight?: number;
}> = ({ text, size = 96, weight = 900, startAt = 0, stagger = 3, color = C.ink1, align = 'center', lineHeight = 1.06 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Parse *…* accent spans (multi-word aware). Odd segments between '*' are accented.
  const words: { w: string; accent: boolean }[] = [];
  text.split('*').forEach((seg, idx) => {
    const accent = idx % 2 === 1;
    seg.split(' ').forEach((w) => {
      if (w.length) words.push({ w, accent });
    });
  });
  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
    <div
      dir="rtl"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: `${size * 0.04}px ${size * 0.22}px`,
        justifyContent: align,
        fontFamily: FONT.display,
        fontWeight: weight,
        fontSize: size,
        lineHeight,
        color,
        maxWidth: '92%',
      }}
    >
      {words.map(({ w: clean, accent }, i) => {
        const local = frame - startAt - i * stagger;
        const s = spring({ frame: local, fps, config: { damping: 14, stiffness: 140, mass: 0.6 } });
        const y = interpolate(s, [0, 1], [size * 0.5, 0]);
        const blur = interpolate(s, [0, 1], [12, 0]);
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: s,
              transform: `translateY(${y}px)`,
              filter: `blur(${blur}px)`,
              ...(accent ? fireText : null),
            }}
          >
            {clean}
          </span>
        );
      })}
    </div>
    </div>
  );
};

// Small eyebrow / label chip
export const Eyebrow: React.FC<{ text: string; startAt?: number; color?: string }> = ({ text, startAt = 0, color = C.fire }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - startAt, fps, config: { damping: 16, stiffness: 120 } });
  return (
    <div
      dir="rtl"
      style={{
        opacity: s,
        transform: `translateY(${interpolate(s, [0, 1], [16, 0])}px)`,
        fontFamily: FONT.body,
        fontWeight: 800,
        fontSize: 26,
        letterSpacing: 4,
        color,
        textTransform: 'uppercase',
      }}
    >
      {text}
    </div>
  );
};

// Sequential caption swap (one label at a time), fire accent bar
export const CaptionStack: React.FC<{
  items: { text: string; at: number; dur: number }[];
  size?: number;
  width?: number;
}> = ({ items, size = 64, width = 1400 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: 'relative', height: size * 1.7, width, margin: '0 auto' }}>
      {items.map((it, i) => {
        const local = frame - it.at;
        if (local < -6 || local > it.dur + 10) return null;
        const inS = spring({ frame: local, fps, config: { damping: 15, stiffness: 130 } });
        const out = interpolate(local, [it.dur, it.dur + 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const op = inS * out;
        const y = interpolate(inS, [0, 1], [30, 0]) + interpolate(local, [it.dur, it.dur + 8], [0, -20], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div
            key={i}
            dir="rtl"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 20,
              opacity: op,
              transform: `translateY(${y}px)`,
            }}
          >
            <div style={{ width: 10, height: size * 0.9, borderRadius: 6, background: FIRE_GRAD, flexShrink: 0 }} />
            <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: size, color: C.ink1, whiteSpace: 'nowrap' }}>{it.text}</span>
          </div>
        );
      })}
    </div>
  );
};

export const fireTextStyle = fireText;

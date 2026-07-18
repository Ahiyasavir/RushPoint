import React from 'react';
import { C, FONT } from '../lib/theme';

// Compass-needle mark — reproduced from apps/play-web/public/icon.svg
export const LogoMark: React.FC<{ size?: number; spin?: number }> = ({ size = 120, spin = 0 }) => (
  <svg width={size} height={size} viewBox="0 0 512 512" style={{ display: 'block' }}>
    <defs>
      <linearGradient id="lbg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FCA855" />
        <stop offset="0.45" stopColor="#F97316" />
        <stop offset="1" stopColor="#DC4F08" />
      </linearGradient>
      <radialGradient id="lgloss" cx="256" cy="150" r="300" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.35" />
        <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.06" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="lneedle" x1="256" y1="120" x2="256" y2="392" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#FFE3C2" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="112" fill="url(#lbg)" />
    <rect width="512" height="512" rx="112" fill="url(#lgloss)" />
    <circle cx="256" cy="256" r="132" fill="none" stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="10" />
    <path d="M 256 124 A 132 132 0 0 1 388 256" fill="none" stroke="#22D3EE" strokeWidth="10" strokeLinecap="round" />
    <g transform={`rotate(${38 + spin} 256 256)`}>
      <path d="M256 132 L286 256 L256 286 L226 256 Z" fill="url(#lneedle)" />
      <path d="M256 380 L286 256 L256 286 L226 256 Z" fill="#0B0F17" fillOpacity="0.35" />
    </g>
    <circle cx="256" cy="256" r="20" fill="#0B0F17" />
    <circle cx="256" cy="256" r="9" fill="#22D3EE" />
  </svg>
);

export const Wordmark: React.FC<{ size?: number; color?: string }> = ({ size = 44, color = C.ink1 }) => (
  <span
    style={{
      fontFamily: FONT.display,
      fontWeight: 800,
      fontSize: size,
      letterSpacing: size * 0.01,
      color,
      lineHeight: 1,
    }}
  >
    Rush<span style={{ color: C.fire }}>Point</span>
  </span>
);

export const Lockup: React.FC<{ markSize?: number; textSize?: number; color?: string; gap?: number }> = ({
  markSize = 84,
  textSize = 52,
  color,
  gap = 22,
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap, direction: 'ltr' }}>
    <LogoMark size={markSize} />
    <Wordmark size={textSize} color={color} />
  </div>
);

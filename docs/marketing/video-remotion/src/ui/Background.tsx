import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';
import { C } from '../lib/theme';

// Ambient dark background — mirrors creator-web mesh blobs + fine grid.
export const DarkBackground: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const drift = Math.sin(f / 40) * 20;
  const p1 = interpolate(Math.sin(f / 36), [-1, 1], [0.55, 1]);
  const p2 = interpolate(Math.sin(f / 48 + 1), [-1, 1], [0.65, 1]);
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg0, overflow: 'hidden' }}>
      {/* fine grid */}
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '54px 54px',
          maskImage: 'radial-gradient(ellipse 90% 75% at 50% 0%, #000 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 75% at 50% 0%, #000 0%, transparent 75%)',
        }}
      />
      {/* fire glow top */}
      <div
        style={{
          position: 'absolute',
          width: 1200,
          height: 1200,
          top: -560 + drift,
          right: -260,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(255,87,34,${0.22 * p1}) 0%, transparent 62%)`,
          filter: 'blur(40px)',
        }}
      />
      {/* purple glow bottom-left */}
      <div
        style={{
          position: 'absolute',
          width: 1000,
          height: 1000,
          bottom: -420,
          left: -300 - drift,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(124,58,237,${0.18 * p2}) 0%, transparent 62%)`,
          filter: 'blur(48px)',
        }}
      />
      {/* cyan accent center */}
      <div
        style={{
          position: 'absolute',
          width: 760,
          height: 760,
          top: '38%',
          left: '34%',
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(6,182,212,${0.10 * p1}) 0%, transparent 62%)`,
          filter: 'blur(48px)',
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

// Warm light background — mirrors play-web "Warm Trail".
export const WarmBackground: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(160deg,#FFF4E6 0%,#FFFCF7 60%)', overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          backgroundImage: 'radial-gradient(rgba(90,70,45,0.10) 1.5px, transparent 1.5px)',
          backgroundSize: '22px 22px',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 900,
          top: -360,
          right: -220,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,87,34,0.14) 0%, transparent 62%)',
          filter: 'blur(48px)',
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

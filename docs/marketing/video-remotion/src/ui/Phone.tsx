import React from 'react';
import { C, FONT } from '../lib/theme';

// Realistic phone frame holding a 390x844-ish screen (scaled).
export const PhoneFrame: React.FC<{ children: React.ReactNode; scale?: number; statusColor?: string }> = ({
  children,
  scale = 1,
  statusColor = C.warmInk,
}) => {
  const W = 390;
  const Hh = 844;
  return (
    <div
      style={{
        width: W,
        height: Hh,
        transform: `scale(${scale})`,
        borderRadius: 58,
        background: '#0A0A0C',
        padding: 12,
        boxShadow: '0 40px 120px -30px rgba(0,0,0,0.7), 0 0 0 2px rgba(255,255,255,0.06)',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 47,
          overflow: 'hidden',
          position: 'relative',
          background: C.warmBg,
        }}
      >
        {/* status bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 54,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 30px',
            zIndex: 50,
            fontFamily: FONT.body,
            fontWeight: 700,
            fontSize: 16,
            color: statusColor,
          }}
        >
          <span>9:41</span>
          <span style={{ letterSpacing: 2 }}>● ● ●</span>
        </div>
        {/* notch */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 130,
            height: 30,
            borderRadius: 18,
            background: '#0A0A0C',
            zIndex: 60,
          }}
        />
        {children}
      </div>
    </div>
  );
};

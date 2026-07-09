import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { C, FONT, FIRE_GRAD } from '../../lib/theme';

// play-web Final / winner screen inside a PhoneFrame (light warm).
export const FinalScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const trophy = spring({ frame: frame - 8, fps, config: { damping: 10, stiffness: 120 } });
  const score = Math.round(interpolate(frame, [20, 70], [0, 892], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const rowIn = (i: number) => spring({ frame: frame - 40 - i * 8, fps, config: { damping: 16 } });

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(165deg,#FFE9D2 0%,#FFFCF7 55%)', paddingTop: 96, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ fontSize: 120, transform: `scale(${trophy}) rotate(${interpolate(trophy, [0, 1], [-30, 0])}deg)` }}>🏆</div>
      <div dir="rtl" style={{ fontFamily: FONT.display, fontWeight: 900, fontSize: 40, color: C.warmInk, marginTop: 6 }}>מקום ראשון!</div>
      <div dir="rtl" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <span style={{ fontSize: 30 }}>🐯</span>
        <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 26, color: C.fire }}>הנמרים הכתומים</span>
      </div>
      <div
        style={{
          marginTop: 22,
          padding: '10px 40px',
          borderRadius: 20,
          background: FIRE_GRAD,
          fontFamily: FONT.mono,
          fontWeight: 700,
          fontSize: 52,
          color: '#fff',
          boxShadow: '0 16px 40px -12px rgba(255,87,34,0.6)',
        }}
      >
        {score}
      </div>
      <div dir="rtl" style={{ fontFamily: FONT.body, fontSize: 17, color: C.warmInk2, marginTop: 8 }}>נקודות</div>

      {/* mini standings */}
      <div style={{ marginTop: 30, width: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          ['2', '🦅', 'הנשרים הכחולים', '831'],
          ['3', '⚡', 'ברקים ירוקים', '804'],
        ].map((r, i) => (
          <div key={i} dir="rtl" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: '#fff', boxShadow: '0 6px 18px -10px rgba(0,0,0,0.2)', opacity: rowIn(i), transform: `translateY(${interpolate(rowIn(i), [0, 1], [20, 0])}px)` }}>
            <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 20, color: C.warmInk2, width: 22 }}>{r[0]}</span>
            <span style={{ fontSize: 24 }}>{r[1]}</span>
            <span style={{ flex: 1, fontFamily: FONT.body, fontWeight: 700, fontSize: 19, color: C.warmInk }}>{r[2]}</span>
            <span style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 20, color: C.warmInk }}>{r[3]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { C, FONT, FIRE_GRAD } from '../../lib/theme';
import { MapCanvas } from './MapCanvas';

const route = [
  { x: 160, y: 560 },
  { x: 300, y: 470 },
  { x: 430, y: 500 },
  { x: 560, y: 360 },
  { x: 700, y: 300 },
  { x: 780, y: 180 },
];

// play-web in-run map + next-task card, inside a PhoneFrame.
export const PlayMapScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const routeProg = interpolate(frame, [10, 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const markerT = interpolate(frame, [30, 150], [0, 0.72], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cardIn = spring({ frame: frame - 24, fps, config: { damping: 16 } });
  const dist = Math.round(interpolate(frame, [30, 150], [420, 90], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));

  return (
    <div style={{ position: 'absolute', inset: 0, background: C.warmBg }}>
      {/* map fills */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 620 }}>
        <MapCanvas
          theme="light"
          route={route}
          routeProgress={routeProg}
          marker={markerT}
          pins={[{ p: { x: 780, y: 180 }, kind: 'active' }]}
        />
      </div>

      {/* top pill: stage + progress */}
      <div dir="rtl" style={{ position: 'absolute', top: 66, left: 20, right: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderRadius: 16, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', boxShadow: '0 8px 24px -10px rgba(0,0,0,0.2)' }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 19, color: C.warmInk }}>שלב 2 · שוק העיר</div>
        <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 18, color: C.fire }}>#3 מתוך 12</div>
      </div>

      {/* bottom task card */}
      <div
        dir="rtl"
        style={{
          position: 'absolute',
          bottom: 26,
          left: 18,
          right: 18,
          padding: 22,
          borderRadius: 24,
          background: '#fff',
          boxShadow: '0 -4px 30px -10px rgba(0,0,0,0.2), 0 20px 40px -16px rgba(0,0,0,0.25)',
          transform: `translateY(${interpolate(cardIn, [0, 1], [220, 0])}px)`,
          opacity: cardIn,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: FIRE_GRAD, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>📸</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 15, color: C.warmInk2 }}>המשימה הבאה</div>
            <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 21, color: C.warmInk }}>צלמו את מזרקת הכיכר</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0, marginInlineStart: 10 }}>
            <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 22, color: C.fire }}>{dist}מ׳</div>
            <div style={{ fontFamily: FONT.body, fontSize: 13, color: C.warmInk2 }}>מרחק</div>
          </div>
        </div>
        <div style={{ padding: '16px 0', textAlign: 'center', borderRadius: 14, background: dist <= 100 ? FIRE_GRAD : C.warmRaised, color: dist <= 100 ? '#fff' : C.warmInk2, fontFamily: FONT.display, fontWeight: 800, fontSize: 20, boxShadow: dist <= 100 ? '0 10px 24px -10px rgba(255,87,34,0.6)' : 'none' }}>
          {dist <= 100 ? '📷 פתחו מצלמה' : 'התקרבו כדי לצלם'}
        </div>
      </div>
    </div>
  );
};

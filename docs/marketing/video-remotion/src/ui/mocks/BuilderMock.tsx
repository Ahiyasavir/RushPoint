import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { C, FONT, FIRE_GRAD } from '../../lib/theme';
import { MapCanvas } from './MapCanvas';

const stages = [
  { n: 1, name: 'נקודת זינוק', tasks: 2, color: C.fire },
  { n: 2, name: 'שוק העיר', tasks: 3, color: C.amber },
  { n: 3, name: 'הגן הגדול', tasks: 2, color: C.plasma },
  { n: 4, name: 'קו הסיום', tasks: 1, color: C.signal },
];

const chips = [
  { icon: '📸', label: 'תמונה' },
  { icon: '❓', label: 'חידון' },
  { icon: '🔑', label: 'קוד סודי' },
  { icon: '📍', label: 'צ׳ק-אין' },
  { icon: '📱', label: 'סריקת QR' },
];

const Cursor: React.FC<{ x: number; y: number; press?: number }> = ({ x, y, press = 0 }) => (
  <div style={{ position: 'absolute', left: x, top: y, zIndex: 90, transform: `scale(${1 - press * 0.2})` }}>
    <svg width="34" height="34" viewBox="0 0 24 24">
      <path d="M4 2 L4 20 L9 15 L12.5 22 L15 21 L11.5 14 L18 14 Z" fill="#fff" stroke="#000" strokeWidth="1.2" />
    </svg>
  </div>
);

export const BuilderMock: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18 } });
  // new pin drops in
  const pinDrop = spring({ frame: frame - 40, fps, config: { damping: 12, stiffness: 120 } });
  const pinY = interpolate(pinDrop, [0, 1], [-260, 0]);
  // chip highlight cycles
  const activeChip = Math.min(4, Math.floor(interpolate(frame, [70, 190], [0, 5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
  // cursor path
  const cx = interpolate(frame, [10, 45, 90, 150], [900, 560, 300, 300], { extrapolateRight: 'clamp' });
  const cy = interpolate(frame, [10, 45, 90, 150], [180, 300, 470, 470], { extrapolateRight: 'clamp' });
  const stageReveal = (i: number) => spring({ frame: frame - 4 - i * 6, fps, config: { damping: 16 } });

  const basePins: { p: { x: number; y: number }; kind?: 'default' | 'active' | 'done' }[] = [
    { p: { x: 200, y: 250 }, kind: 'done' },
    { p: { x: 470, y: 200 }, kind: 'default' },
    { p: { x: 700, y: 500 }, kind: 'default' },
  ];

  return (
    <div dir="rtl" style={{ position: 'absolute', inset: 0, display: 'flex', background: C.bg1, opacity: enter }}>
      {/* Sidebar (right in RTL) */}
      <div style={{ width: 360, flexShrink: 0, borderLeft: `1px solid ${C.border}`, padding: 26, display: 'flex', flexDirection: 'column', gap: 16, background: '#0B0C16' }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 30, color: C.ink1 }}>מצוד בעיר העתיקה</div>
        <div style={{ fontFamily: FONT.body, fontSize: 17, color: C.ink2, marginTop: -6 }}>4 שלבים · 8 משימות</div>
        <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 15, color: C.ink3, letterSpacing: 2, marginTop: 10 }}>שלבים</div>
        {stages.map((s, i) => {
          const r = stageReveal(i);
          return (
            <div
              key={s.n}
              style={{
                opacity: r,
                transform: `translateX(${interpolate(r, [0, 1], [40, 0])}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '16px 18px',
                borderRadius: 14,
                background: i === 1 ? 'rgba(255,87,34,0.10)' : C.bg2,
                border: `1px solid ${i === 1 ? 'rgba(255,87,34,0.4)' : C.border}`,
              }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 10, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT.display, fontWeight: 800, color: '#fff', fontSize: 18 }}>{s.n}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 19, color: C.ink1 }}>{s.name}</div>
                <div style={{ fontFamily: FONT.body, fontSize: 14, color: C.ink2 }}>{s.tasks} משימות</div>
              </div>
            </div>
          );
        })}
        <div style={{ padding: '14px 18px', borderRadius: 14, border: `1.5px dashed ${C.ink3}`, textAlign: 'center', fontFamily: FONT.body, fontWeight: 700, fontSize: 17, color: C.ink2 }}>+ הוסף שלב</div>
      </div>

      {/* Main canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <MapCanvas theme="dark" pins={basePins} />
        </div>

        {/* dropping new pin */}
        <div style={{ position: 'absolute', left: '46%', top: `calc(52% + ${pinY}px)`, opacity: pinDrop > 0.02 ? 1 : 0, zIndex: 40 }}>
          <svg width="52" height="64" viewBox="0 0 52 64">
            <path d="M26 2 C12 2 4 14 4 25 C4 42 26 62 26 62 C26 62 48 42 48 25 C48 14 40 2 26 2 Z" fill={C.fire} stroke="#fff" strokeWidth="3" />
            <circle cx="26" cy="24" r="9" fill="#fff" />
          </svg>
        </div>

        {/* task-type chip toolbar */}
        <div style={{ position: 'absolute', top: 26, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 12, padding: 12, borderRadius: 18, background: 'rgba(13,14,26,0.82)', border: `1px solid ${C.border}`, backdropFilter: 'blur(10px)', zIndex: 50 }}>
          {chips.map((c, i) => {
            const on = i === activeChip && frame > 66;
            return (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 18px', borderRadius: 12, background: on ? FIRE_GRAD : C.bg2, border: `1px solid ${on ? 'transparent' : C.border}`, transform: on ? 'scale(1.06)' : 'scale(1)', boxShadow: on ? '0 8px 24px -8px rgba(255,87,34,0.6)' : 'none' }}>
                <span style={{ fontSize: 22 }}>{c.icon}</span>
                <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 18, color: on ? '#fff' : C.ink1 }}>{c.label}</span>
              </div>
            );
          })}
        </div>

        {/* Launch button */}
        <div style={{ position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12, padding: '18px 34px', borderRadius: 16, background: FIRE_GRAD, boxShadow: '0 12px 34px -8px rgba(255,87,34,0.6)', zIndex: 45 }}>
          <span style={{ fontSize: 24 }}>🚀</span>
          <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 24, color: '#fff' }}>השקת ריצה</span>
        </div>

        <Cursor x={cx} y={cy} />
      </div>
    </div>
  );
};

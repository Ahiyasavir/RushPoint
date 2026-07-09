import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { C, FONT, FIRE_GRAD } from '../../lib/theme';

type Team = { name: string; emoji: string; base: number; rate: number; hero?: boolean };

const TEAMS: Team[] = [
  { name: 'הנשרים הכחולים', emoji: '🦅', base: 640, rate: 1.3 },
  { name: 'ברקים ירוקים', emoji: '⚡', base: 610, rate: 1.6 },
  { name: 'זאבי המדבר', emoji: '🐺', base: 585, rate: 1.4 },
  { name: 'הנמרים הכתומים', emoji: '🐯', base: 520, rate: 3.4, hero: true },
  { name: 'כרישי הים', emoji: '🦈', base: 500, rate: 1.2 },
];

const sig = (x: number) => 1 / (1 + Math.exp(-x));

export const LeaderboardPanel: React.FC<{ width?: number; rowH?: number }> = ({ width = 720, rowH = 96 }) => {
  const frame = useCurrentFrame();
  const t = frame; // local

  const scored = TEAMS.map((tm) => ({ ...tm, score: Math.round(tm.base + tm.rate * t) }));
  // smooth continuous rank: how many teams are above me
  const withPos = scored.map((tm) => {
    const pos = scored.reduce((acc, other) => (other.name === tm.name ? acc : acc + sig((other.score - tm.score) / 6)), 0);
    return { ...tm, pos };
  });

  return (
    <div
      style={{
        width,
        borderRadius: 24,
        background: C.bg1,
        border: `1px solid ${C.border}`,
        boxShadow: '0 40px 120px -40px rgba(0,0,0,0.8)',
        padding: 24,
        position: 'relative',
      }}
    >
      <div dir="rtl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: C.alert, boxShadow: `0 0 12px ${C.alert}` }} />
          <span style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 30, color: C.ink1 }}>טבלת מובילים</span>
        </div>
        <span style={{ fontFamily: FONT.body, fontWeight: 700, fontSize: 18, color: C.alert }}>שידור חי</span>
      </div>

      <div style={{ position: 'relative', height: TEAMS.length * rowH }}>
        {withPos.map((tm) => {
          const y = tm.pos * rowH;
          const rank = Math.round(tm.pos) + 1;
          const isFirst = rank === 1;
          return (
            <div
              key={tm.name}
              dir="rtl"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${y}px)`,
                height: rowH - 12,
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                padding: '0 22px',
                borderRadius: 16,
                background: tm.hero ? 'rgba(255,87,34,0.12)' : C.bg2,
                border: `1px solid ${tm.hero ? 'rgba(255,87,34,0.45)' : C.border}`,
                boxShadow: isFirst ? '0 10px 30px -10px rgba(255,179,0,0.5)' : 'none',
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: isFirst ? FIRE_GRAD : C.bg1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONT.display,
                  fontWeight: 800,
                  fontSize: 24,
                  color: isFirst ? '#fff' : C.ink2,
                }}
              >
                {rank}
              </div>
              <span style={{ fontSize: 34 }}>{tm.emoji}</span>
              <span style={{ flex: 1, fontFamily: FONT.body, fontWeight: 700, fontSize: 26, color: C.ink1 }}>{tm.name}</span>
              {isFirst && <span style={{ fontSize: 28 }}>👑</span>}
              <span style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 30, color: tm.hero ? C.fire : C.ink1, minWidth: 90, textAlign: 'left' }}>{tm.score}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React from 'react';
import { interpolate } from 'remotion';
import { C } from '../../lib/theme';

type Pt = { x: number; y: number };

// Stylized vector city map. Works on dark (builder) or light (play) via `theme`.
export const MapCanvas: React.FC<{
  theme?: 'dark' | 'light';
  pins?: { p: Pt; label?: string; kind?: 'default' | 'active' | 'done' }[];
  route?: Pt[];
  routeProgress?: number; // 0..1 dash reveal
  marker?: number; // 0..1 position along route
  style?: React.CSSProperties;
}> = ({ theme = 'light', pins = [], route, routeProgress = 1, marker, style }) => {
  const dark = theme === 'dark';
  const land = dark ? '#0E1020' : '#EEF1F5';
  const block = dark ? '#171A2E' : '#FFFFFF';
  const road = dark ? '#232741' : '#E2E6EE';
  const water = dark ? '#12233A' : '#CFE6F2';
  const park = dark ? '#12291F' : '#D6EFD8';

  // simple street grid
  const roads: React.ReactNode[] = [];
  for (let i = 1; i < 10; i++) {
    roads.push(<line key={`v${i}`} x1={i * 96} y1={0} x2={i * 96} y2={720} stroke={road} strokeWidth={i % 3 === 0 ? 10 : 5} />);
  }
  for (let j = 1; j < 8; j++) {
    roads.push(<line key={`h${j}`} x1={0} y1={j * 96} x2={960} y2={j * 96} stroke={road} strokeWidth={j % 3 === 0 ? 10 : 5} />);
  }

  const routeD = route && route.length > 1 ? 'M ' + route.map((p) => `${p.x} ${p.y}`).join(' L ') : '';

  // marker position
  let mk: Pt | null = null;
  if (route && route.length > 1 && marker != null) {
    const total = route.length - 1;
    const t = interpolate(marker, [0, 1], [0, total], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const idx = Math.min(Math.floor(t), total - 1);
    const frac = t - idx;
    mk = {
      x: route[idx].x + (route[idx + 1].x - route[idx].x) * frac,
      y: route[idx].y + (route[idx + 1].y - route[idx].y) * frac,
    };
  }

  return (
    <svg viewBox="0 0 960 720" style={{ width: '100%', height: '100%', display: 'block', ...style }}>
      <rect x={0} y={0} width={960} height={720} fill={land} />
      {/* water river */}
      <path d="M -20 120 C 200 200, 260 40, 520 130 S 900 240, 1000 160 L 1000 -20 L -20 -20 Z" fill={water} opacity={0.9} />
      {/* park */}
      <rect x={560} y={430} width={260} height={200} rx={24} fill={park} />
      {roads}
      {/* a few blocks */}
      {[
        [120, 300, 130, 90], [300, 250, 150, 110], [140, 470, 120, 120], [360, 470, 120, 130],
        [640, 200, 120, 90], [800, 300, 110, 90],
      ].map((b, i) => (
        <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx={10} fill={block} opacity={dark ? 0.7 : 1} />
      ))}

      {/* route */}
      {routeD && (
        <path
          d={routeD}
          fill="none"
          stroke={C.fire}
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={1400}
          strokeDashoffset={interpolate(routeProgress, [0, 1], [1400, 0])}
          style={{ filter: `drop-shadow(0 0 8px rgba(255,87,34,0.5))` }}
        />
      )}

      {/* pins */}
      {pins.map((pin, i) => {
        const color = pin.kind === 'done' ? C.go : pin.kind === 'active' ? C.fire : C.signal;
        return (
          <g key={i} transform={`translate(${pin.p.x}, ${pin.p.y})`}>
            <ellipse cx={0} cy={4} rx={16} ry={6} fill="rgba(0,0,0,0.25)" />
            <path d="M0 -44 C -22 -44 -30 -26 -30 -14 C -30 4 0 8 0 8 C 0 8 30 4 30 -14 C 30 -26 22 -44 0 -44 Z" fill={color} />
            <circle cx={0} cy={-16} r={11} fill="#fff" />
            {pin.kind === 'done' && <path d="M-5 -16 L-1 -11 L6 -21" stroke={C.go} strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
          </g>
        );
      })}

      {/* moving marker */}
      {mk && (
        <g transform={`translate(${mk.x}, ${mk.y})`}>
          <circle cx={0} cy={0} r={26} fill={C.plasma} opacity={0.22} />
          <circle cx={0} cy={0} r={13} fill={C.plasma} stroke="#fff" strokeWidth={4} />
        </g>
      )}
    </svg>
  );
};

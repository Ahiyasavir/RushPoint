import React from 'react';
import { useCurrentFrame } from 'remotion';
import { C } from '../lib/theme';

const COLORS = [C.fire, C.amber, C.plasma, C.signal, C.go, '#fff'];

// deterministic pseudo-random from integer seed
const rand = (i: number, s: number) => {
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const Confetti: React.FC<{ count?: number; startAt?: number; width?: number; height?: number }> = ({
  count = 90,
  startAt = 0,
  width = 1920,
  height = 1080,
}) => {
  const frame = useCurrentFrame() - startAt;
  if (frame < 0) return null;
  const pieces = new Array(count).fill(0).map((_, i) => {
    const x0 = rand(i, 1) * width;
    const delay = rand(i, 2) * 20;
    const t = Math.max(0, frame - delay);
    const speed = 6 + rand(i, 3) * 8;
    const y = -40 + t * speed;
    const sway = Math.sin((t + i) / 10) * 40 * rand(i, 4);
    const rot = t * (4 + rand(i, 5) * 8) * (rand(i, 6) > 0.5 ? 1 : -1);
    const size = 10 + rand(i, 7) * 14;
    const color = COLORS[Math.floor(rand(i, 8) * COLORS.length)];
    const op = y > height ? 0 : 1;
    return (
      <div
        key={i}
        style={{
          position: 'absolute',
          left: x0 + sway,
          top: y,
          width: size,
          height: size * 0.6,
          background: color,
          borderRadius: 2,
          transform: `rotate(${rot}deg)`,
          opacity: op,
        }}
      />
    );
  });
  return <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>{pieces}</div>;
};

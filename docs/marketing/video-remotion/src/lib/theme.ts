// RushPoint brand tokens — mirrored from apps/* tailwind configs + index.css
export const C = {
  fire: '#FF5722',
  amber: '#FFB300',
  plasma: '#06B6D4',
  signal: '#7C3AED',
  go: '#10B981',
  alert: '#EF4444',
  warmOrange: '#FF8A00',

  // creator-web dark surfaces
  bg0: '#07080F',
  bg1: '#0D0E1A',
  bg2: '#141626',
  ink1: '#E8EAFF',
  ink2: '#8890B8',
  ink3: '#464D6E',
  border: 'rgba(255,255,255,0.08)',

  // play-web "Warm Trail" light surfaces
  warmBg: '#FFFCF7',
  warmSurface: '#FFFFFF',
  warmRaised: '#FFF0E6',
  warmInk: '#1A0A00',
  warmInk2: '#6B5A48',
  warmBorder: 'rgba(90,70,45,0.12)',
};

export const FIRE_GRAD = `linear-gradient(135deg, ${C.fire} 0%, ${C.amber} 100%)`;
export const FIRE_GRAD_V = `linear-gradient(160deg, ${C.fire} 0%, ${C.warmOrange} 55%, ${C.amber} 100%)`;

export const FONT = {
  display: 'Rubik',
  body: 'Heebo',
  mono: 'JetBrains Mono, ui-monospace, monospace',
};

// Global video spec
export const FPS = 30;
export const W = 1920;
export const H = 1080;

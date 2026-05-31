// ─── Design Tokens ────────────────────────────────────────────────────────────
// RushPoint brand system — dark tech theme with neon accents and glassmorphism.
// Glow shadow objects cannot be expressed in Tailwind on React Native —
// apply them via the native `style` prop alongside `className`.

/** Primary neon glow colors for slot-type visual cues. */
export const GLOW = {
  green: {
    shadowColor: '#00ffaa',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  orange: {
    shadowColor: '#ff6b00',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  gold: {
    shadowColor: '#ffd700',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  cta: {
    shadowColor: '#00ffaa',
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 4 },
    elevation: 14,
  },
  blue: {
    shadowColor: '#00aaff',
    shadowOpacity: 0.50,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
} as const;

/** Glassmorphism card background style (native-only, use alongside NativeWind). */
export const GLASS = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  borderColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
} as const;

/** Gradient stop colors for use with expo-linear-gradient or SVG. */
export const GRADIENTS = {
  primary: ['#00ffaa', '#00ccff'] as const,
  warm:    ['#ff6b00', '#ff3d00'] as const,
  gold:    ['#ffd700', '#ff9500'] as const,
  surface: ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.02)'] as const,
} as const;

/** Background depth layers */
export const BG = {
  base:    '#050508',
  surface: '#0a0a10',
  card:    '#0f0f18',
  raised:  '#141420',
  overlay: 'rgba(5,5,8,0.85)',
} as const;

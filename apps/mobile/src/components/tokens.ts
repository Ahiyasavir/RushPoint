// ─── Design Tokens ────────────────────────────────────────────────────────────
// RushPoint "Cyber-Biblical Neon" — deep pitch-black dark theme with glowing neon
// accents and glassmorphism. Keep these in sync with tailwind.config.js (the
// className colors). Glow shadow objects can't be expressed in Tailwind on React
// Native — apply them via the native `style` prop alongside `className`.

/** Primary neon glow colors for slot-type / state visual cues. */
export const GLOW = {
  green: {
    shadowColor: '#39FF14',
    shadowOpacity: 0.6,
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
    shadowColor: '#FFD700',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  cyan: {
    shadowColor: '#00F0FF',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  red: {
    shadowColor: '#FF0055',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  cta: {
    shadowColor: '#39FF14',
    shadowOpacity: 0.55,
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
  backgroundColor: 'rgba(15,23,42,0.6)', // slate-900/60
  borderColor: 'rgba(255,255,255,0.10)',
  borderWidth: 1,
} as const;

/** Gradient stop colors for use with expo-linear-gradient or SVG. */
export const GRADIENTS = {
  primary: ['#39FF14', '#00F0FF'] as const,
  warm:    ['#ff6b00', '#FF0055'] as const,
  gold:    ['#FFD700', '#ff9500'] as const,
  surface: ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.02)'] as const,
} as const;

/** Background depth layers */
export const BG = {
  base:    '#030712',
  surface: '#0b1220',
  card:    '#0f172a',
  raised:  '#1e293b',
  overlay: 'rgba(3,7,18,0.85)',
} as const;

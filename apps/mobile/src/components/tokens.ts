// ─── Design Tokens ────────────────────────────────────────────────────────────
// RushPoint brand system — "Topographic Expedition": warm parchment, forest
// greens, trail-marker blaze, gold scoring, elevation-shaded accents.
// Soft paper-like shadows replace the old neon glow (key names preserved so the
// whole app re-themes from this one file — do NOT rename these exports).
//
// Glow/shadow objects cannot be expressed in Tailwind on React Native — apply
// them via the native `style` prop alongside `className`.

/**
 * Per-slot accent shadows (trail-marker colors).
 * Softened to paper-map depth; each key keeps its semantic color identity.
 */
export const GLOW = {
  green: {
    shadowColor: '#3d6152', // forest
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  orange: {
    shadowColor: '#e8743b', // blaze
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  gold: {
    shadowColor: '#c9a227', // gold
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  cta: {
    shadowColor: '#e8743b', // blaze CTA
    shadowOpacity: 0.36,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  blue: {
    shadowColor: '#4a6d8c', // waypoint blue
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
} as const;

/** Card surface style — paper card on parchment (native-only, use w/ NativeWind). */
export const GLASS = {
  backgroundColor: 'rgba(255,253,248,0.92)',
  borderColor: 'rgba(26,38,32,0.10)',
  borderWidth: 1,
} as const;

/** Gradient stop colors for expo-linear-gradient or SVG. */
export const GRADIENTS = {
  primary: ['#e8743b', '#f2935f'] as const, // blaze
  warm: ['#e8743b', '#c73e3e'] as const, // blaze → trail red
  gold: ['#c9a227', '#d89b3d'] as const, // gold
  surface: ['rgba(255,253,248,0.94)', 'rgba(236,228,212,0.9)'] as const, // paper
} as const;

/** Background depth layers — parchment / paper map. */
export const BG = {
  base: '#f5f0e6', // parchment
  surface: '#fffdf8', // card paper
  card: '#fffdf8',
  raised: '#ece4d4', // recessed paper
  overlay: 'rgba(26,38,32,0.55)',
} as const;

/** Semantic palette (optional convenience; not required by the kit). */
export const COLORS = {
  bg: '#f5f0e6',
  surface: '#fffdf8',
  primary: '#e8743b', // blaze
  secondary: '#2d4a3e', // forest
  accent: '#c73e3e', // trail red
  gold: '#c9a227',
  success: '#4a7c4e',
  warning: '#d89b3d',
  danger: '#c73e3e',
  info: '#4a6d8c',
  textPrimary: '#1a2620',
  textSecondary: '#4a5b52',
  textMuted: '#6e7b72',
  border: '#ddd2bc',
  // Elevation ramp (data viz, low → high)
  elev1: '#e8e3d8',
  elev2: '#c9d4b0',
  elev3: '#9db87e',
  elev4: '#6b8e5a',
  elev5: '#3d6152',
} as const;

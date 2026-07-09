// ─── Design Tokens ────────────────────────────────────────────────────────────
// RushPoint "Jerusalem Stone & Sapphire" — premium matte-dark theme. NO neon
// auras: cards sit on flat near-solid surfaces with crisp hairline borders and
// realistic (downward, dark) elevation shadows. Keep in sync with
// tailwind.config.js. The `GLOW.*` keys are retained for API compatibility
// (Card's glowColor) but now all render the same subtle elevation — not a glow.

const ELEVATION = {
  shadowColor: '#000000',
  shadowOpacity: 0.45,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
} as const;

const ELEVATION_STRONG = {
  shadowColor: '#000000',
  shadowOpacity: 0.55,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 12 },
  elevation: 12,
} as const;

/** Realistic elevation shadows (no colored glow). Keyed for back-compat. */
export const GLOW = {
  green:  ELEVATION,
  orange: ELEVATION,
  gold:   ELEVATION,
  cyan:   ELEVATION,
  red:    ELEVATION,
  blue:   ELEVATION,
  cta:    ELEVATION_STRONG,
} as const;

/** Card surface: near-solid slate with a crisp 1px hairline border. */
export const GLASS = {
  backgroundColor: 'rgba(15,23,42,0.9)', // slate-900/90
  borderColor: 'rgba(255,255,255,0.06)',
  borderWidth: 1,
} as const;

/** Gradient stop colors (gold / sapphire) for occasional accents. */
export const GRADIENTS = {
  primary: ['#F59E0B', '#D4AF37'] as const,
  warm:    ['#D4AF37', '#D97706'] as const,
  gold:    ['#D4AF37', '#F59E0B'] as const,
  surface: ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.01)'] as const,
} as const;

/** Background depth layers */
export const BG = {
  base:    '#0B0F17',
  surface: '#111827',
  card:    '#0F172A',
  raised:  '#1E293B',
  overlay: 'rgba(11,15,23,0.85)',
} as const;

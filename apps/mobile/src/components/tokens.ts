// Design tokens shared across atomic components.
// Glow shadow objects cannot be expressed in Tailwind on React Native —
// apply them via the native `style` prop alongside `className`.

export const GLOW = {
  green:  { shadowColor: '#10b981', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  orange: { shadowColor: '#f97316', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  gold:   { shadowColor: '#fbbf24', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  cta:    { shadowColor: '#10b981', shadowOpacity: 0.40, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
} as const;

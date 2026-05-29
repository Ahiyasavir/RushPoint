// ═══════════════════════════════════════════════════════════════════════════════
// Tene (wicker basket) product catalog — AUTHORITATIVE scoring source.
//
// The judge ticks which products a team actually brought; the base product
// score is derived ONLY from this catalog, server-side. Never trust a total
// computed by the client. Tiers follow the Seven Species theme of the event.
//
// NOTE: apps/admin keeps a display-only mirror of this catalog for the checklist
// UI and the live preview total. THIS file is the single source of truth for the
// score that is actually written to Firestore.
// ═══════════════════════════════════════════════════════════════════════════════

export type ProductTier = 'basic' | 'medium' | 'hard';

export interface TeneProduct {
  id: string;
  label: string;
  labelHe: string;
  tier: ProductTier;
  points: number;
  estimatedMinutes: number; // suggested crafting time shown in the mobile menu
}

export const TENE_PRODUCTS: readonly TeneProduct[] = [
  // ── Basic (low value) ────────────────────────────────────────────────────────
  { id: 'pitas',        label: 'Pitas',        labelHe: 'פיתות',     tier: 'basic',  points: 5,  estimatedMinutes: 3  },
  { id: 'grape-juice',  label: 'Grape Juice',  labelHe: 'מיץ ענבים', tier: 'basic',  points: 5,  estimatedMinutes: 3  },
  // ── Medium ───────────────────────────────────────────────────────────────────
  { id: 'perfumes',     label: 'Perfumes',     labelHe: 'בשמים',     tier: 'medium', points: 10, estimatedMinutes: 5  },
  { id: 'wheat',        label: 'Wheat',        labelHe: 'חיטה',      tier: 'medium', points: 10, estimatedMinutes: 5  },
  { id: 'barley',       label: 'Barley',       labelHe: 'שעורה',     tier: 'medium', points: 10, estimatedMinutes: 5  },
  // ── Hard (high value) ────────────────────────────────────────────────────────
  { id: 'olives',       label: 'Olives',       labelHe: 'זיתים',     tier: 'hard',   points: 20, estimatedMinutes: 8  },
  { id: 'pomegranates', label: 'Pomegranates', labelHe: 'רימונים',   tier: 'hard',   points: 20, estimatedMinutes: 8  },
] as const;

/** Max raw score reachable across each dimension — used for clamping + display. */
export const MAX_DESIGN_SCORE       = 20;
export const MAX_PRESENTATION_SCORE = 20;
export const MAX_PRODUCT_SCORE      = TENE_PRODUCTS.reduce((sum, p) => sum + p.points, 0);

/** Sum the catalog points for the given product ids (unknown ids are ignored). */
export function computeProductScore(productIds: string[]): number {
  const picked = new Set(productIds);
  return TENE_PRODUCTS.reduce((sum, p) => (picked.has(p.id) ? sum + p.points : sum), 0);
}

/** Clamp a raw slider value into [0, max] and round to an integer. */
export function clampScore(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.round(value)));
}

// Display-only mirror of the authoritative catalog in
// functions/src/scoring/teneProducts.ts. The Cloud Function recomputes the score
// from product ids server-side, so these point values drive only the checklist UI
// and the live preview total. Keep the ids + points in sync with the function.

export type ProductTier = 'basic' | 'medium' | 'hard';

export interface TeneProduct {
  id: string;
  label: string;
  labelHe: string;
  tier: ProductTier;
  points: number;
}

export const TENE_PRODUCTS: TeneProduct[] = [
  { id: 'pitas',        label: 'Pitas',        labelHe: 'פיתות',     tier: 'basic',  points: 5  },
  { id: 'grape-juice',  label: 'Grape Juice',  labelHe: 'מיץ ענבים', tier: 'basic',  points: 5  },
  { id: 'perfumes',     label: 'Perfumes',     labelHe: 'בשמים',     tier: 'medium', points: 10 },
  { id: 'wheat',        label: 'Wheat',        labelHe: 'חיטה',      tier: 'medium', points: 10 },
  { id: 'barley',       label: 'Barley',       labelHe: 'שעורה',     tier: 'medium', points: 10 },
  { id: 'olives',       label: 'Olives',       labelHe: 'זיתים',     tier: 'hard',   points: 20 },
  { id: 'pomegranates', label: 'Pomegranates', labelHe: 'רימונים',   tier: 'hard',   points: 20 },
];

export const MAX_DESIGN_SCORE       = 20;
export const MAX_PRESENTATION_SCORE = 20;

export const TIER_LABEL: Record<ProductTier, string> = {
  basic:  'Basic',
  medium: 'Medium',
  hard:   'Hard',
};

export const TIER_ACCENT: Record<ProductTier, string> = {
  basic:  'text-zinc-400',
  medium: 'text-neon-blue',
  hard:   'text-neon-gold',
};

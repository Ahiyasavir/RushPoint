// Display-only mirror of the Tene product catalog for the mobile crafting menu.
// The AUTHORITATIVE scoring source is functions/src/scoring/teneProducts.ts;
// saveTeneSelection validates ids server-side, so this list only drives the UI.

export type ProductTier = 'basic' | 'medium' | 'hard';

export interface TeneProduct {
  id: string;
  label: string;
  labelHe: string;
  tier: ProductTier;
  points: number;
  estimatedMinutes: number;
}

export const TENE_PRODUCTS: readonly TeneProduct[] = [
  { id: 'pitas',        label: 'Pitas',        labelHe: 'פיתות',     tier: 'basic',  points: 5,  estimatedMinutes: 3 },
  { id: 'grape-juice',  label: 'Grape Juice',  labelHe: 'מיץ ענבים', tier: 'basic',  points: 5,  estimatedMinutes: 3 },
  { id: 'perfumes',     label: 'Perfumes',     labelHe: 'בשמים',     tier: 'medium', points: 10, estimatedMinutes: 5 },
  { id: 'wheat',        label: 'Wheat',        labelHe: 'חיטה',      tier: 'medium', points: 10, estimatedMinutes: 5 },
  { id: 'barley',       label: 'Barley',       labelHe: 'שעורה',     tier: 'medium', points: 10, estimatedMinutes: 5 },
  { id: 'olives',       label: 'Olives',       labelHe: 'זיתים',     tier: 'hard',   points: 20, estimatedMinutes: 8 },
  { id: 'pomegranates', label: 'Pomegranates', labelHe: 'רימונים',   tier: 'hard',   points: 20, estimatedMinutes: 8 },
] as const;

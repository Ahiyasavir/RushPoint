// Template names, the settings a template carries, and quick-card targets
// (change: creator-onboarding-and-plain-language).
//
// Template names/descriptions used to be hardcoded Hebrew literals in
// templates.ts, so an English creator's very first screen was in Hebrew and the
// game they created got a Hebrew title. They now resolve from the translation
// maps, with ONE source of truth per string.
//
// Pure: no React, no Firebase, so every rule below is a unit test rather than a
// visual review.
import type { GameMode, ScoringPreset } from '@rushpoint/shared';
import type { T } from '../i18n';

type TemplateCopy = { name: string; description: string };

function entry(key: string, dict: T): TemplateCopy | undefined {
  return (dict.dashboard.templates as Record<string, TemplateCopy | undefined>)[key];
}

/** The template's name in the creator's language, or a safe fallback. */
export function templateLabel(key: string, dict: T): string {
  return entry(key, dict)?.name || dict.dashboard.untitledGame;
}

/** The template's description in the creator's language, or a safe fallback. */
export function templateDescription(key: string, dict: T): string {
  return entry(key, dict)?.description || dict.dashboard.templateFallbackDesc;
}

export interface GameSettingsDescription {
  mode: string;
  scoring: string;
  summary: string;
}

// Keyed by the closed unions from @rushpoint/shared, so adding a mode or a
// preset without describing it is a typecheck failure, not a blank line in the
// picker.
const MODE_KEY: Record<GameMode, 'modeTeam' | 'modeIndividual'> = {
  team: 'modeTeam',
  individual: 'modeIndividual',
};

const PRESET_KEY: Record<ScoringPreset, 'scoringTimeOnly' | 'scoringFixedPointsSpeed' | 'scoringSmartWeighted'> = {
  time_only: 'scoringTimeOnly',
  fixed_points_speed: 'scoringFixedPointsSpeed',
  smart_weighted: 'scoringSmartWeighted',
};

/** Plain-language description of the two settings a template assigns. */
export function describeGameSettings(mode: GameMode, preset: ScoringPreset, dict: T): GameSettingsDescription {
  const d = dict.dashboard;
  const modeText = d[MODE_KEY[mode]];
  const scoringText = d[PRESET_KEY[preset]];
  return { mode: modeText, scoring: scoringText, summary: d.settingsSummary(modeText, scoringText) };
}

export type QuickCardId = 'builder' | 'gallery' | 'wallet';

/**
 * The quick cards' identities, in the order `t.dashboard.quickCards` lists them.
 * Deliberately NOT inside the translation maps: an id is not user-facing text,
 * and putting one there makes the Hebrew dictionary carry English literals that
 * the i18n gate correctly rejects.
 */
export const QUICK_CARD_IDS: readonly QuickCardId[] = ['builder', 'gallery', 'wallet'] as const;

/**
 * Sentinel target meaning "open the template picker". The picker is a modal on
 * the dashboard, not a route, so this is deliberately not a path — the dashboard
 * opens the picker instead of navigating.
 */
export const CREATE_GAME_TARGET = '#new-game';

export interface QuickCardGame { id: string; updatedAt?: string }

/**
 * Where a dashboard quick card goes. The builder card used to target '/', the
 * dashboard the creator was already standing on, so the most prominent "get
 * started" affordance did nothing.
 */
export function quickCardTarget(cardId: QuickCardId, games: QuickCardGame[]): string {
  if (cardId === 'gallery') return '/gallery';
  if (cardId === 'wallet') return '/wallet';
  const newest = mostRecentGame(games);
  return newest ? `/build/${newest.id}` : CREATE_GAME_TARGET;
}

function mostRecentGame(games: QuickCardGame[]): QuickCardGame | null {
  let best: QuickCardGame | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const g of games ?? []) {
    const raw = g.updatedAt ? Date.parse(g.updatedAt) : NaN;
    const at = Number.isFinite(raw) ? raw : Number.NEGATIVE_INFINITY;
    // `>=` keeps the LAST game on a tie, matching listGames' own ordering.
    if (!best || at >= bestAt) { best = g; bestAt = at; }
  }
  return best;
}

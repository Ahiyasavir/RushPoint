// First-run checklist derivation (change: creator-onboarding-and-plain-language).
// Deliberately dependency-free (no React, no Firebase) so it runs in the node-env
// vitest lane and so the checklist can never disagree with the dashboard's data.
//
// The rule that matters: every step's done state is DERIVED from the creator's
// real games and runs. Nothing here reads a stored "progress" flag, because a
// stored flag drifts the moment a creator deletes their only game and would then
// tell them a step is behind them when it is not.

export type OnboardingStepId = 'createGame' | 'addTask' | 'preview' | 'testRun' | 'launch';

/** The five steps, in the order the creator walks them. */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStepId[] =
  ['createGame', 'addTask', 'preview', 'testRun', 'launch'] as const;

export interface OnboardingGame {
  id: string;
  stages: { tasks: unknown[] }[];
  playCount?: number;
}

export interface OnboardingRun {
  runId: string;
  testDrive?: boolean;
  status?: string;
}

export interface OnboardingInput {
  games: OnboardingGame[];
  runs: OnboardingRun[];
  /** Local-only signal: previewing is a Builder tab, not a mutation (design D2). */
  previewedGameIds: string[];
  dismissed: boolean;
}

export interface OnboardingChecklist {
  visible: boolean;
  steps: { id: OnboardingStepId; done: boolean }[];
  completedCount: number;
}

const PREVIEWED_STORAGE_KEY = 'rp-previewed-games';
export const ONBOARDING_DISMISSED_KEY = 'rp-onboarding-dismissed';
export { PREVIEWED_STORAGE_KEY };

export function buildOnboardingChecklist(input: OnboardingInput): OnboardingChecklist {
  const games = input.games ?? [];
  const runs = input.runs ?? [];
  const previewed = new Set(input.previewedGameIds ?? []);

  const createGame = games.length > 0;
  const addTask = games.some((g) => (g.stages ?? []).some((s) => (s.tasks ?? []).length > 0));
  // Only counts for a game the creator still owns, so a deleted game cannot keep
  // the step ticked forever.
  const preview = games.some((g) => previewed.has(g.id));
  // A test drive is a rehearsal and never increments playCount (launchRun), so a
  // recorded play is proof of a real launch even after that run has finished.
  const launch = games.some((g) => (g.playCount ?? 0) > 0) || runs.some((r) => r.testDrive === false);
  // A real launch means the rehearsal step is behind them either way.
  const testRun = launch || runs.length > 0;

  const doneById: Record<OnboardingStepId, boolean> = { createGame, addTask, preview, testRun, launch };
  const steps = ONBOARDING_STEP_ORDER.map((id) => ({ id, done: doneById[id] }));
  const completedCount = steps.filter((s) => s.done).length;

  return {
    steps,
    completedCount,
    visible: !input.dismissed && completedCount < steps.length && !isEstablished(input),
  };
}

/**
 * An account that already has a game and a real run was established before the
 * checklist existed; walking it back through "create a game" would be noise.
 */
function isEstablished(input: OnboardingInput): boolean {
  const games = input.games ?? [];
  const runs = input.runs ?? [];
  const hasGame = games.length > 0;
  const hasRealRun = games.some((g) => (g.playCount ?? 0) > 0) || runs.some((r) => r.testDrive === false);
  return hasGame && hasRealRun;
}

/** Parse the stored previewed-game ids. Malformed or missing data degrades to none. */
export function readPreviewedGames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

/** Serialize previewed-game ids, de-duplicated and blank-free. */
export function writePreviewedGames(ids: string[]): string {
  const clean = [...new Set((ids ?? []).filter((v) => typeof v === 'string' && v.length > 0))];
  return JSON.stringify(clean);
}

/** Remembered game count, so the loading placeholder matches what they have. */
export const KNOWN_GAME_COUNT_KEY = 'rp-known-game-count';

/** `null` means "we have never seen this account load" — assume nothing. */
export function readKnownGameCount(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * How many game-card placeholders the loading state should draw. Zero for an
 * account last seen empty, so a first-time creator no longer watches six cards
 * resolve into an empty state.
 */
export function skeletonCardCount(known: number | null, fallback = 6, max = 6): number {
  if (known === null) return fallback;
  return Math.max(0, Math.min(max, known));
}

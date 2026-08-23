import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEP_ORDER,
  buildOnboardingChecklist,
  readKnownGameCount,
  readPreviewedGames,
  skeletonCardCount,
  writePreviewedGames,
  type OnboardingInput,
} from '../creatorOnboarding';

function input(over: Partial<OnboardingInput> = {}): OnboardingInput {
  return { games: [], runs: [], previewedGameIds: [], dismissed: false, ...over };
}

const gameWithTask = { id: 'g1', stages: [{ tasks: [{}] }], playCount: 0 };
const gameNoTasks = { id: 'g1', stages: [{ tasks: [] }], playCount: 0 };

describe('creatorOnboarding — shape and order', () => {
  it('always returns exactly the five steps in the defined order', () => {
    expect(ONBOARDING_STEP_ORDER).toEqual(['createGame', 'addTask', 'preview', 'testRun', 'launch']);
    for (const inp of [input(), input({ games: [gameWithTask] })]) {
      expect(buildOnboardingChecklist(inp).steps.map((s) => s.id)).toEqual(ONBOARDING_STEP_ORDER);
    }
  });

  it('shows the checklist with nothing done for a zero-game account', () => {
    const r = buildOnboardingChecklist(input());
    expect(r.visible).toBe(true);
    expect(r.completedCount).toBe(0);
    expect(r.steps.every((s) => !s.done)).toBe(true);
  });
});

describe('creatorOnboarding — derivation from real data', () => {
  it('ticks only createGame for a game with zero tasks', () => {
    const r = buildOnboardingChecklist(input({ games: [gameNoTasks] }));
    expect(r.steps.find((s) => s.id === 'createGame')!.done).toBe(true);
    expect(r.steps.find((s) => s.id === 'addTask')!.done).toBe(false);
    expect(r.completedCount).toBe(1);
  });

  it('ticks addTask once any game has at least one task in any stage', () => {
    const g = { id: 'g2', stages: [{ tasks: [] }, { tasks: [{}, {}] }], playCount: 0 };
    expect(buildOnboardingChecklist(input({ games: [g] })).steps.find((s) => s.id === 'addTask')!.done).toBe(true);
  });

  it('ticks preview only for a previewed game the creator actually owns', () => {
    const owned = buildOnboardingChecklist(input({ games: [gameWithTask], previewedGameIds: ['g1'] }));
    expect(owned.steps.find((s) => s.id === 'preview')!.done).toBe(true);
    const stale = buildOnboardingChecklist(input({ games: [gameWithTask], previewedGameIds: ['deleted-game'] }));
    expect(stale.steps.find((s) => s.id === 'preview')!.done).toBe(false);
  });

  it('ticks testRun but not launch for a test-drive-only run', () => {
    const r = buildOnboardingChecklist(input({ games: [gameWithTask], runs: [{ runId: 'r1', testDrive: true }] }));
    expect(r.steps.find((s) => s.id === 'testRun')!.done).toBe(true);
    expect(r.steps.find((s) => s.id === 'launch')!.done).toBe(false);
  });

  it('ticks both run steps for one non-test run', () => {
    const r = buildOnboardingChecklist(input({ games: [gameWithTask], runs: [{ runId: 'r1', testDrive: false }] }));
    expect(r.steps.find((s) => s.id === 'testRun')!.done).toBe(true);
    expect(r.steps.find((s) => s.id === 'launch')!.done).toBe(true);
  });

  it('treats a game with a recorded play as a real launch (test drives do not count plays)', () => {
    const played = { id: 'g1', stages: [{ tasks: [{}] }], playCount: 3 };
    const r = buildOnboardingChecklist(input({ games: [played] }));
    expect(r.steps.find((s) => s.id === 'launch')!.done).toBe(true);
    expect(r.steps.find((s) => s.id === 'testRun')!.done).toBe(true);
  });
});

describe('creatorOnboarding — retirement', () => {
  it('hides when dismissed regardless of step state', () => {
    expect(buildOnboardingChecklist(input({ dismissed: true })).visible).toBe(false);
    expect(buildOnboardingChecklist(input({ games: [gameWithTask], dismissed: true })).visible).toBe(false);
  });

  it('hides when every step is done even if never dismissed', () => {
    const r = buildOnboardingChecklist(input({
      games: [{ id: 'g1', stages: [{ tasks: [{}] }], playCount: 1 }],
      previewedGameIds: ['g1'],
      runs: [{ runId: 'r1', testDrive: false }],
    }));
    expect(r.completedCount).toBe(5);
    expect(r.visible).toBe(false);
  });

  it('never shows for an established account that predates the checklist', () => {
    // A game plus a real completed run, and nothing previewed on this device.
    const r = buildOnboardingChecklist(input({
      games: [{ id: 'g1', stages: [{ tasks: [{}] }], playCount: 4 }],
      runs: [],
      previewedGameIds: [],
    }));
    expect(r.visible).toBe(false);
  });
});

describe('creatorOnboarding — determinism', () => {
  it('yields an identical result when recomputed from the same input', () => {
    const inp = input({ games: [gameNoTasks], runs: [{ runId: 'r1', testDrive: true }] });
    expect(buildOnboardingChecklist(inp)).toEqual(buildOnboardingChecklist(inp));
    expect(buildOnboardingChecklist(inp)).toEqual(buildOnboardingChecklist({ ...inp }));
  });
});

describe('creatorOnboarding — previewed-game storage parsers', () => {
  it('round-trips a set of ids', () => {
    expect(readPreviewedGames(writePreviewedGames(['a', 'b']))).toEqual(['a', 'b']);
  });

  it('returns an empty list for malformed or missing data without throwing', () => {
    expect(readPreviewedGames(null)).toEqual([]);
    expect(readPreviewedGames('')).toEqual([]);
    expect(readPreviewedGames('{not json')).toEqual([]);
    expect(readPreviewedGames('{"a":1}')).toEqual([]);
    expect(readPreviewedGames('[1,2,3]')).toEqual([]);
  });

  it('de-duplicates and drops blanks when writing', () => {
    expect(readPreviewedGames(writePreviewedGames(['a', 'a', '', 'b']))).toEqual(['a', 'b']);
  });
});

describe('creatorOnboarding — loading placeholder matches reality', () => {
  it('draws no game-card placeholders for an account last seen empty', () => {
    expect(skeletonCardCount(readKnownGameCount('0'))).toBe(0);
  });

  it('draws as many placeholders as the account is known to have, capped', () => {
    expect(skeletonCardCount(readKnownGameCount('2'))).toBe(2);
    expect(skeletonCardCount(readKnownGameCount('99'))).toBe(6);
  });

  it('falls back to the default when the account has never been seen', () => {
    expect(readKnownGameCount(null)).toBeNull();
    expect(readKnownGameCount('nonsense')).toBeNull();
    expect(readKnownGameCount('-4')).toBeNull();
    expect(skeletonCardCount(null)).toBe(6);
  });
});

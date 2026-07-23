// Pause-clock tasks (change: pause-clock-tasks) — the accumulation/subtraction rule.
//
// This is the ONLY place the excluded duration is defined. It is pure by design:
// the race clock is server-authoritative, so the rule must be testable without an
// emulator, without a client, and without a scoring preset in the picture. Every
// edge case the feature can hit in a real run is pinned here, because a bug in
// this arithmetic is a bug in every leaderboard the platform ever publishes.
import { describe, test, expect } from 'vitest';
import {
  taskExcludedMs,
  teamExcludedMs,
  adjustedElapsedMs,
  adjustedElapsedSeconds,
} from './pausedClock';

const ISO = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

describe('taskExcludedMs — one task record', () => {
  test('a task that does NOT pause the clock excludes nothing, whatever its span', () => {
    expect(taskExcludedMs({ startedAt: ISO(0), completedAt: ISO(10 * MIN) }, false)).toBe(0);
  });

  test('an ordinary paused span is exactly completedAt - startedAt', () => {
    expect(taskExcludedMs({ startedAt: ISO(0), completedAt: ISO(10 * MIN) }, true)).toBe(10 * MIN);
  });

  test('a task the team never completes excludes nothing', () => {
    // The team is still sitting on it (or abandoned it and was re-routed, or it
    // expired, or a partial-completion stage auto-skipped it). We cannot tell
    // "deliberating" from "walked away", and excluding an open span would reward
    // walking away — so an incomplete paused task is worth zero.
    expect(taskExcludedMs({ startedAt: ISO(0) }, true)).toBe(0);
  });

  test('a task with no startedAt excludes nothing', () => {
    expect(taskExcludedMs({ completedAt: ISO(10 * MIN) }, true)).toBe(0);
  });

  test('a skipped / expired record (no completedAt) excludes nothing', () => {
    expect(taskExcludedMs({ startedAt: ISO(0), completedAt: undefined }, true)).toBe(0);
  });

  test('a re-routed record only ever counts the span that ENDED in the completion', () => {
    // The record is rewritten in place on re-assignment: startedAt is the latest
    // assignment. There is exactly one span, and it is the final one.
    const reassigned = { startedAt: ISO(30 * MIN), completedAt: ISO(35 * MIN) };
    expect(taskExcludedMs(reassigned, true)).toBe(5 * MIN);
  });

  test('a duplicate completion recomputes the SAME value (idempotent)', () => {
    const rec = { startedAt: ISO(0), completedAt: ISO(7 * MIN) };
    expect(taskExcludedMs(rec, true)).toBe(taskExcludedMs(rec, true));
  });

  test('clock skew (completedAt before startedAt) clamps to zero, never negative', () => {
    expect(taskExcludedMs({ startedAt: ISO(10 * MIN), completedAt: ISO(0) }, true)).toBe(0);
  });

  test('unparsable timestamps yield 0, never NaN', () => {
    expect(taskExcludedMs({ startedAt: 'not-a-date', completedAt: ISO(MIN) }, true)).toBe(0);
    expect(taskExcludedMs({ startedAt: ISO(0), completedAt: 'nope' }, true)).toBe(0);
  });

  test('non-string timestamps yield 0, never NaN', () => {
    expect(taskExcludedMs(
      { startedAt: 0 as unknown as string, completedAt: 5 as unknown as string }, true)).toBe(0);
  });

  test('an empty record yields 0', () => {
    expect(taskExcludedMs({}, true)).toBe(0);
  });
});

describe('teamExcludedMs — the whole team document', () => {
  const stage = (tasks: { excludedMs?: number }[]) => ({ tasks });

  test('zero stages and zero tasks sum to 0', () => {
    expect(teamExcludedMs([])).toBe(0);
    expect(teamExcludedMs([stage([])])).toBe(0);
  });

  test('records with no excludedMs contribute nothing (every pre-existing run)', () => {
    expect(teamExcludedMs([stage([{}, {}]), stage([{}])])).toBe(0);
  });

  test('sums the stamped values across stages', () => {
    expect(teamExcludedMs([
      stage([{ excludedMs: 2 * MIN }, {}]),
      stage([{ excludedMs: 3 * MIN }]),
    ])).toBe(5 * MIN);
  });

  test('a negative stamp is ignored, never subtracted from the total', () => {
    expect(teamExcludedMs([stage([{ excludedMs: -9999 }, { excludedMs: MIN }])])).toBe(MIN);
  });

  test('NaN and Infinity stamps are ignored; the total stays finite', () => {
    const total = teamExcludedMs([stage([
      { excludedMs: NaN }, { excludedMs: Infinity }, { excludedMs: MIN },
    ])]);
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBe(MIN);
  });

  test('a garbage stage shape never throws', () => {
    expect(teamExcludedMs(undefined as never)).toBe(0);
    expect(teamExcludedMs([{ tasks: undefined } as never])).toBe(0);
  });
});

describe('adjustedElapsedMs — the subtraction rule', () => {
  test('subtracts the excluded amount from the raw elapsed time', () => {
    expect(adjustedElapsedMs(60 * MIN, 10 * MIN)).toBe(50 * MIN);
  });

  test('excluded === raw yields exactly zero', () => {
    expect(adjustedElapsedMs(42 * MIN, 42 * MIN)).toBe(0);
  });

  test('excluded > raw (every task pauses) floors at zero, never negative', () => {
    expect(adjustedElapsedMs(10 * MIN, 999 * MIN)).toBe(0);
  });

  test('zero excluded is a total no-op', () => {
    expect(adjustedElapsedMs(1234, 0)).toBe(1234);
  });

  test('a raw Infinity (unfinished team) stays Infinity so the ranking still omits it', () => {
    expect(adjustedElapsedMs(Infinity, 5 * MIN)).toBe(Infinity);
  });

  test('a non-finite excluded amount is treated as zero', () => {
    expect(adjustedElapsedMs(60 * MIN, NaN)).toBe(60 * MIN);
    expect(adjustedElapsedMs(60 * MIN, Infinity)).toBe(60 * MIN);
  });

  test('a NaN raw elapsed time never becomes a number out of thin air', () => {
    expect(Number.isNaN(adjustedElapsedMs(NaN, 5))).toBe(true);
  });

  test('a negative excluded amount can never ADD time', () => {
    expect(adjustedElapsedMs(60 * MIN, -60 * MIN)).toBe(60 * MIN);
  });
});

describe('adjustedElapsedSeconds — the same rule in buildRankings units', () => {
  test('seconds in, milliseconds excluded, seconds out', () => {
    expect(adjustedElapsedSeconds(3600, 600_000)).toBe(3000);
  });

  test('floors at zero', () => {
    expect(adjustedElapsedSeconds(60, 999_000)).toBe(0);
  });

  test('Infinity passes through (a team with no finish has no duration)', () => {
    expect(adjustedElapsedSeconds(Infinity, 1000)).toBe(Infinity);
  });
});

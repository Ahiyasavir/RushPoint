// Prune-eligibility predicate (change: run-retention-completeness).
//
// This function decides whether a run's participant PII — GPS pings, photos,
// audio, chat, alerts — is destroyed. Getting it wrong in one direction breaks a
// promise the Privacy Policy makes to participants; getting it wrong in the OTHER
// direction wipes a game that is still being played. So it is pure, total, and
// attacked here from every side with no emulator and no clock read.

import { expect, test, describe } from 'vitest';
import {
  evaluateRunPrune,
  RUN_PRUNE_REASONS,
  parseRunPath,
  ABANDONABLE_RUN_STATUSES,
  type RunRetentionFacts,
} from './runRetention';

const DAY = 24 * 60 * 60 * 1000;
const DAYS = 90;
const WINDOW = DAYS * DAY;
const NOW = new Date('2026-07-23T12:00:00.000Z');

/** ISO string `ms` milliseconds before NOW. */
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
/** ISO string `ms` milliseconds after NOW. */
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe('evaluateRunPrune — a run that is still alive is never eligible', () => {
  test('a live run mid-play (everything minutes old) is not pruned', () => {
    const run: RunRetentionFacts = {
      status: 'live',
      createdAt: ago(2 * 60 * 60 * 1000),
      launchedAt: ago(90 * 60 * 1000),
      updatedAt: ago(30 * 1000),
    };
    const d = evaluateRunPrune(run, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('within_retention');
  });

  // THE LOAD-BEARING CASE. The anchor is the MAXIMUM of every known timestamp,
  // so one fresh signal vetoes the prune no matter how ancient the others are.
  // If this ever regresses, a long-running or resumed run gets wiped mid-play.
  test('ancient createdAt/launchedAt but a fresh updatedAt is NOT pruned', () => {
    const d = evaluateRunPrune({
      status: 'live',
      createdAt: ago(200 * DAY),
      launchedAt: ago(200 * DAY),
      updatedAt: ago(60 * 60 * 1000),
    }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('within_retention');
  });

  test('ancient createdAt but a launch one day ago is NOT pruned', () => {
    expect(evaluateRunPrune({
      status: 'live', createdAt: ago(200 * DAY), launchedAt: ago(DAY), updatedAt: ago(200 * DAY),
    }, NOW, DAYS).prune).toBe(false);
  });
});

describe('evaluateRunPrune — abandoned runs (the defect this change fixes)', () => {
  test('a live run whose every timestamp is 200 days old IS pruned', () => {
    const d = evaluateRunPrune({
      status: 'live',
      createdAt: ago(200 * DAY),
      launchedAt: ago(200 * DAY),
      updatedAt: ago(199 * DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(true);
    expect(d.reason).toBe('abandoned_retention_elapsed');
  });

  test('a live run abandoned 10 days ago is inside the window', () => {
    const d = evaluateRunPrune({
      status: 'live', createdAt: ago(11 * DAY), launchedAt: ago(11 * DAY), updatedAt: ago(10 * DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('within_retention');
  });

  test('a draft run 200 days old is pruned; 10 days old is not', () => {
    expect(evaluateRunPrune({ status: 'draft', createdAt: ago(200 * DAY) }, NOW, DAYS).prune).toBe(true);
    expect(evaluateRunPrune({ status: 'draft', createdAt: ago(10 * DAY) }, NOW, DAYS).prune).toBe(false);
  });
});

describe('evaluateRunPrune — finalized runs keep the existing rule', () => {
  test('finished 10 days ago is inside the window', () => {
    const d = evaluateRunPrune({
      status: 'finished', createdAt: ago(11 * DAY), finishedAt: ago(10 * DAY), updatedAt: ago(10 * DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('within_retention');
  });

  test('finished 200 days ago is pruned', () => {
    const d = evaluateRunPrune({
      status: 'finished', createdAt: ago(201 * DAY), finishedAt: ago(200 * DAY), updatedAt: ago(200 * DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(true);
    expect(d.reason).toBe('finished_retention_elapsed');
  });

  // A post-finalize touch (publishing the board, a score adjustment) must NOT
  // push the participants' photos past the promised 90-days-after-completion.
  test('a finished run is anchored on finishedAt, not on a later updatedAt', () => {
    const d = evaluateRunPrune({
      status: 'finished', createdAt: ago(300 * DAY), finishedAt: ago(200 * DAY), updatedAt: ago(DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(true);
    expect(d.reason).toBe('finished_retention_elapsed');
  });

  test('a finished run with an unparseable finishedAt falls back to the activity anchor', () => {
    const d = evaluateRunPrune({
      status: 'finished', finishedAt: 'not-a-date',
      createdAt: ago(200 * DAY), launchedAt: ago(200 * DAY), updatedAt: ago(200 * DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(true);
    expect(d.reason).toBe('abandoned_retention_elapsed');
  });
});

describe('evaluateRunPrune — fail closed', () => {
  test('an already-pruned run short-circuits before any timestamp maths', () => {
    const d = evaluateRunPrune({
      status: 'live', createdAt: ago(500 * DAY), piiPrunedAt: ago(DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('already_pruned');
  });

  test('no timestamps at all is never pruned', () => {
    const d = evaluateRunPrune({ status: 'live' }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('no_usable_timestamp');
  });

  const BAD_TIMESTAMPS: Array<[unknown, string]> = [
    ['not-a-date', 'unparseable'],
    ['', 'empty'],
    ['   ', 'blank'],
    [null, 'null'],
    [undefined, 'undefined'],
    [Number.NaN, 'NaN'],
    [{}, 'object'],
    [12345, 'number'],
  ];
  test.each(BAD_TIMESTAMPS)('every timestamp %p (%s) is never pruned', (bad: unknown) => {
    const d = evaluateRunPrune({
      status: 'live',
      createdAt: bad as never, launchedAt: bad as never,
      updatedAt: bad as never, finishedAt: bad as never,
    }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('no_usable_timestamp');
  });

  test('unparseable values are ignored, not fatal, when another timestamp is usable', () => {
    const d = evaluateRunPrune({
      status: 'live', createdAt: 'garbage', launchedAt: ago(200 * DAY), updatedAt: undefined,
    }, NOW, DAYS);
    expect(d.prune).toBe(true);
    expect(d.reason).toBe('abandoned_retention_elapsed');
  });

  test('clock skew: an anchor a day in the future is never pruned', () => {
    const d = evaluateRunPrune({
      status: 'live', createdAt: ago(500 * DAY), updatedAt: ahead(DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('future_timestamp');
  });

  test('clock skew of a single millisecond is still never pruned', () => {
    const d = evaluateRunPrune({
      status: 'finished', finishedAt: ahead(1), createdAt: ago(500 * DAY),
    }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('future_timestamp');
  });

  test('an anchor exactly equal to now is inside the window, not "future"', () => {
    const d = evaluateRunPrune({ status: 'live', createdAt: NOW.toISOString() }, NOW, DAYS);
    expect(d.prune).toBe(false);
    expect(d.reason).toBe('within_retention');
  });
});

describe('evaluateRunPrune — the boundary is exact and inclusive', () => {
  const anchor = new Date(NOW.getTime() - WINDOW); // eligible at exactly NOW

  test('abandoned: -1 ms is not eligible', () => {
    const at = new Date(anchor.getTime() + 1).toISOString();
    expect(evaluateRunPrune({ status: 'live', createdAt: at }, NOW, DAYS).prune).toBe(false);
  });

  test('abandoned: exactly at the boundary IS eligible', () => {
    expect(evaluateRunPrune(
      { status: 'live', createdAt: anchor.toISOString() }, NOW, DAYS,
    ).prune).toBe(true);
  });

  test('abandoned: +1 ms is eligible', () => {
    const at = new Date(anchor.getTime() - 1).toISOString();
    expect(evaluateRunPrune({ status: 'live', createdAt: at }, NOW, DAYS).prune).toBe(true);
  });

  test('finished: the same -1 ms / exact / +1 ms behavior', () => {
    const before = new Date(anchor.getTime() + 1).toISOString();
    const after = new Date(anchor.getTime() - 1).toISOString();
    expect(evaluateRunPrune({ status: 'finished', finishedAt: before }, NOW, DAYS).prune).toBe(false);
    expect(evaluateRunPrune({ status: 'finished', finishedAt: anchor.toISOString() }, NOW, DAYS).prune).toBe(true);
    expect(evaluateRunPrune({ status: 'finished', finishedAt: after }, NOW, DAYS).prune).toBe(true);
  });

  test('the reported eligibleAtMs is anchor + window', () => {
    const d = evaluateRunPrune({ status: 'live', createdAt: anchor.toISOString() }, NOW, DAYS);
    expect(d.anchorMs).toBe(anchor.getTime());
    expect(d.eligibleAtMs).toBe(anchor.getTime() + WINDOW);
  });

  test('a days override is honoured in both directions', () => {
    const run: RunRetentionFacts = { status: 'live', createdAt: ago(2 * DAY) };
    expect(evaluateRunPrune(run, NOW, 0).prune).toBe(true);
    expect(evaluateRunPrune(run, NOW, 1).prune).toBe(true);
    expect(evaluateRunPrune(run, NOW, 3).prune).toBe(false);
  });
});

describe('evaluateRunPrune — cross-cutting invariants', () => {
  // Deterministic pseudo-random sweep: no seeded-random library needed, just a
  // fixed LCG so a failure is reproducible.
  function* generated(): Generator<RunRetentionFacts> {
    let seed = 1337;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const statuses = ['draft', 'live', 'finished', undefined, 'weird'];
    for (let i = 0; i < 400; i++) {
      const pick = () => {
        const r = rand();
        if (r < 0.15) return undefined;
        if (r < 0.2) return 'not-a-date';
        return new Date(NOW.getTime() - Math.floor(rand() * 400 * DAY)).toISOString();
      };
      yield {
        status: statuses[Math.floor(rand() * statuses.length)] as never,
        createdAt: pick() as never,
        launchedAt: pick() as never,
        updatedAt: pick() as never,
        finishedAt: pick() as never,
      };
    }
  }

  // The veto is scoped to runs that were NOT finalized — i.e. the ones that could
  // conceivably still be alive. A finalized run is anchored on `finishedAt` by
  // design (D1): it is definitionally not being played, and anchoring it on a
  // later touch would push participants' photos past the promised 90 days.
  test('RECENCY VETO: an unfinalized run with any timestamp inside the window is never pruned', () => {
    let exercised = 0;
    for (const run of generated()) {
      const finalized = run.status === 'finished' && Number.isFinite(Date.parse(String(run.finishedAt)));
      if (finalized) continue;
      const fresh = [run.createdAt, run.launchedAt, run.updatedAt, run.finishedAt]
        .map((v) => (typeof v === 'string' ? Date.parse(v) : Number.NaN))
        .some((ms) => Number.isFinite(ms) && ms > NOW.getTime() - WINDOW);
      if (fresh) {
        exercised++;
        const d = evaluateRunPrune(run, NOW, DAYS);
        expect({ run, d }).toMatchObject({ d: { prune: false } });
      }
    }
    expect(exercised).toBeGreaterThan(20); // the sweep actually hit the case
  });

  test('FINALIZED ANCHOR: a finalized run is decided by finishedAt alone', () => {
    let exercised = 0;
    for (const run of generated()) {
      const finishedMs = typeof run.finishedAt === 'string' ? Date.parse(run.finishedAt) : Number.NaN;
      if (run.status !== 'finished' || !Number.isFinite(finishedMs)) continue;
      if (finishedMs > NOW.getTime()) continue; // future anchors are rejected outright
      exercised++;
      const d = evaluateRunPrune(run, NOW, DAYS);
      expect({ run, d }).toMatchObject({ d: { prune: finishedMs <= NOW.getTime() - WINDOW } });
    }
    expect(exercised).toBeGreaterThan(10);
  });

  test('TOTALITY: every input yields a decision with a known reason and never throws', () => {
    const hostile: unknown[] = [
      undefined, null, {}, { status: 'live' }, { createdAt: Number.NaN },
      { status: 123, createdAt: {}, updatedAt: [] }, { piiPrunedAt: '' },
      ...Array.from(generated()),
    ];
    for (const run of hostile) {
      const d = evaluateRunPrune(run as RunRetentionFacts, NOW, DAYS);
      expect(RUN_PRUNE_REASONS).toContain(d.reason);
      expect(typeof d.prune).toBe('boolean');
    }
  });

  test('PURITY: identical inputs give identical results and the input is not mutated', () => {
    const run: RunRetentionFacts = {
      status: 'live', createdAt: ago(200 * DAY), launchedAt: ago(200 * DAY), updatedAt: ago(200 * DAY),
    };
    const snapshot = JSON.stringify(run);
    const a = evaluateRunPrune(run, NOW, DAYS);
    const b = evaluateRunPrune(run, NOW, DAYS);
    expect(a).toEqual(b);
    expect(JSON.stringify(run)).toBe(snapshot);
  });

  test('a blank piiPrunedAt is not a tombstone (it must not block a real prune)', () => {
    const d = evaluateRunPrune({
      status: 'live', createdAt: ago(200 * DAY), piiPrunedAt: '   ',
    }, NOW, DAYS);
    expect(d.prune).toBe(true);
  });
});

describe('parseRunPath — no identifier may ever reach a Storage prefix blank', () => {
  test('parses a well-formed run path', () => {
    expect(parseRunPath('users/o1/games/g1/runs/r1')).toEqual({
      ownerUid: 'o1', gameId: 'g1', runId: 'r1',
    });
  });

  test.each([
    ['users/o1/games/g1', 'too short'],
    ['users/o1/games/g1/runs/r1/teams/t1', 'too long'],
    ['users/o1/games/g1/teams/r1', 'not a runs path'],
    ['users//games/g1/runs/r1', 'blank ownerUid'],
    ['users/o1/games//runs/r1', 'blank gameId'],
    ['users/o1/games/g1/runs/', 'blank runId'],
    ['', 'empty'],
  ])('rejects %s (%s)', (path) => {
    expect(parseRunPath(path)).toBeNull();
  });

  test('the abandonable statuses are exactly the non-finished ones', () => {
    expect([...ABANDONABLE_RUN_STATUSES].sort()).toEqual(['draft', 'live']);
  });
});

// Pure-logic suite for TEST MODE (change: test-mode-hidden-scoring).
//
// Test mode seals every score and right/wrong signal from the PARTICIPANT while
// leaving the creator/staff view untouched. Three pure pieces carry that:
//
//   sealsScoreFromParticipant  the ONE place `Game.testMode` is interpreted, so
//                              functions / creator-web / play-web cannot drift.
//   sanitizeTeamForParticipant the projection that actually seals the payload.
//                              getMyTeamState returns the team document WHOLE,
//                              so this is the security boundary — not the UI.
//   accuracySkillRatio         routing strength derived from ACCURACY, because
//                              once a wrong answer completes a task, pace stops
//                              measuring competence (a fast-and-wrong player
//                              would otherwise be routed the HARDEST tasks).
//
// DOM-free, emulator-free; run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-test-mode.ts
import {
  sealsScoreFromParticipant,
  sanitizeTeamForParticipant,
  accuracySkillRatio,
  boundStoredAnswer,
  MAX_STORED_ANSWER_LEN,
} from '../packages/shared/src/testMode';
import type { Game, RunTeam } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (o: unknown) => Object.keys(o as object).sort();

// ─────────────────────────────────────────────────────────────────────────────
// 1. sealsScoreFromParticipant — the single interpretation of the setting
// ─────────────────────────────────────────────────────────────────────────────
const g = (over: Record<string, unknown> = {}) => ({ id: 'g', title: 't', ...over } as unknown as Game);

check('testMode true seals', sealsScoreFromParticipant(g({ testMode: true })) === true);
check('testMode false does NOT seal', sealsScoreFromParticipant(g({ testMode: false })) === false);
check('testMode absent does NOT seal (every game authored before this change)',
  sealsScoreFromParticipant(g()) === false);
check('testMode null does NOT seal', sealsScoreFromParticipant(g({ testMode: null })) === false);
// Only the boolean `true` seals. A truthy string must NOT — a hand-edited or
// legacy document is not consent to seal a live run.
check('testMode "true" (string) does NOT seal', sealsScoreFromParticipant(g({ testMode: 'true' })) === false);
check('testMode 1 does NOT seal', sealsScoreFromParticipant(g({ testMode: 1 })) === false);

// Total: a missing/!bad game must yield a boolean, never throw. Callers include
// routing and a callable hot path, where a throw would break the run.
let threw = false;
try {
  sealsScoreFromParticipant(undefined as unknown as Game);
  sealsScoreFromParticipant(null as unknown as Game);
  sealsScoreFromParticipant('nonsense' as unknown as Game);
} catch { threw = true; }
check('never throws on a malformed / absent game', !threw);
check('returns a boolean for a malformed game',
  sealsScoreFromParticipant(null as unknown as Game) === false);

// ─────────────────────────────────────────────────────────────────────────────
// 2. sanitizeTeamForParticipant — the payload seal
// ─────────────────────────────────────────────────────────────────────────────
// A team carrying EVERY field the seal must consider, plus an unknown one: the
// projection is an allow-list built by construction, so a field added to RunTeam
// next year must be ABSENT until someone deliberately allows it. A delete-list
// would expose it by default — which is exactly how `wasCorrect` would leak.
const fullTeam = {
  id: 'team-1',
  displayName: 'Team One',
  status: 'active',
  launched: true,
  score: 420,
  bonusPenalty: 15,
  smartStreak: 3,
  streakMultiplier: 1.5,
  taskAttempts: { 'task-1': 2 },
  powerUps: [{ kind: 'double', armed: true }],
  deviceJoinCode: 'ABC123',
  deviceUids: ['uid-1'],
  controllerUid: 'uid-1',
  held: false,
  heldReason: '',
  outOfBounds: false,
  answerPenalties: { 'task-1': { charged: 10, lastHash: 'abc', cooldownUntil: 0 } },
  stages: [{
    stageId: 's1',
    order: 0,
    status: 'active',
    tasks: [{
      taskId: 'task-1',
      taskIndex: 0,
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:00.000Z',
      actualMinutes: 5,
      earnedScore: 100,
      scoreBreakdown: { total: 100, base: 80, speedBonus: 20 },
      submittedAnswer: 'the player typed this',
      wasCorrect: false,
      // Recorded submissions (change: post-run-player-report). Present on EVERY
      // run now, not just a sealed one — which is exactly why it has to be pinned
      // here: a per-question wrong-answer history is the single most revealing
      // thing test mode withholds, and it rides the same document.
      answerLog: [
        { at: '2026-01-01T00:04:30.000Z', answer: 'first guess', correct: false, kind: 'answer' },
        { at: '2026-01-01T00:05:00.000Z', answer: 'the player typed this', correct: false, kind: 'answer' },
      ],
      arrivedAt: '2026-01-01T00:04:00.000Z',
    }],
  }],
  unknownFutureField: 'must never reach a participant',
} as unknown as RunTeam;

const sealed = sanitizeTeamForParticipant(fullTeam, true);
const open = sanitizeTeamForParticipant(fullTeam, false);

// The scoring fields: gone when sealed, intact when not.
for (const k of ['score', 'bonusPenalty', 'smartStreak', 'streakMultiplier']) {
  check(`sealed team omits ${k}`, !(k in (sealed as object)));
  check(`open team keeps ${k}`, k in (open as object));
}
const sealedRec = (sealed as RunTeam).stages[0].tasks[0] as Record<string, unknown>;
const openRec = (open as RunTeam).stages[0].tasks[0] as Record<string, unknown>;
for (const k of ['earnedScore', 'scoreBreakdown']) {
  check(`sealed record omits ${k}`, !(k in sealedRec));
  check(`open record keeps ${k}`, k in openRec);
}

// The whole point of the feature: a stored verdict must never reach ANY
// participant, in ANY game. Sealed-only would leak it on every normal run.
for (const k of ['submittedAnswer', 'wasCorrect', 'answerLog']) {
  check(`sealed record omits ${k}`, !(k in sealedRec));
  check(`OPEN record also omits ${k} (never participant-visible, in any game)`, !(k in openRec));
}
// Belt and braces: the recorded text must not survive ANYWHERE in the payload,
// not just as a top-level key on the record we happen to inspect.
check('no recorded answer text appears anywhere in the sealed payload',
  !JSON.stringify(sealed).includes('first guess'));
check('no recorded answer text appears anywhere in the OPEN payload',
  !JSON.stringify(open).includes('first guess'));

// Allow-list by construction, not a delete-list.
check('unknown team field is dropped when sealed', !('unknownFutureField' in (sealed as object)));
check('unknown team field is dropped when OPEN too', !('unknownFutureField' in (open as object)));

// Progress the participant legitimately needs survives both modes.
for (const k of ['id', 'displayName', 'status', 'stages']) {
  check(`sealed team keeps ${k}`, k in (sealed as object));
}
for (const k of ['taskId', 'status', 'startedAt', 'completedAt']) {
  check(`sealed record keeps ${k}`, k in sealedRec);
}
check('sealed record keeps arrivedAt (the hidden-task arrival latch)', 'arrivedAt' in sealedRec);

// Exact key-set pins. Adding a field to the projection without deciding about it
// fails here, which is the guard the design asks for.
// The pin is on the SEALED-ONLY set rather than the whole key list: the value of
// the guard is that a scoring field cannot quietly rejoin the payload, and pinning
// all 30-odd always-visible keys would just be a change-detector that gets updated
// reflexively. `taskAttempts`/`answerPenalties` are in here because a per-task
// wrong-answer count names exactly which questions were missed.
const SEALED_ONLY = ['score', 'bonusPenalty', 'smartStreak', 'streakMultiplier',
  'powerUps', 'taskAttempts', 'answerPenalties'];
check('every sealed-only field is absent when sealed',
  SEALED_ONLY.every((k) => !(k in (sealed as object))),
  SEALED_ONLY.filter((k) => k in (sealed as object)).join(','));
check('every sealed-only field is present when NOT sealed',
  SEALED_ONLY.every((k) => k in (open as object)),
  SEALED_ONLY.filter((k) => !(k in (open as object))).join(','));
// The sealed key set is a strict subset of the open one — sealing may only ever
// REMOVE, never add or rename.
check('sealing only ever removes keys',
  keysOf(sealed).every((k) => keysOf(open).includes(k)),
  keysOf(sealed).filter((k) => !keysOf(open).includes(k)).join(','));
// Fields the multi-phone / safety / hold UI cannot work without. Dropping any of
// them broke a dozen e2e scenarios the first time this projection was written.
for (const k of ['deviceJoinCode', 'deviceUids', 'controllerUid', 'held', 'heldReason', 'outOfBounds']) {
  check(`sealed team keeps ${k} (the UI breaks without it)`, k in (sealed as object));
}
check('sealed record key set is exactly as specified',
  eq(keysOf(sealedRec), ['actualMinutes', 'arrivedAt', 'completedAt', 'startedAt', 'status', 'taskId', 'taskIndex']),
  keysOf(sealedRec).join(','));

// Totality: a malformed team must not take down getMyTeamState.
let sanThrew = false;
try {
  sanitizeTeamForParticipant(undefined as unknown as RunTeam, true);
  sanitizeTeamForParticipant({} as RunTeam, true);
  sanitizeTeamForParticipant({ stages: 'not-an-array' } as unknown as RunTeam, true);
  sanitizeTeamForParticipant({ stages: [{ tasks: null }] } as unknown as RunTeam, true);
} catch { sanThrew = true; }
check('sanitize never throws on a malformed team', !sanThrew);
check('a team with no stages yields an empty stage array',
  eq((sanitizeTeamForParticipant({} as RunTeam, true) as RunTeam).stages, []));

// ─────────────────────────────────────────────────────────────────────────────
// 3. accuracySkillRatio — strength from accuracy, not pace
// ─────────────────────────────────────────────────────────────────────────────
// Maps accuracy a -> 1 - 2a, chosen so adaptiveDifficultyMatch (which targets
// -skillRatio) is reused UNCHANGED: all-correct -> -1 -> hardest,
// all-wrong -> +1 -> easiest, even split -> 0 -> the same neutral value a team
// already has before its first task.
const recs = (...flags: (boolean | undefined | string)[]) =>
  flags.map((wasCorrect, i) => ({ taskId: `t${i}`, taskIndex: i, status: 'completed', wasCorrect })) as never;

check('all correct -> -1 (route the hardest)', accuracySkillRatio(recs(true, true, true)) === -1);
check('all wrong -> +1 (route the easiest)', accuracySkillRatio(recs(false, false, false)) === 1);
check('even split -> 0 (neutral)', accuracySkillRatio(recs(true, false)) === 0);
check('3 of 4 correct -> -0.5', accuracySkillRatio(recs(true, true, true, false)) === -0.5);
check('1 of 4 correct -> +0.5', accuracySkillRatio(recs(true, false, false, false)) === 0.5);

// No evidence must be NULL, not 0: the caller falls back to today's behaviour
// rather than this function inventing a verdict from nothing.
check('no records -> null', accuracySkillRatio([] as never) === null);
check('undefined records -> null', accuracySkillRatio(undefined as never) === null);
check('records with no wasCorrect -> null (unanswered work is not evidence)',
  accuracySkillRatio(recs(undefined, undefined)) === null);
check('non-boolean wasCorrect is excluded',
  accuracySkillRatio(recs('yes', true)) === -1, String(accuracySkillRatio(recs('yes', true))));
check('mixed answered + unanswered counts only the answered',
  accuracySkillRatio(recs(true, undefined, false)) === 0);

// Range invariant — the value feeds a difficulty match; a NaN or out-of-range
// ratio would silently scramble routing for the whole run.
let rangeBad = 0;
for (let n = 1; n <= 12; n++) {
  for (let correct = 0; correct <= n; correct++) {
    const flags = Array.from({ length: n }, (_, i) => i < correct);
    const r = accuracySkillRatio(recs(...flags));
    if (r === null || !Number.isFinite(r) || r < -1 || r > 1) rangeBad++;
  }
}
check('ratio is always finite and within [-1, 1] across 91 samples', rangeBad === 0, `${rangeBad} bad`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. boundStoredAnswer — a hostile client must not grow the team document
// ─────────────────────────────────────────────────────────────────────────────
check('short answer is preserved', boundStoredAnswer('42') === '42');
check('answer is trimmed', boundStoredAnswer('  42  ') === '42');
check('long answer is clamped to the ceiling',
  boundStoredAnswer('x'.repeat(MAX_STORED_ANSWER_LEN + 500)).length === MAX_STORED_ANSWER_LEN);
check('ceiling matches the surveyResponse bound already in use', MAX_STORED_ANSWER_LEN === 500);
check('non-string input yields undefined, never a throw', boundStoredAnswer(42 as never) === undefined);
check('undefined input yields undefined', boundStoredAnswer(undefined as never) === undefined);
check('empty / whitespace-only yields undefined', boundStoredAnswer('   ') === undefined);

console.log(`\n${failures === 0 ? 'ALL TEST-MODE TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

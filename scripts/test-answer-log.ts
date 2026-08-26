// Pure-logic suite for the ANSWER LOG (change: post-run-player-report).
//
// What a participant submitted is now recorded on EVERY run, not only on a
// testMode game — see openspec/changes/post-run-player-report/design.md D1-D2, D4.
// Three properties matter enough to be pinned here rather than discovered in
// production:
//
//   1. BOUNDED. The log is the only field on the team document whose SIZE a
//      client chooses (one entry per submission). Uncapped, a device firing wrong
//      answers walks the document toward Firestore's 1 MB limit and takes the
//      whole team's run down with it.
//   2. TOTAL. `appendAnswerLog` runs INSIDE the transaction that grades and scores
//      the submission. A throw there fails a legitimate answer — so a malformed
//      stored log, a non-string answer or a null entry must degrade, never throw.
//   3. LOSSLESS WHERE IT COUNTS. When the cap bites, the entries a creator
//      actually wants are the FIRST guess and the one that finally landed, so the
//      drop comes from the MIDDLE — not from either end.
//
// Plus the 30-day retention boundary: `stripAnswerLogsFromStages` destroys the
// free-typed text and NOTHING else (scores, verdicts and timings survive), and the
// eligibility decision reuses the fail-closed `evaluateRunPrune` predicate so the
// 30-day sweep and the 90-day PII sweep cannot drift apart.
//
// DOM-free, emulator-free; run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-answer-log.ts
import {
  buildAnswerLogEntry,
  appendAnswerLog,
  stripAnswerLogsFromStages,
  MAX_ANSWER_LOG_ENTRIES,
  MAX_ANSWER_LOG_ANSWER_LEN,
  ANSWER_LOG_RETENTION_DAYS,
  type AnswerLogEntry,
} from '../packages/shared/src/answerLog';
import { evaluateRunPrune } from '../functions/src/maintenance/runRetention';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const AT = '2026-08-26T10:00:00.000Z';
const entry = (answer: string, correct?: boolean, at = AT): AnswerLogEntry =>
  buildAnswerLogEntry({ kind: 'answer', answer, correct, at })!;

// ── 1. buildAnswerLogEntry: bounding + rejection ─────────────────────────────

check('trims surrounding whitespace',
  buildAnswerLogEntry({ kind: 'answer', answer: '  ירושלים  ', at: AT })?.answer === 'ירושלים');

check(`truncates to MAX_ANSWER_LOG_ANSWER_LEN (${MAX_ANSWER_LOG_ANSWER_LEN})`,
  buildAnswerLogEntry({ kind: 'answer', answer: 'x'.repeat(MAX_ANSWER_LOG_ANSWER_LEN + 500), at: AT })
    ?.answer.length === MAX_ANSWER_LOG_ANSWER_LEN);

check('keeps a Hebrew answer intact',
  buildAnswerLogEntry({ kind: 'answer', answer: 'תל אביב', at: AT })?.answer === 'תל אביב');

check('records the verdict it is given (false is not dropped)',
  buildAnswerLogEntry({ kind: 'answer', answer: 'no', correct: false, at: AT })?.correct === false);

check('omits `correct` entirely when there is no right answer',
  !('correct' in (buildAnswerLogEntry({ kind: 'survey', answer: 'כיף', at: AT }) as object)));

check('carries stepIndex for a sequence step',
  buildAnswerLogEntry({ kind: 'sequence_step', answer: 'a', correct: true, stepIndex: 2, at: AT })
    ?.stepIndex === 2);

check('omits stepIndex when none was given',
  !('stepIndex' in (buildAnswerLogEntry({ kind: 'answer', answer: 'a', at: AT }) as object)));

check('empty answer -> null (record nothing)',
  buildAnswerLogEntry({ kind: 'answer', answer: '', at: AT }) === null);
check('whitespace-only answer -> null',
  buildAnswerLogEntry({ kind: 'answer', answer: '   \n ', at: AT }) === null);
check('non-string answer -> null',
  buildAnswerLogEntry({ kind: 'answer', answer: 42 as never, at: AT }) === null);
check('null answer -> null',
  buildAnswerLogEntry({ kind: 'answer', answer: null as never, at: AT }) === null);
check('missing `at` -> null (an unstamped entry is not usable evidence)',
  buildAnswerLogEntry({ kind: 'answer', answer: 'a', at: '' as never }) === null);

// ── 2. appendAnswerLog: the cap and the middle-drop rule ─────────────────────

check('appends to an absent log',
  eq(appendAnswerLog(undefined, entry('one')).map((e) => e.answer), ['one']));

check('appends in submission order',
  eq(appendAnswerLog(appendAnswerLog(undefined, entry('a')), entry('b')).map((e) => e.answer),
    ['a', 'b']));

// Fill exactly to the cap, then push two more.
let log: AnswerLogEntry[] = [];
for (let i = 1; i <= MAX_ANSWER_LOG_ENTRIES; i++) log = appendAnswerLog(log, entry(`g${i}`));
check(`holds exactly MAX_ANSWER_LOG_ENTRIES (${MAX_ANSWER_LOG_ENTRIES}) at the cap`,
  log.length === MAX_ANSWER_LOG_ENTRIES);
check('nothing dropped before the cap is exceeded',
  eq(log.map((e) => e.answer),
    Array.from({ length: MAX_ANSWER_LOG_ENTRIES }, (_, i) => `g${i + 1}`)));

const over = appendAnswerLog(log, entry('WINNER'));
check('stays at the cap once exceeded', over.length === MAX_ANSWER_LOG_ENTRIES);
check('the FIRST guess survives the drop', over[0].answer === 'g1');
check('the NEWEST entry survives the drop',
  over[over.length - 1].answer === 'WINNER');
check('the drop comes from the MIDDLE, not either end',
  eq(over.map((e) => e.answer),
    [...Array.from({ length: MAX_ANSWER_LOG_ENTRIES - 1 }, (_, i) => `g${i + 1}`), 'WINNER']));

const over2 = appendAnswerLog(over, entry('LATER'));
check('a second overflow still keeps first + newest',
  over2.length === MAX_ANSWER_LOG_ENTRIES
  && over2[0].answer === 'g1'
  && over2[over2.length - 1].answer === 'LATER');

// ── 3. appendAnswerLog: totality (it runs inside a grading transaction) ──────

check('null entry -> log returned unchanged',
  eq(appendAnswerLog([entry('a')], null), [entry('a')]));
check('null entry on an absent log -> []', eq(appendAnswerLog(undefined, null), []));
check('non-array existing log is discarded, not thrown on',
  eq(appendAnswerLog({ nope: true } as never, entry('a')).map((e) => e.answer), ['a']));
check('a string existing log is discarded',
  eq(appendAnswerLog('corrupt' as never, entry('a')).map((e) => e.answer), ['a']));
check('non-object members of an existing log are dropped',
  eq(appendAnswerLog([null, 'x', 7, entry('keep')] as never, entry('new')).map((e) => e.answer),
    ['keep', 'new']));
check('appending never mutates the input array', (() => {
  const before: AnswerLogEntry[] = [entry('a')];
  appendAnswerLog(before, entry('b'));
  return before.length === 1;
})());

// ── 4. stripAnswerLogsFromStages: destroy the text, keep everything else ─────

const stagesWithLogs = () => ([
  {
    stageId: 's1', order: 0, status: 'completed', startedAt: AT, completedAt: AT,
    requiredTaskCount: 2, earnedScore: 30,
    tasks: [
      {
        taskId: 't1', taskIndex: 0, status: 'completed', startedAt: AT, completedAt: AT,
        actualMinutes: 4, earnedScore: 10, excludedMs: 0,
        submittedAnswer: 'תל אביב', wasCorrect: true,
        answerLog: [entry('ירושלים', false), entry('תל אביב', true)],
      },
      {
        taskId: 't2', taskIndex: 1, status: 'skipped', earnedScore: 0,
        answerLog: [entry('guess', false)],
      },
      { taskId: 't3', taskIndex: 2, status: 'pending' },
    ],
  },
] as never);

const stripped = stripAnswerLogsFromStages(stagesWithLogs());
check('reports how many logs it removed', stripped.removed === 2);
check('no answerLog key survives anywhere',
  JSON.stringify(stripped.stages).includes('answerLog') === false);
check('scores, verdicts and timings are untouched', eq(
  stripped.stages,
  JSON.parse(JSON.stringify(stagesWithLogs()).replace(
    /,"answerLog":\[[^\]]*\]/g, '')),
));
check('submittedAnswer / wasCorrect are NOT collateral damage', (() => {
  const t = (stripped.stages as never as { tasks: Record<string, unknown>[] }[])[0].tasks[0];
  return t.submittedAnswer === 'תל אביב' && t.wasCorrect === true;
})());
check('idempotent: a second strip removes nothing',
  stripAnswerLogsFromStages(stripped.stages).removed === 0);
check('a stage array with no logs is reported as 0 removed',
  stripAnswerLogsFromStages([{ stageId: 's', order: 0, status: 'pending', tasks: [] }] as never)
    .removed === 0);

// Totality — this runs over documents nobody validated on the way in.
check('undefined stages -> empty, no throw',
  eq(stripAnswerLogsFromStages(undefined as never), { stages: [], removed: 0 }));
check('non-array stages -> empty, no throw',
  eq(stripAnswerLogsFromStages({ a: 1 } as never), { stages: [], removed: 0 }));
check('a stage with no tasks array survives', (() => {
  const r = stripAnswerLogsFromStages([{ stageId: 's', order: 0 }] as never);
  return r.removed === 0 && Array.isArray(r.stages) && r.stages.length === 1;
})());
check('null members of stages/tasks do not throw',
  stripAnswerLogsFromStages([null, { tasks: [null, { answerLog: [entry('x')] }] }] as never)
    .removed === 1);

// ── 5. Retention: 30 days, decided by the SAME predicate the PII sweep uses ──
//
// D4: the answer-log sweep passes `answerLogPrunedAt` into the tombstone slot and
// `ANSWER_LOG_RETENTION_DAYS` as the window, so every fail-closed rule
// (finalized-anchors-on-finishedAt, unfinalized-anchors-on-the-maximum, clock-skew
// refusal) is inherited rather than re-implemented.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-26T00:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const decide = (facts: Record<string, unknown>) =>
  evaluateRunPrune(facts as never, NOW, ANSWER_LOG_RETENTION_DAYS);

check('retention window is 30 days', ANSWER_LOG_RETENTION_DAYS === 30);

const justUnder = decide({ status: 'finished', finishedAt: iso(30 * DAY - 1), createdAt: iso(90 * DAY) });
check('1 ms before the boundary: keep', justUnder.prune === false && justUnder.reason === 'within_retention');

const atBoundary = decide({ status: 'finished', finishedAt: iso(30 * DAY), createdAt: iso(90 * DAY) });
check('exactly at the boundary: strip', atBoundary.prune === true);

check('a run finished 3 days ago is untouched',
  decide({ status: 'finished', finishedAt: iso(3 * DAY), createdAt: iso(3 * DAY) }).prune === false);

check('the answerLogPrunedAt tombstone stops a re-strip', (() => {
  const d = decide({
    status: 'finished', finishedAt: iso(60 * DAY), createdAt: iso(60 * DAY),
    piiPrunedAt: iso(1 * DAY), // the sweep substitutes answerLogPrunedAt into this slot
  });
  return d.prune === false && d.reason === 'already_pruned';
})());

check('a blank tombstone is not a tombstone',
  decide({ status: 'finished', finishedAt: iso(60 * DAY), piiPrunedAt: '   ' }).prune === true);

check('an unfinalized run anchors on the MAXIMUM: one recent write vetoes the strip',
  decide({ status: 'live', createdAt: iso(120 * DAY), launchedAt: iso(120 * DAY), updatedAt: iso(2 * DAY) })
    .prune === false);

check('an abandoned run with no recent activity IS stripped',
  decide({ status: 'live', createdAt: iso(120 * DAY), launchedAt: iso(120 * DAY), updatedAt: iso(119 * DAY) })
    .prune === true);

check('a future timestamp fails closed',
  decide({ status: 'finished', finishedAt: new Date(NOW.getTime() + DAY).toISOString() }).prune === false);

check('no usable timestamp fails closed',
  decide({ status: 'finished' }).prune === false);

check('the 30-day window is SHORTER than the PII window: a 40-day run strips answers but not PII',
  decide({ status: 'finished', finishedAt: iso(40 * DAY) }).prune === true
  && evaluateRunPrune({ status: 'finished', finishedAt: iso(40 * DAY) } as never, NOW).prune === false);

// ── 6. Invariants over every entry this suite built ─────────────────────────

const built = [
  buildAnswerLogEntry({ kind: 'answer', answer: 'a', correct: true, at: AT }),
  buildAnswerLogEntry({ kind: 'ordering', answer: '["a","b"]', correct: false, at: AT }),
  buildAnswerLogEntry({ kind: 'sequence_step', answer: 'x', correct: true, stepIndex: 0, at: AT }),
  buildAnswerLogEntry({ kind: 'station_code', answer: '4763', correct: true, at: AT }),
  buildAnswerLogEntry({ kind: 'survey', answer: 'היה כיף', at: AT }),
].filter((e): e is AnswerLogEntry => e !== null);
check('every kind builds an entry', built.length === 5);
check('no entry ever exceeds the length bound',
  built.every((e) => e.answer.length <= MAX_ANSWER_LOG_ANSWER_LEN));
check('no entry carries an undefined key (Firestore rejects undefined)',
  built.every((e) => Object.values(e).every((v) => v !== undefined)));

console.log(`\n${failures === 0 ? 'ALL ANSWER-LOG TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

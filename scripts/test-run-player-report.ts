// Pure-logic suite for the PER-PLAYER RUN REPORT (change: post-run-player-report).
//
// `buildRunPlayerReport` is what a creator sees after the event and what the Excel
// export is built from — so it is a function of the STORED game / run / team
// documents and of nothing else. Two properties are pinned hard here:
//
//  1. TOTAL. It walks documents nobody validated on the way in, from runs that may
//     be months old and games that have been edited since. A malformed team, a
//     stage with no tasks, a task record naming a mission that has been deleted, a
//     non-finite score — each must degrade to a sane row. One bad document must
//     not deny the owner the whole report, because there is no other way to get it.
//
//  2. HONEST ABOUT MISSING DATA. There are three different reasons an answer cell
//     can be empty and the report MUST distinguish them: the mission never had an
//     answer channel (a check-in), the player never got there (pending/skipped), or
//     the answer was never recorded / has passed the 30-day retention window. An
//     ambiguous blank would make a legacy run look like every player answered
//     nothing.
//
// Ranking is taken from the stored leaderboard when one exists, so the report and
// the standings the players actually saw cannot disagree — the same live/final
// parity rule the rest of the scoring path follows.
//
// DOM-free, emulator-free; run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-run-player-report.ts
import { buildRunPlayerReport } from '../packages/shared/src/runPlayerReport';
import type { Game, Run, RunTeam } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const T0 = '2026-08-20T09:00:00.000Z';
const T1 = '2026-08-20T09:05:00.000Z';
const T2 = '2026-08-20T09:12:00.000Z';

// ── Fixtures ────────────────────────────────────────────────────────────────
// One game covering every answer channel the report has to classify.

const game = {
  id: 'g1',
  title: 'ציד האוצר בעיר העתיקה',
  stages: [{
    id: 's1', title: 'שלב ראשון', order: 0,
    tasks: [
      { id: 'q1', title: 'שאלת טריוויה', type: 'quiz', description: 'מהי בירת ישראל?', answers: ['ירושלים'] },
      { id: 'n1', title: 'כמה מדרגות', type: 'numeric', description: 'ספרו את המדרגות', numericAnswer: 42, numericTolerance: 1 },
      { id: 'o1', title: 'סדרו לפי גודל', type: 'quiz', orderItems: ['א', 'ב', 'ג'] },
      { id: 'f1', title: 'הגיעו לכיכר', type: 'field', description: 'צ׳ק אין בכיכר' },
      { id: 'p1', title: 'צלמו סלפי', type: 'photo' },
      { id: 'sv1', title: 'איך היה?', type: 'survey', surveyChoices: ['כיף', 'בסדר'] },
      { id: 'st1', title: 'קוד התחנה', type: 'smart_station' },
      { id: 'sq1', title: 'שלושה שלבים', type: 'sequence', steps: [{ id: 'x', prompt: 'א', answer: 'a' }] },
      { id: 'gf1', title: 'גדר וירטואלית', type: 'geofence' },
    ],
  }],
} as unknown as Game;

const run = {
  id: 'r1', gameId: 'g1', ownerUid: 'owner', status: 'finished',
  accessCode: 'ABCD12', launchedAt: T0, finishedAt: T2,
  leaderboard: {
    frozen: true, published: true, updatedAt: T2,
    rankings: [
      { rank: 1, teamId: 'teamB', teamName: 'כחולים', score: 200, completedStages: 1 },
      { rank: 2, teamId: 'teamA', teamName: 'אדומים', score: 120, completedStages: 1 },
    ],
  },
} as unknown as Run;

const rec = (over: Record<string, unknown>) => ({ taskIndex: 0, status: 'completed', ...over });

const teamA = {
  id: 'teamA', displayName: 'אדומים', memberNames: ['דנה', 'יואב'], memberCount: 2,
  status: 'finished', score: 120, bonusPenalty: 25, launched: true,
  startedAt: T0, finishedAt: T1,
  taskHintsUsed: ['q1'],
  taskAttempts: { q1: 2 },
  taskSubmissions: { p1: { photoUrl: 'https://api.rush-point.com/m/p1.jpg', status: 'approved', mediaKind: 'photo', submittedAt: T1 } },
  stages: [{
    stageId: 's1', order: 0, status: 'completed',
    tasks: [
      rec({
        taskId: 'q1', earnedScore: 50, actualMinutes: 4, startedAt: T0, completedAt: T1,
        answerLog: [
          { at: T0, answer: 'תל אביב', correct: false, kind: 'answer' },
          { at: T1, answer: 'ירושלים', correct: true, kind: 'answer' },
        ],
      }),
      // A mission completed BEFORE answers were recorded: no log, no submittedAnswer.
      rec({ taskId: 'n1', earnedScore: 30, actualMinutes: 2 }),
      // A check-in: no answer channel at all, and no log is expected.
      rec({ taskId: 'f1', earnedScore: 20, actualMinutes: 1 }),
      // Photo: media is the submission, not text.
      rec({ taskId: 'p1', earnedScore: 20, photoUrl: 'https://api.rush-point.com/m/p1.jpg', verificationOutcome: 'approved' }),
      // Survey: an answer with no verdict.
      rec({ taskId: 'sv1', earnedScore: 0, surveyResponse: 'כיף', answerLog: [{ at: T1, answer: 'כיף', kind: 'survey' }] }),
      // Skipped: never answered, and that is not "unavailable".
      rec({ taskId: 'o1', status: 'skipped', earnedScore: 0 }),
      // Still open when the run ended.
      rec({ taskId: 'gf1', status: 'pending' }),
    ],
  }],
} as unknown as RunTeam;

const teamB = {
  id: 'teamB', displayName: 'כחולים', memberNames: ['נועה'], memberCount: 1,
  status: 'finished', score: 200, bonusPenalty: 0, launched: true,
  startedAt: T0, finishedAt: T2,
  stages: [{
    stageId: 's1', order: 0, status: 'completed',
    tasks: [
      rec({
        taskId: 'q1', earnedScore: 60, actualMinutes: 6,
        answerLog: [{ at: T1, answer: 'ירושלים', correct: true, kind: 'answer' }],
      }),
      rec({
        taskId: 'st1', earnedScore: 40, actualMinutes: 2,
        answerLog: [{ at: T1, answer: '4763', correct: true, kind: 'station_code' }],
      }),
      rec({
        taskId: 'sq1', earnedScore: 40, actualMinutes: 3,
        answerLog: [
          { at: T0, answer: 'a', correct: true, kind: 'sequence_step', stepIndex: 0 },
          { at: T1, answer: 'b', correct: true, kind: 'sequence_step', stepIndex: 1 },
        ],
      }),
    ],
  }],
} as unknown as RunTeam;

const report = buildRunPlayerReport({ game, run, teams: [teamA, teamB] });
const rowFor = (teamId: string, taskId: string) =>
  report.answers.find((a) => a.teamId === teamId && a.taskId === taskId)!;
const playerFor = (teamId: string) => report.players.find((p) => p.teamId === teamId)!;

// ── 1. Shape ────────────────────────────────────────────────────────────────

check('one player row per team', report.players.length === 2);
check('one answer row per stored task record',
  report.answers.length === teamA.stages[0].tasks.length + teamB.stages[0].tasks.length);
check('meta names the run', report.meta.runId === 'r1' && report.meta.gameId === 'g1');
check('meta carries the game title', report.meta.gameTitle === 'ציד האוצר בעיר העתיקה');
check('meta carries the player count', report.meta.playerCount === 2);
check('meta discloses the answer retention window', report.meta.answerRetentionDays === 30);

// ── 2. Player rows ──────────────────────────────────────────────────────────

const a = playerFor('teamA');
check('player name comes from displayName', a.playerName === 'אדומים');
check('member names are carried', a.memberNames.join(',') === 'דנה,יואב');
check('score is carried', a.score === 120);
check('bonusPenalty is carried', a.bonusPenalty === 25);
check('completed missions counted', a.missionsCompleted === 5);
check('skipped missions counted', a.missionsSkipped === 1);
check('hints counted', a.hintsUsed === 1);
check('media counted', a.mediaCount === 1);
check('wrong answers counted from the recorded log', a.wrongAnswers === 1);
check('recorded answers counted', a.answersRecorded === 3);
check('duration derived from the stored start/finish, not a clock',
  a.durationMinutes === 5);

// ── 3. Ranking mirrors the stored leaderboard ───────────────────────────────

check('rank comes from the stored leaderboard', playerFor('teamB').rank === 1 && a.rank === 2);
check('a finalized run is not flagged provisional', report.meta.rankingProvisional === false);
check('players are ordered by rank', report.players[0].teamId === 'teamB');

const noBoard = buildRunPlayerReport({
  game, run: { ...run, leaderboard: undefined } as unknown as Run, teams: [teamA, teamB],
});
check('with no leaderboard the ranking is flagged provisional',
  noBoard.meta.rankingProvisional === true);
check('provisional ranking still orders by score',
  noBoard.players[0].teamId === 'teamB' && noBoard.players[0].rank === 1);
check('provisional ranking breaks a score tie by finish time', (() => {
  const tie = buildRunPlayerReport({
    game, run: { ...run, leaderboard: undefined } as unknown as Run,
    teams: [
      { ...teamA, id: 'slow', score: 100, finishedAt: T2 } as unknown as RunTeam,
      { ...teamB, id: 'fast', score: 100, finishedAt: T1 } as unknown as RunTeam,
    ],
  });
  return tie.players[0].teamId === 'fast';
})());

// ── 4. The three reasons an answer cell is empty ────────────────────────────

const q1 = rowFor('teamA', 'q1');
check('a recorded quiz answer is present', q1.answers.length === 2);
check('recorded answers keep submission order',
  q1.answers[0].answer === 'תל אביב' && q1.answers[1].answer === 'ירושלים');
check('the verdicts recorded are carried through',
  q1.answers[0].correct === false && q1.answers[1].correct === true);
check('finalAnswer is the last recorded submission', q1.finalAnswer === 'ירושלים');
check('the row reports the mission as answered correctly', q1.correct === true);
check('a recorded row is not flagged unavailable', q1.answersUnavailable === false);
check('the authored question is carried for the owner', q1.question === 'מהי בירת ישראל?');
check('the answer key is carried for the owner', q1.expectedAnswer === 'ירושלים');
check('attempts are carried', q1.attempts === 2);
check('the paid hint is reported', q1.hintUsed === true);

const n1 = rowFor('teamA', 'n1');
check('a completed answerable mission with no record is flagged unavailable',
  n1.answersUnavailable === true);
check('an unavailable row still carries its score and status',
  n1.earnedScore === 30 && n1.status === 'completed');
check('an unavailable row has no invented answer', n1.finalAnswer === '');
// A numeric key without its tolerance is misleading — "42" reads as exact when
// anything from 41 to 43 was accepted, and the owner is reading this to decide
// whether a player was right.
check('a numeric answer key is rendered WITH its tolerance', n1.expectedAnswer === '42 ±1');
check('a zero-tolerance numeric key is rendered bare', (() => {
  const exact = buildRunPlayerReport({
    game: {
      ...game,
      stages: [{ ...game.stages[0], tasks: [{ id: 'n1', title: 'x', type: 'numeric', numericAnswer: 7 }] }],
    } as unknown as Game,
    run, teams: [teamA],
  });
  return exact.answers.find((r) => r.taskId === 'n1')!.expectedAnswer === '7';
})());

const f1 = rowFor('teamA', 'f1');
check('a check-in reports NO answer channel', f1.answerChannel === 'none');
check('a check-in is never flagged as an unavailable answer', f1.answersUnavailable === false);

const gf1 = rowFor('teamA', 'gf1');
check('a geofence mission reports no answer channel', gf1.answerChannel === 'none');

const o1 = rowFor('teamA', 'o1');
check('a SKIPPED mission is not flagged unavailable (they never answered)',
  o1.answersUnavailable === false);
check('a skipped mission keeps its status', o1.status === 'skipped');

// ── 5. Channel classification per mission type ──────────────────────────────

check('quiz -> answer channel', q1.answerChannel === 'answer');
check('numeric -> answer channel', n1.answerChannel === 'answer');
check('an ordering quiz -> ordering channel', o1.answerChannel === 'ordering');
check('survey -> survey channel', rowFor('teamA', 'sv1').answerChannel === 'survey');
check('smart_station -> station code channel', rowFor('teamB', 'st1').answerChannel === 'station_code');
check('sequence -> sequence channel', rowFor('teamB', 'sq1').answerChannel === 'sequence');
check('photo -> media channel, not a text answer', rowFor('teamA', 'p1').answerChannel === 'media');

const sv1 = rowFor('teamA', 'sv1');
check('a survey answer is reported', sv1.finalAnswer === 'כיף');
check('a survey has no right/wrong verdict', sv1.correct === null);

const p1 = rowFor('teamA', 'p1');
check('a photo row carries the media url', p1.mediaUrl.endsWith('/p1.jpg'));
check('a photo row carries the review outcome', p1.reviewStatus === 'approved');

const sq1 = rowFor('teamB', 'sq1');
check('sequence steps are all recorded', sq1.answers.length === 2);
check('sequence steps carry their index',
  sq1.answers[0].stepIndex === 0 && sq1.answers[1].stepIndex === 1);

// ── 6. Mission rollup ───────────────────────────────────────────────────────

const mission = (id: string) => report.missions.find((m) => m.taskId === id)!;
check('one mission row per mission the run touched', report.missions.length >= 9);
check('a mission names itself from the template', mission('q1').title === 'שאלת טריוויה');
check('completions are counted across players', mission('q1').completedBy === 2);
check('a completion rate is derived', Math.abs(mission('q1').completionRate - 1) < 1e-9);
check('a skipped mission is counted as skipped', mission('o1').skippedBy === 1);
check('wrong answers roll up per mission', mission('q1').wrongAnswerCount === 1);
check('a mission nobody touched is still listed with zeroes',
  mission('gf1').completedBy === 0);

// ── 7. Totality — the whole point ───────────────────────────────────────────

const brokenTeam = {
  id: 'broken', displayName: '', score: Number.NaN, bonusPenalty: undefined,
  // no stages array at all
} as unknown as RunTeam;

const withBroken = buildRunPlayerReport({ game, run, teams: [teamA, teamB, brokenTeam] });
check('a malformed team still yields a player row', withBroken.players.length === 3);
const b = withBroken.players.find((p) => p.teamId === 'broken')!;
check('a non-finite score is reported as 0', b.score === 0);
check('a nameless team still gets a usable label', b.playerName.length > 0);
check('the malformed team does not disturb the others',
  withBroken.players.find((p) => p.teamId === 'teamA')!.score === 120);

check('a task record naming a deleted mission is still reported', (() => {
  const orphan = {
    ...teamB, id: 'orphan',
    stages: [{ stageId: 's1', order: 0, status: 'completed', tasks: [rec({ taskId: 'GONE', earnedScore: 5 })] }],
  } as unknown as RunTeam;
  const r = buildRunPlayerReport({ game, run, teams: [orphan] });
  const row = r.answers.find((x) => x.taskId === 'GONE');
  return !!row && row.taskTitle.length > 0 && row.earnedScore === 5;
})());

check('a stage with no tasks array does not throw', (() => {
  const t = { ...teamA, id: 'nostages', stages: [{ stageId: 's1', order: 0 }] } as unknown as RunTeam;
  const r = buildRunPlayerReport({ game, run, teams: [t] });
  return r.players.length === 1 && r.answers.length === 0;
})());

check('null members of teams / stages / tasks do not throw', (() => {
  const t = { ...teamA, id: 'nulls', stages: [null, { tasks: [null, rec({ taskId: 'q1' })] }] } as unknown as RunTeam;
  const r = buildRunPlayerReport({ game, run, teams: [null as never, t] });
  return r.answers.some((x) => x.taskId === 'q1');
})());

check('no teams at all -> an empty but valid report', (() => {
  const r = buildRunPlayerReport({ game, run, teams: [] });
  return r.players.length === 0 && r.answers.length === 0 && r.meta.playerCount === 0;
})());

check('a missing game (pruned) still reports every stored record', (() => {
  const r = buildRunPlayerReport({ game: null, run, teams: [teamA] });
  return r.answers.length === teamA.stages[0].tasks.length
    && r.answers.every((x) => typeof x.taskTitle === 'string' && x.taskTitle.length > 0);
})());

check('a missing run still yields a report', (() => {
  const r = buildRunPlayerReport({ game, run: null, teams: [teamA] });
  return r.players.length === 1;
})());

check('everything is null/undefined -> an empty valid report', (() => {
  const r = buildRunPlayerReport({ game: null, run: null, teams: null as never });
  return r.players.length === 0 && r.answers.length === 0 && r.missions.length === 0;
})());

// ── 8. No clock, no hidden state ────────────────────────────────────────────

check('the builder is deterministic across calls', (() => {
  const one = JSON.stringify(buildRunPlayerReport({ game, run, teams: [teamA, teamB] }));
  const two = JSON.stringify(buildRunPlayerReport({ game, run, teams: [teamA, teamB] }));
  return one === two;
})());

check('the builder does not mutate its inputs', (() => {
  const snapshot = JSON.stringify({ game, run, teams: [teamA, teamB] });
  buildRunPlayerReport({ game, run, teams: [teamA, teamB] });
  return JSON.stringify({ game, run, teams: [teamA, teamB] }) === snapshot;
})());

check('every answer row carries a defined value for every column (no undefined cells)',
  report.answers.every((row) => Object.values(row).every((v) => v !== undefined)));
check('every player row carries a defined value for every column',
  report.players.every((row) => Object.values(row).every((v) => v !== undefined)));

console.log(`\n${failures === 0 ? 'ALL RUN-PLAYER-REPORT TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

// Pure-logic suite for the RUN REPORT SPREADSHEET (change: post-run-player-report).
//
// The creator's whole ask ends here: "export into Excel a table with each user and
// every answer they left". So the row model is separated from the library call and
// pinned, the same way `adminUsersExport.ts` keeps CSV escaping pure — a mistake in
// here is a file a human opens, misreads, and acts on.
//
// What matters, in order:
//
//  1. THE EMPTY CELL MUST NOT LIE. A blank answer cell has three causes and the
//     workbook has to say which: the mission had no answer channel, the player
//     never answered it, or the answer was never recorded (a run played before the
//     log shipped, or one past the 30-day window). Rendering all three as "" would
//     tell a creator their class answered nothing.
//  2. EVERY SUBMISSION, IN ORDER. The wrong guesses are the interesting half of an
//     educational run, so the answers cell carries the whole attempt history with
//     each verdict, not just the one that landed.
//  3. HEBREW SURVIVES. Every real run of this product is in Hebrew; a mangled
//     column is a useless file.
//
// DOM-free, emulator-free (the workbook LIBRARY is dynamically imported by the
// download shell, which this suite deliberately does not touch); run by
// scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-run-report-export.ts
import {
  buildReportWorkbook,
  formatAnswerCell,
  REPORT_SHEET_IDS,
} from '../apps/creator-web/src/lib/runReportExport';
import { buildRunPlayerReport } from '../packages/shared/src/runPlayerReport';
import type { Game, Run, RunTeam } from '../packages/shared/src/types';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// The labels the page passes in. Real copy lives in i18n.ts; this suite supplies
// recognisable stand-ins so an assertion failure names the column that broke.
const labels = {
  sheetPlayers: 'שחקנים',
  sheetAnswers: 'תשובות',
  sheetMissions: 'משימות',
  notRecorded: 'לא נשמר',
  noAnswerNeeded: '—',
  notAnswered: 'לא ענו',
  correct: 'נכון',
  wrong: 'שגוי',
  yes: 'כן',
  no: 'לא',
  columns: {
    player: 'שחקן', members: 'משתתפים', rank: 'דירוג', score: 'ניקוד',
    penalty: 'קנסות', status: 'סטטוס', started: 'התחלה', finished: 'סיום',
    durationMinutes: 'דקות', missionsDone: 'משימות שהושלמו', missionsSkipped: 'דילוגים',
    hints: 'רמזים', wrongAnswers: 'תשובות שגויות', media: 'מדיה',
    stage: 'שלב', mission: 'משימה', type: 'סוג', question: 'שאלה',
    expected: 'תשובה נכונה', theirAnswer: 'התשובה שלהם', verdict: 'תוצאה',
    attempts: 'ניסיונות', points: 'נקודות', minutes: 'דקות', mediaLink: 'קישור מדיה',
    players: 'שחקנים', completed: 'הושלמו', skipped: 'דולגו',
    completionRate: 'אחוז השלמה', medianMinutes: 'חציון דקות',
  },
};

const T0 = '2026-08-20T09:00:00.000Z';
const T1 = '2026-08-20T09:05:00.000Z';

const game = {
  id: 'g1', title: 'ציד האוצר',
  stages: [{
    id: 's1', title: 'שלב א', order: 0,
    tasks: [
      { id: 'q1', title: 'שאלת טריוויה', type: 'quiz', description: 'מהי בירת ישראל?', answers: ['ירושלים'] },
      { id: 'n1', title: 'כמה מדרגות', type: 'numeric', numericAnswer: 42 },
      { id: 'f1', title: 'הגיעו לכיכר', type: 'field' },
      { id: 'sq1', title: 'רצף', type: 'sequence', steps: [{ id: 'a', prompt: 'א', answer: 'a' }] },
    ],
  }],
} as unknown as Game;

const run = {
  id: 'r1', gameId: 'g1', ownerUid: 'owner', status: 'finished',
  accessCode: 'ABCD12', launchedAt: T0, finishedAt: T1,
  leaderboard: {
    frozen: true, published: true, updatedAt: T1,
    rankings: [{ rank: 1, teamId: 'teamA', teamName: 'אדומים', score: 120, completedStages: 1 }],
  },
} as unknown as Run;

const team = {
  id: 'teamA', displayName: 'אדומים', memberNames: ['דנה', 'יואב'], memberCount: 2,
  status: 'finished', score: 120, bonusPenalty: 25, startedAt: T0, finishedAt: T1,
  taskAttempts: { q1: 2 }, taskHintsUsed: ['q1'],
  stages: [{
    stageId: 's1', order: 0, status: 'completed',
    tasks: [
      {
        taskId: 'q1', taskIndex: 0, status: 'completed', earnedScore: 50, actualMinutes: 4,
        answerLog: [
          { at: T0, answer: 'תל אביב', correct: false, kind: 'answer' },
          { at: T1, answer: 'ירושלים', correct: true, kind: 'answer' },
        ],
      },
      // Completed with nothing recorded — the legacy / expired-retention case.
      { taskId: 'n1', taskIndex: 1, status: 'completed', earnedScore: 30 },
      // No answer channel at all.
      { taskId: 'f1', taskIndex: 2, status: 'completed', earnedScore: 20 },
      // Never answered.
      { taskId: 'sq1', taskIndex: 3, status: 'skipped', earnedScore: 0 },
    ],
  }],
} as unknown as RunTeam;

const report = buildRunPlayerReport({ game, run, teams: [team] });
const book = buildReportWorkbook(report, labels);
const sheet = (id: string) => book.sheets.find((s) => s.id === id)!;

// ── 1. Workbook shape ───────────────────────────────────────────────────────

check('exactly three sheets', book.sheets.length === 3);
check('the sheet ids are the declared ones',
  book.sheets.map((s) => s.id).join(',') === REPORT_SHEET_IDS.join(','));
check('sheet names come from the labels (translatable)',
  book.sheetNames.join(',') === 'שחקנים,תשובות,משימות');
check('the filename names the run', book.fileName.includes('ABCD12'));
check('the filename is an .xlsx', book.fileName.endsWith('.xlsx'));

for (const id of REPORT_SHEET_IDS) {
  const s = sheet(id);
  check(`${id}: has a header row`, s.rows.length >= 1);
  check(`${id}: every row has the same width as the header`,
    s.rows.every((r) => r.length === s.rows[0].length));
  check(`${id}: no cell is undefined or null`,
    s.rows.every((r) => r.every((c) => c !== undefined && c !== null)));
  check(`${id}: column widths are declared for every column`,
    s.columnWidths.length === s.rows[0].length);
}

// ── 2. Players sheet ────────────────────────────────────────────────────────

const players = sheet('players');
check('players: one data row per player', players.rows.length === 2);
check('players: header is the translated column set',
  players.rows[0][0] === 'שחקן' && players.rows[0].includes('ניקוד'));
const pRow = players.rows[1];
check('players: the Hebrew name survives', pRow[0] === 'אדומים');
check('players: members are joined readably', String(pRow[1]).includes('דנה'));
check('players: score is a NUMBER, not a string (so Excel can sum it)',
  typeof pRow[players.rows[0].indexOf('ניקוד')] === 'number');
check('players: the rank is carried', pRow[players.rows[0].indexOf('דירוג')] === 1);

// ── 3. Answers sheet — the empty cell must not lie ──────────────────────────

const answers = sheet('answers');
const header = answers.rows[0];
const col = (name: string) => header.indexOf(name);
const answerRow = (taskTitle: string) =>
  answers.rows.slice(1).find((r) => r[col('משימה')] === taskTitle)!;

check('answers: one data row per player x mission', answers.rows.length === 5);

const q = answerRow('שאלת טריוויה');
check('answers: every submission is rendered, in order, with its verdict',
  String(q[col('התשובה שלהם')]).indexOf('תל אביב') <
  String(q[col('התשובה שלהם')]).indexOf('ירושלים'));
check('answers: a wrong submission is marked wrong',
  String(q[col('התשובה שלהם')]).includes('שגוי'));
check('answers: a correct submission is marked correct',
  String(q[col('התשובה שלהם')]).includes('נכון'));
check('answers: the verdict column reflects the final result',
  q[col('תוצאה')] === 'נכון');
check('answers: the authored question is carried', q[col('שאלה')] === 'מהי בירת ישראל?');
check('answers: the answer key is carried for the owner', q[col('תשובה נכונה')] === 'ירושלים');
check('answers: attempts are carried as a number', q[col('ניסיונות')] === 2);
check('answers: points are carried as a number', q[col('נקודות')] === 50);

const n = answerRow('כמה מדרגות');
check('answers: an unrecorded answer says NOT RECORDED, never blank',
  n[col('התשובה שלהם')] === 'לא נשמר');
check('answers: an unrecorded row still carries its points', n[col('נקודות')] === 30);

const f = answerRow('הגיעו לכיכר');
check('answers: a mission with no answer channel is dashed, not "not recorded"',
  f[col('התשובה שלהם')] === '—');
check('answers: a no-answer mission has no verdict', f[col('תוצאה')] === '—');

const sq = answerRow('רצף');
check('answers: a skipped mission says NOT ANSWERED, not "not recorded"',
  sq[col('התשובה שלהם')] === 'לא ענו');

check('answers: the three empty-cell reasons are all distinguishable',
  new Set([n[col('התשובה שלהם')], f[col('התשובה שלהם')], sq[col('התשובה שלהם')]]).size === 3);

// ── 4. Missions sheet ───────────────────────────────────────────────────────

const missions = sheet('missions');
check('missions: one data row per mission', missions.rows.length === 5);
const mHeader = missions.rows[0];
const mRow = missions.rows.slice(1).find((r) => r[mHeader.indexOf('משימה')] === 'שאלת טריוויה')!;
check('missions: completion rate is a number in 0..1',
  typeof mRow[mHeader.indexOf('אחוז השלמה')] === 'number'
  && (mRow[mHeader.indexOf('אחוז השלמה')] as number) <= 1);
check('missions: wrong answers roll up',
  mRow[mHeader.indexOf('תשובות שגויות')] === 1);

// ── 5. formatAnswerCell in isolation ───────────────────────────────────────

const fmt = (over: Partial<Parameters<typeof formatAnswerCell>[0]>) => formatAnswerCell({
  answerChannel: 'answer', answers: [], answersUnavailable: false,
  finalAnswer: '', status: 'completed', ...over,
} as Parameters<typeof formatAnswerCell>[0], labels);

check('formatAnswerCell: no channel -> dash', fmt({ answerChannel: 'none' }) === '—');
check('formatAnswerCell: media channel -> dash', fmt({ answerChannel: 'media' }) === '—');
check('formatAnswerCell: unavailable -> not recorded',
  fmt({ answersUnavailable: true }) === 'לא נשמר');
check('formatAnswerCell: skipped with nothing -> not answered',
  fmt({ status: 'skipped' }) === 'לא ענו');
check('formatAnswerCell: pending with nothing -> not answered',
  fmt({ status: 'pending' }) === 'לא ענו');
check('formatAnswerCell: a legacy single answer with no log is still shown',
  fmt({ finalAnswer: 'ירושלים' }) === 'ירושלים');
check('formatAnswerCell: a survey answer carries no verdict marker',
  fmt({
    answerChannel: 'survey', finalAnswer: 'כיף',
    answers: [{ at: T0, answer: 'כיף', correct: null, kind: 'survey', stepIndex: -1 }],
  }) === 'כיף');
check('formatAnswerCell: a sequence step is labelled by its index',
  fmt({
    answerChannel: 'sequence',
    answers: [{ at: T0, answer: 'a', correct: true, kind: 'sequence_step', stepIndex: 0 }],
  }).includes('1'));
check('formatAnswerCell: is total for a null row',
  typeof formatAnswerCell(null as never, labels) === 'string');

// ── 6. Totality — an empty run must still export ───────────────────────────

check('an empty report still produces a valid three-sheet workbook', (() => {
  const empty = buildReportWorkbook(
    buildRunPlayerReport({ game: null, run: null, teams: [] }), labels);
  return empty.sheets.length === 3
    && empty.sheets.every((s) => s.rows.length >= 1)
    && empty.fileName.endsWith('.xlsx');
})());

check('a report with a non-finite score exports 0, never NaN', (() => {
  const broken = buildRunPlayerReport({
    game, run,
    teams: [{ id: 'x', displayName: 'x', score: Number.NaN, stages: [] } as unknown as RunTeam],
  });
  const wb = buildReportWorkbook(broken, labels);
  return wb.sheets.find((s) => s.id === 'players')!.rows[1].every(
    (c) => typeof c !== 'number' || Number.isFinite(c));
})());

check('the builder is pure — same input, identical output', (() => {
  const a = JSON.stringify(buildReportWorkbook(report, labels));
  const b = JSON.stringify(buildReportWorkbook(report, labels));
  return a === b;
})());

check('a player name that Excel would execute as a formula is neutralised', (() => {
  const nasty = buildRunPlayerReport({
    game, run,
    teams: [{ ...team, id: 'evil', displayName: '=HYPERLINK("http://x","click")' } as unknown as RunTeam],
  });
  const wb = buildReportWorkbook(nasty, labels);
  const cell = String(wb.sheets.find((s) => s.id === 'players')!.rows[1][0]);
  return !cell.startsWith('=');
})());

console.log(`\n${failures === 0 ? 'ALL RUN-REPORT-EXPORT TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

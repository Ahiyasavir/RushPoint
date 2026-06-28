// Pure-logic tests for import-game-spreadsheet (parseGameRows).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { parseGameRows, type ImportRow } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── Valid rows → stages + tasks ──────────────────────────────────────────────
const rows: ImportRow[] = [
  { stage: 'Old City', title: 'Find the gate', type: 'field', lat: '31.79', lng: '35.16', difficulty: '3', minutes: '8', points: '60' },
  { stage: 'Old City', title: 'Capital quiz', type: 'quiz', answer: 'Paris|paris', lat: '', lng: '' },
  { stage: 'Market', title: 'Count stalls', type: 'numeric', answer: '12', lat: '31.80', lng: '35.17' },
];
const { game, errors } = parseGameRows(rows, { gameTitle: 'My Import' });
ok(errors.length === 0, `valid rows have no errors (got ${JSON.stringify(errors)})`);
ok(game.title === 'My Import', 'game title applied');
ok(game.stages.length === 2, 'two stages by first-seen order');
ok(game.stages[0].title === 'Old City' && game.stages[0].tasks.length === 2, 'first stage groups two tasks');
ok(game.stages[1].title === 'Market' && game.stages[1].tasks.length === 1, 'second stage one task');
ok(game.stages[0].tasks[1].type === 'quiz' && JSON.stringify(game.stages[0].tasks[1].answers) === JSON.stringify(['Paris', 'paris']), 'quiz answers split on |');
ok(game.stages[0].tasks[1].locationless === true, 'blank coords → locationless');
ok(game.stages[1].tasks[0].numericAnswer === 12, 'numeric answer parsed');
ok(game.stages[0].tasks[0].coordinates.lat === 31.79, 'coords parsed');

// ── Empty sheet → empty game ─────────────────────────────────────────────────
const empty = parseGameRows([]);
ok(empty.game.stages.length === 0 && empty.errors.length === 0, 'empty sheet → empty game');
const blanks = parseGameRows([{ stage: '', title: '', type: '' }, {}]);
ok(blanks.game.stages.length === 0 && blanks.errors.length === 0, 'blank rows skipped silently');

// ── Bad rows flagged ─────────────────────────────────────────────────────────
const unknownType = parseGameRows([{ title: 'X', type: 'teleport', lat: '31.7', lng: '35.1' }]);
ok(unknownType.errors.some((e) => e.field === 'type'), 'unknown type flagged');
ok(unknownType.game.stages.length === 0, 'invalid row omitted from game');

const quizNoAnswer = parseGameRows([{ title: 'Q', type: 'quiz' }]);
ok(quizNoAnswer.errors.some((e) => e.field === 'answer'), 'quiz without answer flagged');

// Separator-only answer collapses to zero real answers → must be flagged, not
// imported as an unanswerable quiz with answers: [].
const quizSepOnly = parseGameRows([{ title: 'Q', type: 'quiz', answer: '|| |' }]);
ok(quizSepOnly.errors.some((e) => e.field === 'answer'), 'quiz with separator-only answer flagged');
ok(quizSepOnly.game.stages.length === 0, 'separator-only quiz omitted from game');

const numNoAnswer = parseGameRows([{ title: 'N', type: 'numeric', answer: 'abc' }]);
ok(numNoAnswer.errors.some((e) => e.field === 'answer'), 'numeric with non-number flagged');

const badCoords = parseGameRows([{ title: 'C', type: 'field', lat: '999', lng: '999' }]);
ok(badCoords.errors.some((e) => e.field === 'coordinates'), 'invalid coordinates flagged');

const halfCoords = parseGameRows([{ title: 'H', type: 'field', lat: '31.7', lng: '' }]);
ok(halfCoords.errors.some((e) => e.field === 'coordinates'), 'half-specified coords flagged');

const noTitle = parseGameRows([{ title: '', type: 'field', stage: 'S' }]);
ok(noTitle.errors.some((e) => e.field === 'title'), 'missing title flagged');

// Row numbers are human (1-based) and point at the offending row.
const mixed = parseGameRows([
  { stage: 'S', title: 'Good', type: 'field', lat: '31.7', lng: '35.1' },
  { title: 'Bad', type: 'nope' },
]);
ok(mixed.errors[0].row === 2, 'error row number is 1-based');
ok(mixed.game.stages[0].tasks.length === 1, 'valid rows kept alongside flagged ones');

console.log(failed === 0
  ? `\n✅ ALL IMPORT-SHEET TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

// Pure-logic tests for the staff console's field-ops helpers
// (change: staff-console-field-ops). Run by scripts/run-unit-tests.mjs via `npm test`.
// No emulator, no component runner — these are the decisions the console renders.
import {
  BONUS_REASONS, PENALTY_REASONS, OTHER_REASON,
  reasonsForDelta, resolveReason, parseAdjustAmount,
} from '../apps/play-web/src/lib/scoreReasons';
import { filterTeamsByName, teamNeedsAttention } from '../apps/play-web/src/lib/staffTeamFilter';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── parseAdjustAmount: the single "can this be submitted?" decision ──────────────
ok(parseAdjustAmount('25') === 25, 'a plain integer parses');
ok(parseAdjustAmount('-25') === -25, 'a negative integer parses');
ok(parseAdjustAmount('  7  ') === 7, 'surrounding whitespace is tolerated');
ok(parseAdjustAmount('') === null, 'empty is not submittable');
ok(parseAdjustAmount('   ') === null, 'whitespace only is not submittable');
// The mid-typing states. A marshal typing "-25" passes through "-", and the Confirm
// button must simply stay disabled rather than the field rejecting the keystroke.
ok(parseAdjustAmount('-') === null, 'a bare minus (mid-typing) is not submittable');
ok(parseAdjustAmount('abc') === null, 'non-numeric text is not submittable');
ok(parseAdjustAmount('2.5') === null, 'a decimal is refused (points are whole)');
ok(parseAdjustAmount('1e5') === null, 'exponent notation is refused');
ok(parseAdjustAmount('0') === null, 'zero is refused — it would log a no-op');
ok(parseAdjustAmount('-0') === null, 'negative zero is refused too');
ok(parseAdjustAmount('10000') === 10_000, 'the cap itself is allowed');
ok(parseAdjustAmount('10001') === null, 'past the cap is refused (fat-finger guard)');
ok(parseAdjustAmount('-10001') === null, 'the cap applies to deductions as well');
ok(parseAdjustAmount('99999999999999999999') === null, 'an absurd value cannot slip through');

// ── reasonsForDelta: the right vocabulary for the direction ─────────────────────
ok(reasonsForDelta(10) === BONUS_REASONS, 'a positive delta offers award reasons');
ok(reasonsForDelta(-10) === PENALTY_REASONS, 'a negative delta offers penalty reasons');
ok(reasonsForDelta(0) === BONUS_REASONS, 'zero degrades to the award list, never throws');
ok(reasonsForDelta(NaN) === BONUS_REASONS, 'NaN degrades rather than breaking the render');
ok(!BONUS_REASONS.some((r) => (PENALTY_REASONS as readonly string[]).includes(r)),
  'the two vocabularies do not overlap (a mis-tap cannot invert the meaning)');

// ── resolveReason: what actually reaches the audit log ─────────────────────────
ok(resolveReason('reasonCreativity', '') === 'reasonCreativity',
  'a preset resolves to its stable, language-neutral id');
ok(resolveReason(OTHER_REASON, '  built a human pyramid  ') === 'built a human pyramid',
  'free text is trimmed');
ok(resolveReason(OTHER_REASON, '') === '',
  'an empty "other" resolves to no reason rather than the literal id');
ok(resolveReason(null, 'ignored') === '',
  'no selection resolves to no reason — a reason is never required');
ok(resolveReason(OTHER_REASON, 'x'.repeat(500)).length === 200,
  'free text is bounded to the length the server accepts');

// ── filterTeamsByName: the search box ──────────────────────────────────────────
const teams = [
  { id: 'a', displayName: 'הפלאפל פייב', score: 10 },
  { id: 'b', displayName: 'Desert Foxes', score: 20 },
  { id: 'c', displayName: 'שועלי המדבר', score: 30 },
  { id: 'd', displayName: 'desert dogs', score: 40 },
];
ok(filterTeamsByName(teams, '').length === 4, 'an empty query shows every team');
ok(filterTeamsByName(teams, '   ').length === 4, 'a whitespace query shows every team');
ok(filterTeamsByName(teams, 'desert').map((t) => t.id).join() === 'b,d',
  'matching is case-insensitive');
ok(filterTeamsByName(teams, 'DESERT').map((t) => t.id).join() === 'b,d',
  'an upper-case query matches the same teams');
ok(filterTeamsByName(teams, 'מדבר').map((t) => t.id).join() === 'c',
  'Hebrew substrings match (this is a Hebrew-first product)');
ok(filterTeamsByName(teams, 'zzz').length === 0, 'a non-matching query yields nothing');
ok(filterTeamsByName(teams, 'desert')[0] === teams[1],
  'filtering preserves the incoming (score-sorted) order and identity');
// Totality: this runs on every keystroke against live snapshot data, so a malformed
// row must narrow the list, never crash the console mid-event.
ok(filterTeamsByName(null as never, 'x').length === 0, 'a null list never throws');
ok(filterTeamsByName([{ id: 'x' } as never], 'x').length === 0,
  'a row with no displayName is skipped, not crashed on');

// ── teamNeedsAttention: which rows surface first ───────────────────────────────
ok(teamNeedsAttention({ held: true }) === true, 'a held team needs attention');
ok(teamNeedsAttention({ outOfBounds: true }) === true, 'an out-of-bounds team needs attention');
ok(teamNeedsAttention({}) === false, 'an ordinary team does not');
ok(teamNeedsAttention(null as never) === false, 'a malformed row is not flagged, and never throws');

console.log(failed === 0
  ? `\n✅ ALL STAFF FIELD-OPS TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

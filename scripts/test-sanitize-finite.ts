// Pure-logic test for sanitizeFinite (change: fix-nonfinite-callable-payload).
// A callable must never return a non-finite number (Infinity/-Infinity/NaN) —
// firebase-functions throws "Data cannot be encoded in JSON" on one. The helper
// degrades any non-finite number to null at any nesting depth. No emulator.
//   npx tsx scripts/test-sanitize-finite.ts
import { sanitizeFinite } from '../packages/shared/src/sanitizeFinite';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// Top-level non-finite numbers → null.
check('Infinity → null', sanitizeFinite(Infinity) === null);
check('-Infinity → null', sanitizeFinite(-Infinity) === null);
check('NaN → null', sanitizeFinite(NaN) === null);

// Finite primitives pass through untouched.
check('finite number preserved', sanitizeFinite(42) === 42);
check('zero preserved', sanitizeFinite(0) === 0);
check('string preserved', sanitizeFinite('hi') === 'hi');
check('boolean preserved', sanitizeFinite(true) === true);
check('null preserved', sanitizeFinite(null) === null);
check('undefined preserved', sanitizeFinite(undefined) === undefined);

// Inside arrays.
const arr = sanitizeFinite([1, Infinity, 'x', NaN]);
check('array: non-finite → null, finite kept', JSON.stringify(arr) === JSON.stringify([1, null, 'x', null]));

// Nested object depth (mirrors run.leaderboard embedded in getMyTeamState).
const nested = sanitizeFinite({
  run: { leaderboard: { rankings: [{ teamId: 't1', durationSeconds: Infinity, totalMinutes: Infinity, score: 10 }] } },
  team: { bonusPenalty: -5, pace: NaN },
});
check('nested non-finite → null', (nested as any).run.leaderboard.rankings[0].durationSeconds === null);
check('nested finite kept', (nested as any).run.leaderboard.rankings[0].score === 10);
check('nested NaN → null', (nested as any).team.pace === null);
check('nested finite negative kept', (nested as any).team.bonusPenalty === -5);

// The whole point: the sanitized payload must JSON-encode without throwing.
let encoded = true;
try { JSON.stringify(nested); } catch { encoded = false; }
check('sanitized payload JSON-encodes', encoded);

// A Date must not be walked into a bag of nulls (non-plain object passes through).
const d = new Date('2026-07-11T00:00:00.000Z');
check('Date preserved as-is', sanitizeFinite(d) instanceof Date && (sanitizeFinite(d) as Date).getTime() === d.getTime());

console.log(`\n${failures === 0 ? 'ALL SANITIZE-FINITE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

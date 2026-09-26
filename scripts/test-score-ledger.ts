// The team's score ledger (changes: send-team-back, team-dossier-and-search).
// Every operator-made score change is recorded ON the team with its reason, bounded, so the
// organizer's team page can say why a score moved without reading the admin-only audit trail.
import { appendScoreLedger, SCORE_LEDGER_MAX } from '../packages/shared/src/scoreLedger';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
const e = (delta: number, kind = 'adjust') => ({ at: '2026-09-25T10:00:00.000Z', delta, kind: kind as never });

const one = appendScoreLedger(undefined, [e(20)]);
ok('appends to nothing', one.length === 1 && one[0].delta === 20);
ok('keeps order, newest last', appendScoreLedger(one, [e(-5)]).map((x) => x.delta).join() === '20,-5');
const full = appendScoreLedger(Array.from({ length: SCORE_LEDGER_MAX }, (_, i) => e(i)), [e(999)]);
ok(`bounded at ${SCORE_LEDGER_MAX}, dropping the OLDEST`, full.length === SCORE_LEDGER_MAX && full[full.length - 1].delta === 999 && full[0].delta === 1);
ok('a corrupt stored ledger is replaced, not trusted', appendScoreLedger('x' as never, [e(1)]).length === 1);
ok('garbage entries are dropped (non-finite or zero delta, unknown kind)',
  appendScoreLedger([], [e(Number.NaN), e(0), { at: 'x', delta: 3, kind: 'weird' } as never, e(4)]).map((x) => x.delta).join() === '4');
const long = appendScoreLedger([], [{ ...e(1), reason: 'x'.repeat(500) }]);
ok('a reason is capped at 200 characters', (long[0].reason ?? '').length === 200);
ok('the input array is not mutated', (() => { const a = [e(1)]; appendScoreLedger(a, [e(2)]); return a.length === 1; })());

if (failures > 0) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall passed');
process.exit(0);

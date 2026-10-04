// A hint the team paid for is refunded when the ORGANIZER takes the mission away before the team
// finished it (a run-wide close, or a skip of that one mission). The amount owed back is read from
// the team's own score ledger, so a free (escalated) hint refunds nothing and a refund is never paid
// twice. Pure. npx tsx scripts/test-hint-refund.ts
import { hintRefundOwed, appendScoreLedger } from '../packages/shared/src/scoreLedger';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const at = '2026-01-01T10:00:00.000Z';
check('no ledger → nothing owed', hintRefundOwed(undefined, 't1') === 0);
check('a paid hint is owed back in full', hintRefundOwed([{ at, delta: -30, kind: 'hint', taskId: 't1' }], 't1') === 30);
check('another mission\'s hint is not', hintRefundOwed([{ at, delta: -30, kind: 'hint', taskId: 't2' }], 't1') === 0);
check('a refund already paid is not paid twice',
  hintRefundOwed([{ at, delta: -30, kind: 'hint', taskId: 't1' }, { at, delta: 30, kind: 'hintRefund', taskId: 't1' }], 't1') === 0);
check('manual adjustments are never refunded', hintRefundOwed([{ at, delta: -50, kind: 'adjust', taskId: 't1' }], 't1') === 0);
check('junk entries are ignored', hintRefundOwed([null, 'x', { delta: NaN, kind: 'hint', taskId: 't1' }] as unknown[], 't1') === 0);
check('the ledger keeps a hintRefund entry', appendScoreLedger([], [{ at, delta: 30, kind: 'hintRefund', taskId: 't1' }]).length === 1);
console.log(`\n${failures === 0 ? 'ALL HINT-REFUND TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

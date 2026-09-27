// The "organizers closed your mission" notice on the phone (change: live-task-close-rules).
// Shown once per closure, only while it is fresh, never for a malformed record, and never again
// after the team dismissed it (the dismissal is keyed on the closure, so a later closure of
// ANOTHER mission still shows).
//   npx tsx scripts/test-closed-task-notice.ts
import { closedNoticeKey, shouldShowClosedNotice, CLOSED_NOTICE_FRESH_MS } from '../apps/play-web/src/lib/closedTaskNotice';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const now = Date.parse('2026-09-27T10:00:00Z');
const notice = { taskId: 'a', title: 'Mission A', at: '2026-09-27T09:58:00Z' };
check('a fresh notice shows', shouldShowClosedNotice(notice, now, () => false));
check('a dismissed notice does not', !shouldShowClosedNotice(notice, now, () => true));
check('an old notice does not', !shouldShowClosedNotice({ ...notice, at: new Date(now - CLOSED_NOTICE_FRESH_MS - 1000).toISOString() }, now, () => false));
check('no notice, a malformed one, or a bad time: nothing, never a throw',
  [undefined, null, 'x', {}, { taskId: 'a' }, { taskId: 'a', title: 'x', at: 'garbage' }].every((n) => !shouldShowClosedNotice(n as never, now, () => false)));
check('a notice from the future (a slow phone clock) still shows', shouldShowClosedNotice({ ...notice, at: '2026-09-27T10:05:00Z' }, now, () => false));
check('the dismissal key is per run and per closure',
  closedNoticeKey('r1', notice) !== closedNoticeKey('r2', notice)
  && closedNoticeKey('r1', notice) !== closedNoticeKey('r1', { ...notice, taskId: 'b' })
  && closedNoticeKey('r1', notice) !== closedNoticeKey('r1', { ...notice, at: '2026-09-27T09:59:00Z' }));
check('a throwing storage read counts as not dismissed', shouldShowClosedNotice(notice, now, () => { throw new Error('blocked'); }));

console.log(`\n${failures === 0 ? 'ALL CLOSED-NOTICE TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

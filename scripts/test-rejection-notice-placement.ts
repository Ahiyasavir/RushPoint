// The rejection notice must live in the MAIN mission card
// (change: rejection-tells-the-player)
//
// IT DID NOT, AND THE FEATURE WAS DEAD. The notice was inserted above what looked
// like the entry controls but was in fact the `if (task.arrivalPending)` early
// return - the sealed-hidden-mission card, which almost no mission ever shows. It
// typechecked, the pure verdict had 30 green assertions, the copy was in the live
// bundle, and a player being rejected on an ordinary mission still saw nothing.
// Only rendering it in a browser found it.
//
// A component test runner does not exist for play-web, so this pins the one fact a
// source scan CAN establish: the notice and the task-type entry chain are inside the
// SAME return, i.e. the same card. If someone moves either one into another branch,
// a `return (` appears between them and this fails.
import { readFileSync } from 'node:fs';

const SRC = 'apps/play-web/src/components/TaskRunner.tsx';
const body = readFileSync(SRC, 'utf8');

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}

const NOTICE = 'data-testid="submission-rejected"';
const ENTRY = "task.type === 'smart_station'";

const noticeAt = body.indexOf(NOTICE);
const entryAt = body.indexOf(ENTRY);

ok('the rejection notice still exists', noticeAt >= 0);
ok('the task-type entry chain still exists (the anchor this is measured against)', entryAt >= 0);

if (noticeAt >= 0 && entryAt >= 0) {
  ok('the notice is rendered ABOVE the entry controls, where the response to it lives',
    noticeAt < entryAt, `notice@${noticeAt} entry@${entryAt}`);

  // The decisive one. A top-level `return (` between them means they are in
  // different cards - which is exactly how this shipped dead the first time.
  const between = body.slice(noticeAt, entryAt);
  const strayReturn = /\n\s{0,4}return \(/.test(between);
  ok('the notice and the mission card are in the SAME return, not separate branches',
    !strayReturn,
    strayReturn ? 'a `return (` sits between them: the notice is in a different card' : '');

  // And it must not have drifted back into the sealed-mission early return.
  const sealedAt = body.indexOf('if (task.arrivalPending)');
  if (sealedAt >= 0) {
    const sealedReturnEnd = body.indexOf('\n  return (', sealedAt);
    ok('the notice is NOT inside the sealed-mission (arrivalPending) branch',
      sealedReturnEnd < 0 || noticeAt > sealedReturnEnd,
      `notice@${noticeAt} sealedBranchEndsAt@${sealedReturnEnd}`);
  }
}

console.log('');
if (failures > 0) {
  console.error(`✗ rejection-notice-placement: ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('✓ rejection-notice-placement: all assertions passed\n');

// Pure-logic tests for tv-leaderboard (TV_ROUTE_PARAM + detectLeaderChange).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { TV_ROUTE_PARAM, detectLeaderChange } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

ok(TV_ROUTE_PARAM === 'tv', 'TV_ROUTE_PARAM is "tv"');

// First leader appears → change fires.
ok(detectLeaderChange(null, 'teamA') === true, 'empty → first leader fires');
ok(detectLeaderChange(undefined, 'teamA') === true, 'undefined prev → first leader fires');
// Leader swaps → fires.
ok(detectLeaderChange('teamA', 'teamB') === true, 'leader swap fires');
// Same leader → no change.
ok(detectLeaderChange('teamA', 'teamA') === false, 'same leader does not fire');
// Board empties → no change (no new leader to celebrate).
ok(detectLeaderChange('teamA', null) === false, 'leader → empty does not fire');
ok(detectLeaderChange(null, null) === false, 'empty → empty does not fire');
ok(detectLeaderChange('teamA', undefined) === false, 'leader → undefined does not fire');

console.log(failed === 0
  ? `\n✅ ALL TV TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

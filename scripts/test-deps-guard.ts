// Pure-logic tests for the deps-drift guard (change: fix-playtest-deps-drift).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { depsNeedInstall } from './lib/depsGuard.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

ok(depsNeedInstall({ lockMtimeMs: null, markerMtimeMs: null }) === false, 'no lockfile at all → nothing to reconcile');
ok(depsNeedInstall({ lockMtimeMs: NaN, markerMtimeMs: 1000 }) === false, 'lockfile missing (NaN) → false regardless of marker');
ok(depsNeedInstall({ lockMtimeMs: 2000, markerMtimeMs: null }) === true, 'lockfile present, never installed → true');
ok(depsNeedInstall({ lockMtimeMs: 2000, markerMtimeMs: NaN }) === true, 'lockfile present, marker NaN → true');
ok(depsNeedInstall({ lockMtimeMs: 2000, markerMtimeMs: 1000 }) === true, 'lockfile newer than install marker → true (this is the missed-dep-install case)');
ok(depsNeedInstall({ lockMtimeMs: 1000, markerMtimeMs: 2000 }) === false, 'marker newer than lockfile → false (already installed after last lock change)');
ok(depsNeedInstall({ lockMtimeMs: 1500, markerMtimeMs: 1500 }) === false, 'equal mtimes → false (already in sync)');

console.log(failed === 0
  ? `\n✅ ALL DEPS-GUARD TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

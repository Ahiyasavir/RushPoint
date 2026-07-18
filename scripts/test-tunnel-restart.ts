// Pure-logic tests for playtest-tunnel-auto-restart (backoff / quick-failure).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import { restartDelayMs, isQuickFailure } from './lib/tunnelRestart.mjs';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── restartDelayMs ───────────────────────────────────────────────────────────
ok(restartDelayMs(0) === 1000, 'n=0 → baseMs default 1000');
ok(restartDelayMs(1) === 2000, 'n=1 → 2000');
ok(restartDelayMs(2) === 4000, 'n=2 → 4000');
ok(restartDelayMs(3) === 8000, 'n=3 → 8000');
ok(restartDelayMs(100) === 30000, 'large n caps at maxMs default 30000');
ok(restartDelayMs(0, { baseMs: 500 }) === 500, 'custom baseMs honored');
ok(restartDelayMs(2, { baseMs: 500 }) === 2000, 'custom baseMs grows (500*2^2)');
ok(restartDelayMs(10, { baseMs: 500, maxMs: 5000 }) === 5000, 'custom maxMs caps');

// ── isQuickFailure ───────────────────────────────────────────────────────────
ok(isQuickFailure(0) === true, 'uptime 0 → quick (default threshold 10000)');
ok(isQuickFailure(9999) === true, 'uptime just under threshold → quick');
ok(isQuickFailure(10000) === false, 'uptime === threshold → not quick');
ok(isQuickFailure(60000) === false, 'long uptime → not quick (healthy-then-dropped)');
ok(isQuickFailure(3000, 2000) === false, 'custom threshold: uptime above → not quick');
ok(isQuickFailure(1000, 2000) === true, 'custom threshold: uptime below → quick');

console.log(failed === 0
  ? `\n✅ ALL TUNNEL-RESTART TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

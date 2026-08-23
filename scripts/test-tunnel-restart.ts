// Pure-logic tests for playtest-tunnel-auto-restart (backoff / quick-failure)
// and playtest-durability (failure classification / machine identity).
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  restartDelayMs,
  isQuickFailure,
  classifyTunnelFailure,
  isPermanentTunnelFailure,
  tunnelFailureReport,
  machineIdentity,
} from './lib/tunnelRestart.mjs';

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

// ── classifyTunnelFailure ────────────────────────────────────────────────────
// VERBATIM capture of the real failure from .firebase/playtest-forever.log on
// 2026-07-22, when a SECOND machine held the same reserved domain and this
// machine's tunnel crash-looped for hours. Using ngrok's genuine output (not a
// hand-written approximation) is the point: it proves the matcher fires on what
// ngrok actually emits.
const NGROK_334_REAL = String.raw`
t=2026-07-22T22:12:02+0300 lvl=eror msg="session closing" obj=tunnels.session err="failed to start tunnel: The endpoint 'https://throwing-unrelated-traps.ngrok-free.dev' is already online. Either\n1. stop your existing endpoint first, or\n2. start both endpoints with ` + '`--pooling-enabled`' + String.raw` to load balance between them.\r\n\r\nERR_NGROK_334\r\n"
ERROR:  failed to start tunnel: The endpoint 'https://throwing-unrelated-traps.ngrok-free.dev' is already online. Either
ERROR:  1. stop your existing endpoint first, or
ERROR:  ERR_NGROK_334
ERROR:  https://ngrok.com/docs/errors/err_ngrok_334
`;

ok(classifyTunnelFailure(NGROK_334_REAL) === 'domain-contention',
  'real captured ERR_NGROK_334 output → domain-contention');
ok(classifyTunnelFailure("The endpoint 'https://x.ngrok-free.dev' is already online.") === 'domain-contention',
  '"is already online" alone → domain-contention (message without the code)');
ok(classifyTunnelFailure('ERR_NGROK_107: authentication failed: invalid authtoken') === 'auth',
  'ERR_NGROK_107 → auth');
ok(classifyTunnelFailure('ERR_NGROK_105 authentication failed') === 'auth', 'ERR_NGROK_105 → auth');
ok(classifyTunnelFailure('dial tcp 127.0.0.1:3000: connectex: ECONNREFUSED') === 'network',
  'ECONNREFUSED / dial tcp → network');
ok(classifyTunnelFailure('context deadline exceeded') === 'network', 'context deadline → network');
ok(classifyTunnelFailure('no such host') === 'network', 'no such host → network');
ok(classifyTunnelFailure('') === 'unknown', 'empty string → unknown (never throws)');
ok(classifyTunnelFailure(null as unknown as string) === 'unknown', 'null → unknown (never throws)');
ok(classifyTunnelFailure(undefined as unknown as string) === 'unknown', 'undefined → unknown');
ok(classifyTunnelFailure('tunnel session started\nclosing') === 'unknown', 'ordinary exit tail → unknown');
// Contention must win even when transient noise is also present in the tail —
// the permanent cause is the one the operator has to act on.
ok(classifyTunnelFailure('dial tcp failed\nERR_NGROK_334\n') === 'domain-contention',
  'contention outranks co-occurring network noise');

// ── isPermanentTunnelFailure ─────────────────────────────────────────────────
ok(isPermanentTunnelFailure('domain-contention') === true, 'domain-contention is permanent');
ok(isPermanentTunnelFailure('auth') === true, 'auth is permanent');
ok(isPermanentTunnelFailure('network') === false, 'network is transient');
ok(isPermanentTunnelFailure('unknown') === false, 'unknown is transient');

// ── tunnelFailureReport ──────────────────────────────────────────────────────
const rep = tunnelFailureReport('domain-contention', {
  domain: 'throwing-unrelated-traps.ngrok-free.dev',
  identity: 'this machine: DESKTOP-TEST',
});
const repText = [rep.headline, ...rep.lines].join('\n');
ok(rep.permanent === true, 'contention report is flagged permanent');
ok(repText.includes('throwing-unrelated-traps.ngrok-free.dev'), 'report names the contended domain');
ok(/different (computer|machine)/i.test(repText),
  'report states the URL is serving a DIFFERENT machine (the fact that was missed for hours)');
ok(/stop/i.test(repText), 'report names the fix (stop the other tunnel)');
ok(repText.includes('DESKTOP-TEST'), 'report embeds the machine identity');

const netRep = tunnelFailureReport('network', { domain: 'x.ngrok-free.dev', identity: 'host' });
ok(netRep.permanent === false, 'network report is not permanent');

// ── machineIdentity ──────────────────────────────────────────────────────────
const id = machineIdentity({
  hostname: 'DESKTOP-ABC',
  importSource: 'backup-2026-07-22T19-02-42-662Z',
  importMs: Date.parse('2026-07-22T19:02:42.662Z'),
});
ok(id.includes('DESKTOP-ABC'), 'identity includes hostname');
ok(id.includes('backup-2026-07-22T19-02-42-662Z'), 'identity includes the dataset marker');
ok(typeof machineIdentity({ hostname: 'H', importSource: null, importMs: NaN }) === 'string',
  'identity tolerates a missing/NaN import timestamp without throwing');

console.log(failed === 0
  ? `\n✅ ALL TUNNEL-RESTART TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

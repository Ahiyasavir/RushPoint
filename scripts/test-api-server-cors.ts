// Regression test for the self-hosted API server's CORS preflight routing
// (change: self-host-functions-vps).
//
// THE BUG THIS EXISTS TO PREVENT — it took the live site down and no other test
// caught it:
//
// `functions/server.js` mounted every callable with `app.post('/'+name, ...)`.
// A cross-origin browser call sends a CORS **preflight** `OPTIONS /<name>` before
// the POST. With a POST-only route the OPTIONS never reaches the callable (whose
// firebase-functions wrapper answers preflights itself via cors({origin:true})) —
// Express's default handler replies `200 Allow: POST` with NO
// `Access-Control-Allow-Origin`, so the browser blocks the real request. The app
// showed only an opaque "failed to load" error.
//
// WHY EVERY OTHER TEST PASSED: curl and server-to-server callers send no `Origin`
// header, so they never preflight. `scripts/test-api-live.mjs`, the docker
// healthcheck and every manual curl all POST directly and are therefore blind to
// it. The failure requires a real browser on a DIFFERENT origin than the API —
// exactly the deployed topology (app on rush-point.com, API on api.rush-point.com)
// and nothing else.
//
// This is a STATIC source check, deliberately: booting server.js needs
// firebase-admin credentials and the built lib/index.js bundle, which the pure
// lane must not require. It cannot prove the preflight succeeds end-to-end (only a
// real cross-origin request can, and that is verified manually against the
// deployed API); what it CAN do is fail loudly the moment someone "tidies"
// app.all back to app.post, which is the regression that actually happened.
//
// Run by scripts/run-unit-tests.mjs via `npm test`, or directly:
//   npx tsx scripts/test-api-server-cors.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'functions', 'server.js');

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

console.log('\napi server — CORS preflight routing');

let src = '';
try {
  src = readFileSync(SERVER, 'utf8');
} catch {
  /* reported below */
}
ok(src.length > 0, 'functions/server.js must be readable');

if (src) {
  // Strip comments so the prose above (which necessarily mentions `app.post`)
  // cannot satisfy or trip these assertions. Only real code is inspected.
  //
  // ORDER IS LOAD-BEARING. This was one `/*…*/` regex over the raw source, which
  // treats ANY `/*` as a block opener — including text inside a line comment
  // (`// … allows video/* …`) or inside a string literal
  // (`express.raw({ type: '*/*' })`). One such `/*` swallowed everything up to
  // the next `*/`: 3KB of server.js vanished, taking the ALLOWED_ORIGINS gate
  // these assertions exist to protect with it. The guard then reported "gate
  // missing" for a gate that was plainly there — and would just as readily have
  // reported all-clear while inspecting almost nothing.
  // So: neutralise string literals, then line comments, and only then blocks.
  const code = src
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"[^"\n]*"/g, '""')
    .split('\n')
    .map((l) => { const i = l.indexOf('//'); return i === -1 ? l : l.slice(0, i); })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  // ── The load-bearing assertion ────────────────────────────────────────────
  // The callable mount must accept every verb so the preflight reaches the
  // callable's own CORS layer.
  const mountsWithAll = /app\.all\(\s*`\/\$\{name\}`/.test(code);
  ok(mountsWithAll, 'callables must be mounted with app.all(`/${name}`, …) so OPTIONS preflights reach them');

  const mountsWithPost = /app\.post\(\s*`\/\$\{name\}`/.test(code);
  ok(
    !mountsWithPost,
    'callables must NOT be mounted with app.post(`/${name}`) — a POST-only route makes every '
      + 'cross-origin browser preflight fall through to Express and return no CORS headers',
  );

  // ── The reason must survive too ───────────────────────────────────────────
  // A bare `app.all` with no explanation is one "cleanup" away from regressing,
  // and the failure mode is invisible to every non-browser test.
  const explains = /preflight/i.test(src) && /app\.all/.test(src);
  ok(explains, 'the mount must carry a comment explaining WHY app.all is required (preflight)');

  // ── The origin allow-list must stay in FRONT of the mounts ────────────────
  // It is the only thing stopping the callable layer's origin-reflecting CORS
  // from answering any origin on the internet.
  const gateAt = code.indexOf('ALLOWED_ORIGINS');
  const mountAt = code.search(/app\.all\(\s*`\/\$\{name\}`/);
  ok(gateAt !== -1, 'the ALLOWED_ORIGINS gate must still exist');
  ok(
    gateAt !== -1 && mountAt !== -1 && gateAt < mountAt,
    'the ALLOWED_ORIGINS gate must be registered BEFORE the callable routes',
  );

  // The gate must reject a non-allow-listed browser origin, not merely log it.
  ok(/\b403\b/.test(code), 'a disallowed origin must be answered with 403');

  // A request with no Origin (server-to-server, curl, docker healthcheck) must
  // still pass — the healthcheck depends on it.
  ok(
    /if\s*\(\s*origin\s*&&/.test(code),
    'the gate must only apply when an Origin header is present (server-to-server must pass)',
  );
}

console.log(`\n${failed === 0 ? '\x1b[32m✓' : '\x1b[31m✗'} api server cors: ${passed} passed, ${failed} failed\x1b[0m\n`);
if (failed > 0) process.exit(1);

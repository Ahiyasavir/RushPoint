// End-to-end upload health check — runs against a REAL running API origin.
//
// WHY THIS EXISTS: photo upload was broken in production while every test was
// green. `scripts/test-api-server-cors.ts` spawns `functions/server.js` from the
// working tree and asserts against THAT — so it proves the code in git is
// correct and proves nothing at all about the code the VPS is running. The
// container was still serving a build without the upload routes: `/healthz`
// answered 200 (so the API looked healthy) while `PUT /upload` 404'd, and the
// phone reported it as "take the photo again".
//
// A unit test cannot catch that. Only asking the deployed origin can. This walks
// the entire path a real phone walks:
//
//   anonymous sign-in -> PUT /upload -> returned URL -> GET it back -> same bytes
//
// plus the refusals that must still refuse (another team's folder, traversal, a
// disallowed type, an empty body). If this passes, a photo genuinely uploads and
// is genuinely readable afterwards.
//
//   node scripts/check-upload-health.mjs                       # production
//   node scripts/check-upload-health.mjs --origin http://127.0.0.1:8080
//   node scripts/check-upload-health.mjs --skip-auth           # unauthenticated checks only
//
// Exit 0 = uploads work end to end. Exit 1 = they do not, and the failing step
// says which link in the chain broke.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ORIGIN = (argOf('--origin', 'https://api.rush-point.com')).replace(/\/$/, '');
const WEB_ORIGIN = argOf('--web-origin', 'https://rush-point.com');
const SKIP_AUTH = args.includes('--skip-auth');

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, msg, detail) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${msg}`); } else {
    failed++; failures.push(msg);
    console.error(`  \x1b[31m✗ ${msg}\x1b[0m`);
    if (detail) console.error(`      ${detail}`);
  }
}
function step(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

// The web API key the participant app itself uses — read from source so this can
// never drift from what the phone actually sends.
function webApiKey() {
  const envPath = join(repo, 'apps/play-web/.env');
  try {
    const m = /VITE_FIREBASE_API_KEY\s*=\s*(\S+)/.exec(readFileSync(envPath, 'utf8'));
    if (m) return m[1].replace(/^["']|["']$/g, '');
  } catch { /* fall through */ }
  return process.env.VITE_FIREBASE_API_KEY || null;
}

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

async function main() {
  console.log(`\n\x1b[1m📤 Upload health — ${ORIGIN}\x1b[0m`);

  // ── 1. Is the API even up? ────────────────────────────────────────────────
  step('1. API reachable');
  let health;
  try {
    health = await fetch(`${ORIGIN}/healthz`);
    ok(health.ok, `GET /healthz -> ${health.status}`);
  } catch (e) {
    ok(false, 'GET /healthz', String(e));
    return finish();
  }

  // ── 2. The upload ROUTE exists ────────────────────────────────────────────
  // This is the check that was missing. A healthy /healthz says nothing about
  // whether the running build has the upload routes at all.
  step('2. Upload route deployed');
  const pre = await fetch(`${ORIGIN}/upload`, {
    method: 'OPTIONS',
    headers: {
      Origin: WEB_ORIGIN,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  ok(
    pre.status !== 404,
    `OPTIONS /upload -> ${pre.status} (404 means the container is running a build WITHOUT the upload routes)`,
    pre.status === 404 ? `Fix: docker compose -f docker-compose.api.yml up -d --build   (see VPS_UPLOADS.md)` : null,
  );
  if (pre.status === 404) return finish();

  ok(pre.status === 204, `OPTIONS /upload -> 204`);
  ok(
    pre.headers.get('access-control-allow-origin') === WEB_ORIGIN,
    `preflight allows ${WEB_ORIGIN}`,
    `got: ${pre.headers.get('access-control-allow-origin')}`,
  );
  const allowHeaders = (pre.headers.get('access-control-allow-headers') || '').toLowerCase();
  ok(allowHeaders.includes('authorization'), 'preflight allows the Authorization header');
  ok((pre.headers.get('access-control-allow-methods') || '').includes('PUT'), 'preflight allows PUT');

  // ── 3. Auth is enforced ───────────────────────────────────────────────────
  step('3. Auth enforced');
  const noAuth = await fetch(`${ORIGIN}/upload?path=runs/r/teams/u/x.jpg`, {
    method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: JPEG,
  });
  ok(noAuth.status === 401, `unauthenticated PUT -> ${noAuth.status} (want 401)`);

  if (SKIP_AUTH) return finish();

  // ── 4. Real anonymous sign-in, exactly like a player ──────────────────────
  step('4. Anonymous sign-in');
  const key = webApiKey();
  if (!key) { ok(false, 'found a Firebase web API key', 'set VITE_FIREBASE_API_KEY or apps/play-web/.env'); return finish(); }
  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const session = await signIn.json();
  ok(!!session.idToken, `anonymous sign-in -> ${signIn.status}`, session.error?.message);
  if (!session.idToken) return finish();
  const uid = session.localId;
  const auth = { Authorization: `Bearer ${session.idToken}` };

  // ── 5. The upload itself ──────────────────────────────────────────────────
  step('5. Upload round trip');
  const runId = `healthcheck-${Date.now().toString(36)}`;
  const path = `runs/${runId}/teams/${uid}/probe.jpg`;
  const put = await fetch(`${ORIGIN}/upload?path=${encodeURIComponent(path)}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg', Origin: WEB_ORIGIN }, body: JPEG,
  });
  const putBody = await put.json().catch(() => ({}));
  ok(put.status === 200, `authenticated PUT -> ${put.status}`, putBody.error?.message);
  if (put.status !== 200) return finish();

  ok(
    put.headers.get('access-control-allow-origin') === WEB_ORIGIN,
    'the successful PUT carries CORS headers (a browser cannot read the URL without them)',
    `got: ${put.headers.get('access-control-allow-origin')}`,
  );

  const url = putBody.url;
  ok(typeof url === 'string' && url.length > 0, 'response contains a url');
  if (!url) return finish();
  ok(
    url.startsWith(`${ORIGIN}/uploads/`) || /^https:\/\/[^/]+\/uploads\//.test(url),
    `url points at the uploads route — ${url}`,
  );
  // The callables re-validate this URL's origin before storing it. A mismatch here
  // means the server accepts an upload and then rejects its own returned URL.
  ok(!url.includes('undefined') && !url.includes('localhost'), 'url has a real origin (VPS_UPLOAD_ORIGIN is set)');

  // ── 6. The file is actually readable afterwards ───────────────────────────
  // The step that proves the whole thing: a URL that 404s is a photo the run
  // recap, the feed and staff review will all render as a broken image.
  step('6. File readable back');
  const get = await fetch(url);
  ok(get.status === 200, `GET ${url} -> ${get.status}`);
  if (get.status === 200) {
    const back = Buffer.from(await get.arrayBuffer());
    ok(back.length === JPEG.length && back.equals(JPEG), `bytes match (${back.length}/${JPEG.length})`);
    ok(
      (get.headers.get('content-type') || '').startsWith('image/jpeg'),
      `served as image/jpeg — ${get.headers.get('content-type')}`,
    );
    ok(
      get.headers.get('x-content-type-options') === 'nosniff',
      'served with X-Content-Type-Options: nosniff',
    );
  }

  // ── 7. The refusals must still refuse ─────────────────────────────────────
  step('7. Guards still hold');
  const idor = await fetch(`${ORIGIN}/upload?path=${encodeURIComponent(`runs/${runId}/teams/someone-else/x.jpg`)}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: JPEG,
  });
  ok(idor.status === 403, `another team's folder -> ${idor.status} (want 403)`);

  const traversal = await fetch(`${ORIGIN}/upload?path=${encodeURIComponent('runs/../../etc/passwd')}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: JPEG,
  });
  ok(traversal.status === 400, `path traversal -> ${traversal.status} (want 400)`);

  const badType = await fetch(`${ORIGIN}/upload?path=${encodeURIComponent(`runs/${runId}/teams/${uid}/x.svg`)}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/svg+xml' }, body: JPEG,
  });
  ok(badType.status === 400, `disallowed content type -> ${badType.status} (want 400)`);

  const empty = await fetch(`${ORIGIN}/upload?path=${encodeURIComponent(`runs/${runId}/teams/${uid}/empty.jpg`)}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'image/jpeg' }, body: Buffer.alloc(0),
  });
  ok(empty.status === 400, `empty body -> ${empty.status} (want 400)`);

  // Audio, since the voice-recorder fallback relies on the phone's own formats.
  const audio = await fetch(`${ORIGIN}/upload?path=${encodeURIComponent(`runs/${runId}/teams/${uid}/clip.m4a`)}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'audio/x-m4a' }, body: Buffer.from([0, 1, 2, 3]),
  });
  ok(audio.status === 200, `audio/x-m4a (phone recorder) -> ${audio.status} (want 200)`);

  return finish();
}

function finish() {
  console.log(`\n${'─'.repeat(60)}`);
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m✓ Uploads work end to end — ${passed} checks passed.\x1b[0m\n`);
  } else {
    console.error(`\x1b[31m\x1b[1m✗ ${failed} check(s) failed (${passed} passed):\x1b[0m`);
    for (const f of failures) console.error(`   • ${f}`);
    console.error('\n  Photo upload is BROKEN for players. See VPS_UPLOADS.md.\n');
  }
  // Set the code and let Node drain rather than calling process.exit(): exiting
  // while undici's keep-alive sockets are still closing trips a libuv assertion
  // on Windows ("!(handle->flags & UV_HANDLE_CLOSING)") and the shell then sees
  // 127 instead of our real result — a gate that reports the wrong answer is
  // worse than no gate. The unref'd timer is the backstop so a lingering socket
  // can never hang CI; it fires only if Node has not already exited on its own.
  process.exitCode = failed === 0 ? 0 : 1;
  setTimeout(() => process.exit(process.exitCode), 1500).unref();
}

main().catch((e) => { console.error('\n✗ health check crashed:', e); process.exit(1); });

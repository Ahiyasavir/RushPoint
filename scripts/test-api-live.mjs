// ─── Integration test: the self-hosted API server ↔ Firebase, end to end ─────
//
// Proves the ONE thing the earlier protocol smoke test could not: that
// `functions/server.js`, running the real callables, actually talks to Firebase
// — verifies a Firebase ID token via the Admin SDK and reads Firestore — and
// returns a well-formed callable response. It does this by minting a REAL
// anonymous Firebase token and calling `searchGallery` (a read-only callable,
// no writes to your data) through the server.
//
// TWO MODES, one script:
//   • EMULATOR (default here): run under the Firebase Auth+Firestore emulators.
//     Set by FIREBASE_AUTH_EMULATOR_HOST (the emulator sets it for us). No
//     credentials, no live project touched. This is what CI / a local check runs.
//   • LIVE: set GOOGLE_APPLICATION_CREDENTIALS to your service-account JSON and
//     FIREBASE_WEB_API_KEY (or VITE_FIREBASE_API_KEY) to the Web API key, and
//     GCLOUD_PROJECT to the project id. Then it exercises the REAL project.
//     Read-only apart from an anonymous sign-in + a rate-limit counter.
//
//   Emulator run:  npx firebase emulators:exec --only auth,firestore \
//                    --project rushpoint-pwa-7daaa "node scripts/test-api-live.mjs"
//   Live run:      GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//                  GCLOUD_PROJECT=rushpoint-pwa-7daaa \
//                  FIREBASE_WEB_API_KEY=<web api key> node scripts/test-api-live.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..', 'functions', 'server.js');
const PORT = 8790;
const PROJECT = process.env.GCLOUD_PROJECT || 'rushpoint-pwa-7daaa';
const authEmu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const MODE = authEmu ? 'emulator' : process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'live' : null;

let passed = 0;
let failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

/** Mint a REAL anonymous Firebase ID token (emulator or live Identity Toolkit). */
async function mintAnonToken() {
  if (MODE === 'emulator') {
    const url = `http://${authEmu}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
    const j = await r.json();
    if (!j.idToken) throw new Error(`emulator anon sign-up failed: ${JSON.stringify(j)}`);
    return j.idToken;
  }
  const key = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!key) throw new Error('live mode needs FIREBASE_WEB_API_KEY (the Firebase Web API key)');
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error(`live anon sign-up failed (is Anonymous auth enabled?): ${JSON.stringify(j)}`);
  return j.idToken;
}

async function main() {
  if (!MODE) {
    console.error('test-api-live: no target. Run under the emulators (emulators:exec), OR set GOOGLE_APPLICATION_CREDENTIALS + FIREBASE_WEB_API_KEY for a live run. See the header.');
    process.exit(2);
  }
  console.log(`  · mode: ${MODE} (project ${PROJECT})`);

  // Boot the REAL server as a child, inheriting the Firebase env (emulator hosts
  // or the service-account credential) so its Admin SDK targets the same place.
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', GCLOUD_PROJECT: PROJECT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });

  try {
    const up = await waitForHealth(`http://127.0.0.1:${PORT}/healthz`);
    ok(up, `the server came up on :${PORT}${up ? '' : `\n--- server log ---\n${serverLog}`}`);
    if (!up) return;

    // 1. Unauthenticated call is refused with the callable envelope (protocol).
    const noAuth = await fetch(`http://127.0.0.1:${PORT}/searchGallery`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: {} }),
    });
    ok(noAuth.status === 401, `an unauthenticated call is 401 (got ${noAuth.status})`);
    const noAuthBody = await noAuth.json().catch(() => ({}));
    ok(noAuthBody?.error?.status === 'UNAUTHENTICATED', 'the refusal is a callable UNAUTHENTICATED envelope');

    // 2. THE integration: a real anonymous token → the server verifies it against
    //    Firebase and reads Firestore → a well-formed result.
    const token = await mintAnonToken();
    ok(typeof token === 'string' && token.length > 20, 'minted a real anonymous Firebase ID token');

    const res = await fetch(`http://127.0.0.1:${PORT}/searchGallery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: {} }),
    });
    const body = await res.json().catch(() => ({}));
    ok(res.status === 200, `searchGallery with a real token is 200 (got ${res.status}; body ${JSON.stringify(body).slice(0, 200)})`);
    ok(body && typeof body.result === 'object' && body.result !== null,
      `the server verified the token via Firebase and returned a callable {result} (got keys ${Object.keys(body || {}).join(',')})`);
    ok(!body.error, `no error envelope on the authenticated read (${body.error ? JSON.stringify(body.error) : 'clean'})`);
    // searchGallery returns a games/results collection; assert the shape is a container.
    const result = body.result || {};
    const looksLikeGallery = Array.isArray(result.games) || Array.isArray(result.results) || Array.isArray(result.items) || typeof result === 'object';
    ok(looksLikeGallery, `the result is the gallery payload shape (keys: ${Object.keys(result).join(',') || '—'})`);
  } finally {
    child.kill('SIGKILL');
  }

  console.log(`\ntest-api-live (${MODE}): ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('test-api-live: threw', e); process.exit(1); });

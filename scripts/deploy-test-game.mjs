#!/usr/bin/env node
// Put the deploy test game in the organizer's creator account (Ahiya, 2026-10-05: every deploy,
// automatically, so he never builds a test game by hand). Title: `deploy <YYYY-MM-DD>`.
//
//   npm run deploy:test-game -- --uid <creator uid> [--date 2026-10-05] [--notes docs/deploy-checks/<date>.notes.json] [--dry-run]
//
// The game goes through the REAL importGameFile callable on the production API, signed in as that
// creator, so it gets exactly the validation and the account placement of any imported game. The
// sign-in: the API container mints a custom token for the uid (Admin SDK, over SSH: only the VPS
// holds the service account), which is exchanged for an ID token with the creator app's public API
// key. Idempotent: a game with the same title already in the account is left alone.
//
// The template is scripts/lib/deployTestGame.mjs, pinned by scripts/test-deploy-test-game.ts.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildDeployTestGame } from './lib/deployTestGame.mjs';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const uid = arg('uid') ?? process.env.DEPLOY_TEST_GAME_UID;
const date = arg('date') ?? new Date().toISOString().slice(0, 10);
const notesPath = arg('notes');
const dryRun = args.includes('--dry-run');
const VPS = process.env.RUSHPOINT_VPS ?? 'root@31.70.107.184';
const API = process.env.RUSHPOINT_API_ORIGIN ?? 'https://api.rush-point.com';
const ORIGIN = 'https://creator.rush-point.com';

if (!uid || !/^[A-Za-z0-9]{10,64}$/.test(uid)) {
  console.error('usage: npm run deploy:test-game -- --uid <creator uid> [--date YYYY-MM-DD] [--notes file.json] [--dry-run]');
  process.exit(1);
}
const notes = notesPath ? JSON.parse(readFileSync(notesPath, 'utf8')) : {};
const file = buildDeployTestGame(date, notes);
const title = file.game.title;
if (dryRun) { console.log(JSON.stringify(file, null, 2)); process.exit(0); }

function apiKey() {
  const env = readFileSync(new URL('../apps/creator-web/.env', import.meta.url), 'utf8');
  const m = env.match(/^VITE_FIREBASE_API_KEY=(.+)$/m);
  if (!m) throw new Error('VITE_FIREBASE_API_KEY missing from apps/creator-web/.env');
  return m[1].trim().replace(/^"|"$/g, '');
}

// 1. A custom token for the creator, minted where the service account lives.
const mint = `docker exec rushpoint-api-1 node -e "const a=require('firebase-admin');a.apps.length||a.initializeApp();a.auth().createCustomToken('${uid}').then(t=>{process.stdout.write(t);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"`;
const customToken = execFileSync('ssh', ['-o', 'BatchMode=yes', VPS, mint], { encoding: 'utf8' }).trim();

// 2. Exchange it for an ID token.
const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey()}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: customToken, returnSecureToken: true }),
});
const { idToken } = await signIn.json();
if (!idToken) throw new Error(`sign-in failed: HTTP ${signIn.status}`);

async function call(name, data) {
  const res = await fetch(`${API}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, Origin: ORIGIN },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`${name}: HTTP ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 400)}`);
  return body.result;
}

// 3. Idempotent: one test game per deploy day.
const listed = await call('listGames', {});
const existing = (listed?.games ?? []).find((g) => g.title === title);
if (existing) {
  console.log(`= "${title}" is already in the account (${existing.id}); left as it is.`);
  process.exit(0);
}

// 4. Create it through the real import door.
const created = await call('importGameFile', { file });
const gameId = created?.gameId ?? created?.id;
console.log(`✓ "${title}" created${gameId ? `: ${ORIGIN}/build/${gameId}` : ''}`);

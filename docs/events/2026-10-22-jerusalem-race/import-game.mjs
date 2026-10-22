#!/usr/bin/env node
// Put game.json into a creator's account through the REAL importGameFile callable on production,
// signed in as that creator: the same door, validation and placement as any imported game. Same
// sign-in as scripts/deploy-test-game.mjs (a custom token minted on the VPS, which alone holds the
// service account). Idempotent: a game with the same title already in the account is left alone.
//
//   node docs/events/2026-10-22-jerusalem-race/import-game.mjs --email <creator email> [--dry-run]
//   node docs/events/2026-10-22-jerusalem-race/import-game.mjs --uid <creator uid> [--file game-v3.json]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const VPS = process.env.RUSHPOINT_VPS ?? 'root@31.70.107.184';
const API = 'https://api.rush-point.com';
const ORIGIN = 'https://creator.rush-point.com';
const file = JSON.parse(readFileSync(new URL(`./${arg('file') ?? 'game.json'}`, import.meta.url), 'utf8'));
const title = file.game.title;

const admin = (js) => execFileSync('ssh', ['-o', 'BatchMode=yes', VPS,
  `docker exec rushpoint-api-1 node -e "const a=require('firebase-admin');a.apps.length||a.initializeApp();${js}"`],
  { encoding: 'utf8' }).trim();

let uid = arg('uid');
const email = arg('email');
if (!uid && email) {
  if (!/^[^\s@'"\\$`]+@[^\s@'"\\$`]+$/.test(email)) throw new Error('bad email');
  uid = admin(`a.auth().getUserByEmail('${email}').then(u=>{process.stdout.write(u.uid);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})`);
}
if (!uid || !/^[A-Za-z0-9]{10,64}$/.test(uid)) { console.error('usage: --email <email> | --uid <uid> [--dry-run]'); process.exit(1); }
console.log(`account: ${email ?? ''} ${uid}`);
if (args.includes('--dry-run')) { console.log(`would import "${title}"`); process.exit(0); }

const env = readFileSync(new URL('../../../apps/creator-web/.env', import.meta.url), 'utf8');
const key = env.match(/^VITE_FIREBASE_API_KEY=(.+)$/m)?.[1].trim().replace(/^"|"$/g, '');
const customToken = admin(`a.auth().createCustomToken('${uid}').then(t=>{process.stdout.write(t);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})`);
const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`, {
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

const checkId = arg('check');
if (checkId) {
  const r = await call('getGame', { gameId: checkId });
  const g = r?.game ?? r;
  for (const st of g.stages) {
    console.log(`stage ${st.order} "${st.title}" story=${st.narrative?.intro ? 'yes' : 'no'} tasks=${st.tasks.length} required=${st.requiredTaskCount ?? '-'} groups=${(st.exclusiveGroups ?? []).length}`);
    for (const t of st.tasks) console.log(`  ${t.id} ${t.type} cap=${t.maxConcurrentTeams} ${t.coordinates.lat},${t.coordinates.lng}${t.hideLocation ? ' hidden' : ''}${t.releaseAt ? ' from ' + t.releaseAt : ''}${t.expiresAt ? ' until ' + t.expiresAt : ''}${t.smart?.secretCode ? ' code' : ''}${t.answerOutcomes ? ' outcomes=' + t.answerOutcomes.length : ''}${t.unlockAfterTaskIds ? ' after=' + t.unlockAfterTaskIds.join(',') : ''}${t.pausesTimer ? ' pausesTimer' : ''} trigger=${t.triggerMode}`);
  }
  process.exit(0);
}
const existing = ((await call('listGames', {}))?.games ?? []).find((g) => g.title === title);
if (existing) { console.log(`= "${title}" already there: ${ORIGIN}/build/${existing.id}`); process.exit(0); }
const created = await call('importGameFile', { file });
const gameId = created?.gameId ?? created?.id;
console.log(`✓ "${title}" created${gameId ? `: ${ORIGIN}/build/${gameId}` : ''}`);

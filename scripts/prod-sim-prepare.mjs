// ═══════════════════════════════════════════════════════════════════════════════
// Prepare a PRODUCTION load simulation: copy a real game into the running account
// and emit the plan file simulate-prod.mjs consumes.
//
//   node scripts/prod-sim-prepare.mjs --source=<game.json> --owner-token=<token> \
//        --confirm-project=rushpoint-pwa-7daaa --out=plan.json
//
// WHY IT IMPORTS RATHER THAN WRITING FIRESTORE. The copy goes in through the
// product's own `importGameFile` callable, so it passes exactly the validation an
// authored game passes (parseGameFile → stagesProblems → enforced settings). A copy
// written straight to Firestore with the Admin SDK would bypass all of that and could
// produce a game the Builder itself would refuse — which would make any conclusion
// drawn from the simulation worthless.
//
// The simulated game is titled with a loud prefix so it is obvious in the creator's
// console and trivial to delete afterwards. It is never launched in the SOURCE
// creator's account: the source is only read.
// ═══════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=')[1] ?? d;
const SOURCE = arg('source', '');
const OUT = arg('out', 'plan.json');
const OWNER_TOKEN = arg('owner-token', process.env.RUSHPOINT_OWNER_TOKEN ?? '');
const CONFIRM = arg('confirm-project', '');
const TITLE_PREFIX = arg('title-prefix', '[SIM] ');

function readEnvFile(p) {
  const out = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = readEnvFile('apps/play-web/.env');
const PROJECT = env.VITE_FIREBASE_PROJECT_ID;
const API_ORIGIN = (env.VITE_API_ORIGIN || '').trim();

if (!SOURCE || !OWNER_TOKEN) { console.error('--source and --owner-token are required'); process.exit(2); }
if (CONFIRM !== PROJECT) {
  console.error(`REFUSING: --confirm-project must equal ${PROJECT} (this writes production data).`);
  process.exit(2);
}

const src = JSON.parse(readFileSync(SOURCE, 'utf8'));

// Build the export envelope by hand from the source document. Keys mirror
// packages/shared/src/gameFile.ts (GAME_FILE_FORMAT / CURRENT_GAME_FILE_VERSION);
// the callable re-validates every one of them, so a drift here fails loudly there
// rather than importing something subtly different.
const file = {
  format: 'rushpoint.game',
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  game: {
    title: `${TITLE_PREFIX}${src.title}`,
    mode: src.mode,
    scoringPreset: src.scoringPreset,
    ...(src.safeZone ? { safeZone: src.safeZone } : {}),
    stages: src.stages,
  },
};

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: PROJECT,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}, 'prod-sim-prepare');
const auth = getAuth(app);
const functions = getFunctions(app, API_ORIGIN);

const cred = await signInWithCustomToken(auth, OWNER_TOKEN);
console.log(`signed in as ${cred.user.uid}`);

const res = (await httpsCallable(functions, 'importGameFile')({ file })).data;
const gameId = res?.gameId ?? res?.id;
if (!gameId) { console.error('importGameFile returned no gameId:', JSON.stringify(res)); process.exit(1); }
console.log(`imported: ${gameId}  "${file.game.title}"`);

// Centre the simulated walking on the game's own safe zone when it has one, so the
// pings the sim sends are inside the boundary the creator actually drew.
const center = src.safeZone?.center
  ?? src.stages?.[0]?.tasks?.find((t) => t.coordinates)?.coordinates
  ?? { lat: 31.805, lng: 35.185 };

writeFileSync(OUT, JSON.stringify({
  gameId, ownerUid: cred.user.uid, center,
  title: file.game.title, stages: src.stages,
}, null, 2));
console.log(`plan written: ${OUT}`);
process.exit(0);

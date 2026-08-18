// Seed ONE game into the local emulator to demo הקמה מהירה / Quick Setup
// (change: quick-setup-wizard).
//
// It takes a real exported .rushpoint.json — the kind that carries its setup
// instructions INSIDE the prose participants read
// ("[הערת מפעיל - למחוק]: הגדירו את המיקום…") — runs `extractQuickSetupSteps` over
// it, and writes the CLEANED game plus its `wizardSteps` to the demo creator.
//
// Emulator only, by construction: it talks to FIRESTORE_EMULATOR_HOST and refuses
// to run without it, so it can never touch real creator data.
//
//   node scripts/seed-quick-setup-demo.mjs "<path to .rushpoint.json>"
import fs from 'node:fs';
import admin from 'firebase-admin';
import { extractQuickSetupSteps } from '@rushpoint/shared';

const PROJECT_ID = 'rushpoint-pwa-7daaa';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  console.error('[qs-demo] refusing to run against a non-local Firestore.');
  process.exit(1);
}

const OWNER_UID = 'demo-creator';
const GAME_ID = 'demo-game-quicksetup';

const filePath = process.argv[2];
if (!filePath) {
  console.error('[qs-demo] usage: node scripts/seed-quick-setup-demo.mjs "<path to .rushpoint.json>"');
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const source = parsed.game ?? parsed;

const extraction = extractQuickSetupSteps(source);
const now = new Date().toISOString();

const game = {
  ...source,
  id: GAME_ID,
  ownerUid: OWNER_UID,
  stages: extraction.stages,
  ...(extraction.instructions ? { instructions: extraction.instructions } : {}),
  wizardSteps: extraction.wizardSteps,
  visibility: 'private',
  playCount: 0,
  createdAt: now,
  updatedAt: now,
};

await db.doc(`users/${OWNER_UID}/games/${GAME_ID}`).set(game);

console.log(`[qs-demo] wrote users/${OWNER_UID}/games/${GAME_ID}`);
console.log(`[qs-demo] ${extraction.wizardSteps.length} quick setup step(s):`);
for (const s of extraction.wizardSteps) {
  console.log(`  · ${s.isRequired ? 'REQUIRED' : 'optional'}  ${s.targetFieldPath.padEnd(16)}  ${s.instructionPrompt.slice(0, 90)}`);
}
console.log('\n[qs-demo] open  http://127.0.0.1:5180/build/' + GAME_ID);
process.exit(0);

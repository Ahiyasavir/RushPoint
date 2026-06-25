// Security-rules verification — the anti-cheat + multi-tenant-isolation gate.
//
// This is the single most important launch test: it proves, against the REAL
// firestore.rules + storage.rules running in the emulator, that a malicious
// client CANNOT write scores/runs/teams/wallets, CANNOT read another tenant's
// data, and CANNOT upload arbitrary files. The whole "server-write-only" model
// (every score goes through a Cloud Function) is only as trustworthy as these
// rules — so we assert them directly.
//
// Emulator-bound (like e2e-verify.mjs), so it is NOT part of the always-green
// `npm test` unit gate. Run it against the running emulator:
//
//   npm install            # once, to pull @firebase/rules-unit-testing
//   npm run dev:all        # (or just the emulator) in another terminal
//   npm run test:rules
//
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'rushpoint-rules-test';

let failures = 0;
async function check(label, promise) {
  try {
    await promise;
    console.log(`PASS  ${label}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${label} :: ${e?.message ?? e}`);
  }
}

const OWNER = 'owner-uid';
const OTHER = 'other-uid';
const TEAM = 'team-uid';
const TEAM2 = 'team2-uid';
const GAME = 'game-1';
const RUN = 'run-1';

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync(join(root, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(join(root, 'storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });

  // Seed server-side state (bypasses rules) so read-permission tests have targets.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${OWNER}`), { displayName: 'Owner' });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}`), { title: 'G' });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}`), { status: 'live' });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/teams/${TEAM}`), { score: 0 });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/teams/${TEAM2}`), { score: 0 });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/alerts/a1`), { type: 'sos' });
    await setDoc(doc(db, `wallets/${OWNER}`), { eventCredits: 5 });
    await setDoc(doc(db, `publicGames/${GAME}`), { title: 'Public' });
    await setDoc(doc(db, `accessCodes/ABC123`), { ownerUid: OWNER, gameId: GAME, runId: RUN });
    await setDoc(doc(db, `auditLogs/log1`), { action: 'x' });
  });

  const owner = testEnv.authenticatedContext(OWNER).firestore();
  const other = testEnv.authenticatedContext(OTHER).firestore();
  const team = testEnv.authenticatedContext(TEAM).firestore();
  const anon = testEnv.unauthenticatedContext().firestore();
  const staff = testEnv
    .authenticatedContext('staff-uid', { staff: true, ownerUid: OWNER, gameId: GAME, runId: RUN })
    .firestore();
  const wrongStaff = testEnv
    .authenticatedContext('staff2', { staff: true, ownerUid: OWNER, gameId: GAME, runId: 'OTHER-RUN' })
    .firestore();

  const runPath = `users/${OWNER}/games/${GAME}/runs/${RUN}`;

  console.log('\n── Anti-cheat: server-write-only state is unwritable by clients ──');
  await check('owner CANNOT write a run doc (CF-only)', assertFails(setDoc(doc(owner, runPath), { status: 'hacked' })));
  await check('team CANNOT write its own team doc (no score self-edit)', assertFails(setDoc(doc(team, `${runPath}/teams/${TEAM}`), { score: 9999 })));
  await check('owner CANNOT write a team doc', assertFails(setDoc(doc(owner, `${runPath}/teams/${TEAM}`), { score: 9999 })));
  await check('client CANNOT write a wallet (credits)', assertFails(setDoc(doc(owner, `wallets/${OWNER}`), { eventCredits: 99999 })));
  await check('client CANNOT write an alert', assertFails(setDoc(doc(team, `${runPath}/alerts/x`), { type: 'sos' })));
  await check('client CANNOT write publicGames (gallery is CF-only)', assertFails(setDoc(doc(owner, `publicGames/${GAME}`), { title: 'x' })));
  await check('client CANNOT write auditLogs', assertFails(setDoc(doc(owner, `auditLogs/x`), { action: 'x' })));
  await check('default-deny: client CANNOT touch an unmatched collection', assertFails(setDoc(doc(owner, `random/x`), { a: 1 })));

  console.log('\n── Multi-tenant isolation: cross-tenant reads are denied ──');
  await check('owner CAN read own profile', assertSucceeds(getDoc(doc(owner, `users/${OWNER}`))));
  await check('other user CANNOT read owner profile', assertFails(getDoc(doc(other, `users/${OWNER}`))));
  await check('other user CANNOT read owner game template', assertFails(getDoc(doc(other, `users/${OWNER}/games/${GAME}`))));
  await check('owner CAN read any team in the run', assertSucceeds(getDoc(doc(owner, `${runPath}/teams/${TEAM}`))));
  await check('team CAN read ITS OWN team doc', assertSucceeds(getDoc(doc(team, `${runPath}/teams/${TEAM}`))));
  await check('team CANNOT read ANOTHER team doc', assertFails(getDoc(doc(team, `${runPath}/teams/${TEAM2}`))));
  await check('other user CANNOT read the wallet', assertFails(getDoc(doc(other, `wallets/${OWNER}`))));
  await check('nobody can read auditLogs (CF-only)', assertFails(getDoc(doc(owner, `auditLogs/log1`))));

  console.log('\n── Staff scoping: a staff token is confined to its one run ──');
  await check('scoped staff CAN read a team in its run', assertSucceeds(getDoc(doc(staff, `${runPath}/teams/${TEAM}`))));
  await check('scoped staff CAN read alerts in its run', assertSucceeds(getDoc(doc(staff, `${runPath}/alerts/a1`))));
  await check('staff for a DIFFERENT run CANNOT read this run\'s team', assertFails(getDoc(doc(wrongStaff, `${runPath}/teams/${TEAM}`))));

  console.log('\n── Public/join reads behave as designed ──');
  await check('anyone (even anon) CAN read publicGames', assertSucceeds(getDoc(doc(anon, `publicGames/${GAME}`))));
  await check('authed user CAN read an access code to join', assertSucceeds(getDoc(doc(team, `accessCodes/ABC123`))));
  await check('anon CANNOT read an access code (auth required)', assertFails(getDoc(doc(anon, `accessCodes/ABC123`))));
  await check('owner CAN write own game template (builder responsiveness)', assertSucceeds(setDoc(doc(owner, `users/${OWNER}/games/${GAME}`), { title: 'edited' })));

  console.log('\n── Storage: photo uploads are owner+type+size gated ──');
  const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // tiny jpeg-ish
  const big = new Uint8Array(11 * 1024 * 1024); // >10MB
  const teamStore = testEnv.authenticatedContext(TEAM).storage();
  const team2Store = testEnv.authenticatedContext(TEAM2).storage();
  const anonStore = testEnv.unauthenticatedContext().storage();
  const meta = { contentType: 'image/jpeg' };
  await check('team CAN upload an image to its OWN run folder', assertSucceeds(uploadBytes(ref(teamStore, `runs/${RUN}/teams/${TEAM}/p.jpg`), img, meta)));
  await check('team CANNOT upload into ANOTHER team folder', assertFails(uploadBytes(ref(team2Store, `runs/${RUN}/teams/${TEAM}/p.jpg`), img, meta)));
  await check('non-image content type is rejected', assertFails(uploadBytes(ref(teamStore, `runs/${RUN}/teams/${TEAM}/p.txt`), img, { contentType: 'text/plain' })));
  await check('>10MB upload is rejected', assertFails(uploadBytes(ref(teamStore, `runs/${RUN}/teams/${TEAM}/big.jpg`), big, meta)));
  await check('client CANNOT write the CF-only public stream', assertFails(uploadBytes(ref(teamStore, `stream/x.jpg`), img, meta)));
  await check('authed user CAN read a checkin photo', assertSucceeds(getBytes(ref(teamStore, `runs/${RUN}/teams/${TEAM}/p.jpg`)).catch(() => { throw new Error('read denied'); })));
  await check('anon CANNOT read a photo (auth required)', assertFails(getBytes(ref(anonStore, `runs/${RUN}/teams/${TEAM}/p.jpg`))));

  await testEnv.cleanup();
  console.log(`\n${failures === 0 ? 'ALL SECURITY-RULES TESTS PASSED' : failures + ' RULES TEST(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Rules test harness error (is the emulator running? is @firebase/rules-unit-testing installed?):', e);
  process.exit(1);
});

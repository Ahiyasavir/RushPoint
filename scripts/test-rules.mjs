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
import { doc, getDoc, getDocs, collection, setDoc } from 'firebase/firestore';
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
const DEVICE = 'device-uid'; // a phone attached to TEAM (listed in deviceUids)
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
    // team-hq-chat: one thread doc per team; deviceUids mirrored so isAttachedDevice() applies.
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/chat/${TEAM}`),
      { teamId: TEAM, deviceUids: [TEAM, DEVICE], messages: [], updatedAt: '2020-01-01T00:00:00Z' });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/chat/${TEAM2}`),
      { teamId: TEAM2, deviceUids: [TEAM2], messages: [], updatedAt: '2020-01-01T00:00:00Z' });
    // Live-ops content (fix-i18n-leaks-and-feed-authz): feed carries participant
    // PII (photoUrl + teamName); reads are run-scoped, not any-authed.
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/feedItems/f1`),
      { active: true, photoUrl: 'https://example/p.jpg', teamName: 'Lions', taskTitle: 'Mural' });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/announcements/an1`), { title: 'Go' });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/flashMissions/fm1`), { title: 'Flash' });
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
  // [callable-rate-limiting #19] per-uid rate-limit counters are server-only.
  await check('client CANNOT read a rateLimits counter', assertFails(getDoc(doc(owner, `rateLimits/triggerSOS__${OWNER}`))));
  await check('client CANNOT write a rateLimits counter', assertFails(setDoc(doc(owner, `rateLimits/triggerSOS__${OWNER}`), { count: 0 })));
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
  // [anti-cheat row 39] join by a KNOWN code works (get), but the collection
  // cannot be enumerated (list) — that would leak every run's identifiers.
  await check('accessCodes: get by known code is allowed', assertSucceeds(getDoc(doc(other, `accessCodes/ABC123`))));
  await check('accessCodes: listing the collection is denied', assertFails(getDocs(collection(other, `accessCodes`))));

  console.log('\n── Staff scoping: a staff token is confined to its one run ──');
  await check('scoped staff CAN read a team in its run', assertSucceeds(getDoc(doc(staff, `${runPath}/teams/${TEAM}`))));
  await check('scoped staff CAN read alerts in its run', assertSucceeds(getDoc(doc(staff, `${runPath}/alerts/a1`))));
  await check('staff for a DIFFERENT run CANNOT read this run\'s team', assertFails(getDoc(doc(wrongStaff, `${runPath}/teams/${TEAM}`))));

  console.log('\n── Team ↔ HQ chat: read surface mirrors the team doc; writes CF-only ──');
  const device = testEnv.authenticatedContext(DEVICE).firestore();
  const chatPath = `${runPath}/chat/${TEAM}`;
  await check('founder CAN read its own chat doc', assertSucceeds(getDoc(doc(team, chatPath))));
  await check('attached device CAN read the team chat doc', assertSucceeds(getDoc(doc(device, chatPath))));
  await check('scoped staff CAN read a chat doc', assertSucceeds(getDoc(doc(staff, chatPath))));
  await check('scoped staff CAN list the chat collection', assertSucceeds(getDocs(collection(staff, `${runPath}/chat`))));
  await check('owner CAN read a chat doc', assertSucceeds(getDoc(doc(owner, chatPath))));
  await check('owner CAN list the chat collection', assertSucceeds(getDocs(collection(owner, `${runPath}/chat`))));
  await check('another team CANNOT read this team\'s chat doc', assertFails(getDoc(doc(team, `${runPath}/chat/${TEAM2}`))));
  await check('stranger CANNOT read a chat doc', assertFails(getDoc(doc(other, chatPath))));
  await check('staff for a DIFFERENT run CANNOT read a chat doc', assertFails(getDoc(doc(wrongStaff, chatPath))));
  await check('participant CANNOT list the chat collection', assertFails(getDocs(collection(team, `${runPath}/chat`))));
  await check('client CANNOT write a chat doc (CF-only)', assertFails(setDoc(doc(team, chatPath), { messages: [] })));
  await check('owner CANNOT write a chat doc (CF-only)', assertFails(setDoc(doc(owner, chatPath), { messages: [] })));
  await check('staff CANNOT write a chat doc (CF-only)', assertFails(setDoc(doc(staff, chatPath), { messages: [] })));

  console.log('\n── Live-ops feed & broadcasts: run-scoped reads only (feed carries participant PII) ──');
  const feedDoc = `${runPath}/feedItems/f1`;
  await check('run participant CAN read the feed', assertSucceeds(getDoc(doc(team, feedDoc))));
  await check('run participant CAN list the feed collection', assertSucceeds(getDocs(collection(team, `${runPath}/feedItems`))));
  await check('run owner CAN read the feed', assertSucceeds(getDoc(doc(owner, feedDoc))));
  await check('scoped staff CAN read the feed', assertSucceeds(getDoc(doc(staff, feedDoc))));
  await check('a stranger (not a participant) CANNOT read the feed', assertFails(getDoc(doc(other, feedDoc))));
  await check('a stranger CANNOT list the feed collection', assertFails(getDocs(collection(other, `${runPath}/feedItems`))));
  await check('staff for a DIFFERENT run CANNOT read the feed', assertFails(getDoc(doc(wrongStaff, feedDoc))));
  await check('an anonymous user CANNOT read the feed', assertFails(getDoc(doc(anon, feedDoc))));
  // Announcements + flash missions share the same run-scoped read surface.
  await check('run participant CAN read announcements', assertSucceeds(getDoc(doc(team, `${runPath}/announcements/an1`))));
  await check('a stranger CANNOT read announcements', assertFails(getDoc(doc(other, `${runPath}/announcements/an1`))));
  await check('a stranger CANNOT read flash missions', assertFails(getDoc(doc(other, `${runPath}/flashMissions/fm1`))));

  console.log('\n── Public/join reads behave as designed ──');
  await check('anyone (even anon) CAN read publicGames', assertSucceeds(getDoc(doc(anon, `publicGames/${GAME}`))));
  await check('authed user CAN read an access code to join', assertSucceeds(getDoc(doc(team, `accessCodes/ABC123`))));
  await check('anon CANNOT read an access code (auth required)', assertFails(getDoc(doc(anon, `accessCodes/ABC123`))));
  await check('owner CAN write own game template (builder responsiveness)', assertSucceeds(setDoc(doc(owner, `users/${OWNER}/games/${GAME}`), { title: 'edited' })));

  console.log('\n── Discovery POIs: coordinates are server-secret ──');
  // Seed a POI with admin privileges (bypasses rules).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${OWNER}/games/${GAME}/discoveryPois/poi1`),
      { id: 'poi1', coordinates: { lat: 31.79, lng: 35.16 }, answers: ['secret'], bonusPoints: 50 });
  });
  await check('owner CAN read a discovery POI', assertSucceeds(getDoc(doc(owner, `users/${OWNER}/games/${GAME}/discoveryPois/poi1`))));
  await check('owner CAN list discovery POIs', assertSucceeds(getDocs(collection(owner, `users/${OWNER}/games/${GAME}/discoveryPois`))));
  await check('owner CAN write a discovery POI', assertSucceeds(setDoc(doc(owner, `users/${OWNER}/games/${GAME}/discoveryPois/poi2`), { id: 'poi2', bonusPoints: 10 })));
  await check('play client CANNOT read a discovery POI (coords secret)', assertFails(getDoc(doc(team, `users/${OWNER}/games/${GAME}/discoveryPois/poi1`))));
  await check('play client CANNOT list discovery POIs', assertFails(getDocs(collection(team, `users/${OWNER}/games/${GAME}/discoveryPois`))));
  await check('other user CANNOT write a discovery POI', assertFails(setDoc(doc(other, `users/${OWNER}/games/${GAME}/discoveryPois/poi3`), { id: 'poi3' })));

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
  // ── Photo READ privacy: a participant must only read their OWN photos. A team
  //    folder is keyed by uid, so a malicious participant who knows the runId
  //    must NOT be able to list/download other teams' photos (faces, locations).
  const staffStore = testEnv.authenticatedContext('staff-uid', { staff: true, ownerUid: OWNER, gameId: GAME, runId: RUN }).storage();
  const wrongStaffStore = testEnv.authenticatedContext('staff2', { staff: true, ownerUid: OWNER, gameId: GAME, runId: 'OTHER-RUN' }).storage();
  await check('a team CAN read its OWN photo', assertSucceeds(getBytes(ref(teamStore, `runs/${RUN}/teams/${TEAM}/p.jpg`))));
  await check('a DIFFERENT team CANNOT read another team\'s photo (privacy)', assertFails(getBytes(ref(team2Store, `runs/${RUN}/teams/${TEAM}/p.jpg`))));
  await check('scoped staff CAN read a team photo in its run', assertSucceeds(getBytes(ref(staffStore, `runs/${RUN}/teams/${TEAM}/p.jpg`))));
  await check('staff for a DIFFERENT run CANNOT read a team photo', assertFails(getBytes(ref(wrongStaffStore, `runs/${RUN}/teams/${TEAM}/p.jpg`))));
  await check('anon CANNOT read a photo (auth required)', assertFails(getBytes(ref(anonStore, `runs/${RUN}/teams/${TEAM}/p.jpg`))));

  await testEnv.cleanup();
  console.log(`\n${failures === 0 ? 'ALL SECURITY-RULES TESTS PASSED' : failures + ' RULES TEST(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Rules test harness error (is the emulator running? is @firebase/rules-unit-testing installed?):', e);
  process.exit(1);
});

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
import {
  doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, deleteField,
} from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
// Emulator ports come from ONE pure resolver (change: emulator-port-offset) so this gate
// can run on an offset block beside a live playtest. Unset ⇒ exactly today's ports.
import { resolveEmulatorPorts } from './lib/emulatorPorts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'rushpoint-rules-test';
const EMU = resolveEmulatorPorts(process.env);

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
      port: EMU.firestore,
    },
    storage: {
      rules: readFileSync(join(root, 'storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: EMU.storage,
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
    // staff-console-field-ops: the ONE staff↔admin thread doc for the run.
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/staffChannel/thread`),
      { runId: RUN, messages: [], updatedAt: '2020-01-01T00:00:00Z' });
    // Live-ops content (fix-i18n-leaks-and-feed-authz): feed carries participant
    // PII (photoUrl + teamName); reads are run-scoped, not any-authed.
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/feedItems/f1`),
      { active: true, photoUrl: 'https://example/p.jpg', teamName: 'Lions', taskTitle: 'Mural' });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/announcements/an1`), { title: 'Go' });
    // shared-team-devices: the reverse index joinTeamAsDevice writes for an
    // attached phone. It has NO team doc of its own, so this marker is the ONLY
    // thing that can make isRunParticipant() true for it.
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/deviceMembers/${DEVICE}`),
      { teamId: TEAM, deviceUid: DEVICE, joinedAt: '2020-01-01T00:00:00Z' });
    await setDoc(doc(db, `users/${OWNER}/games/${GAME}/runs/${RUN}/flashMissions/fm1`), { title: 'Flash' });
    await setDoc(doc(db, `wallets/${OWNER}`), { eventCredits: 5 });
    await setDoc(doc(db, `publicGames/${GAME}`), { title: 'Public', likeCount: 3, popularity: 1.5 });
    await setDoc(doc(db, `publicTasks/${GAME}_t1`), { title: 'Public task', copyCount: 2, likeCount: 1, popularity: 0.9 });
    // gallery-popularity-ranking: a like record. Clients may neither read nor
    // write it — like state reaches the UI through the gallery callables only.
    await setDoc(doc(db, `publicLikes/game_${GAME}_${OWNER}`),
      { kind: 'game', itemId: GAME, uid: OWNER, createdAt: '2026-01-01T00:00:00.000Z' });
    await setDoc(doc(db, `accessCodes/ABC123`), { ownerUid: OWNER, gameId: GAME, runId: RUN });
    await setDoc(doc(db, `auditLogs/log1`), { action: 'x' });
    // recoverable-game-deletion: a game already in the trash. The tombstone is
    // written ONLY by the deleteGame/restoreGame callables (Admin SDK), so a
    // client must be able neither to forge one nor to clear one.
    await setDoc(doc(db, `users/${OWNER}/games/TRASHED-GAME`),
      { title: 'Trashed', deletedAt: '2026-07-01T00:00:00.000Z', deletedBy: OWNER });
    // A second trashed game, so the hard-delete assertions below never depend on
    // (or disturb) the fixture the tombstone-forge assertions use.
    await setDoc(doc(db, `users/${OWNER}/games/TRASHED-GAME-2`),
      { title: 'Trashed 2', deletedAt: '2026-07-02T00:00:00.000Z', deletedBy: OWNER });
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
  // [gallery-popularity-ranking] Popularity is the ORDERING field of the public
  // gallery. If a client could write it (or the like counter it is derived from)
  // anyone could pin their own game to the top of the library forever.
  await check('client CANNOT write publicGames.popularity (ranking is CF-only)',
    assertFails(setDoc(doc(owner, `publicGames/${GAME}`), { popularity: 999 })));
  await check('client CANNOT write publicGames.likeCount',
    assertFails(setDoc(doc(owner, `publicGames/${GAME}`), { likeCount: 999 })));
  await check('client CANNOT write publicTasks.popularity',
    assertFails(setDoc(doc(owner, `publicTasks/${GAME}_t1`), { popularity: 999 })));
  await check('client CANNOT write publicTasks.likeCount',
    assertFails(setDoc(doc(other, `publicTasks/${GAME}_t1`), { likeCount: 999 })));
  // The like RECORD is what enforces one-like-per-user. A client that could write
  // it could forge likes; one that could read it could enumerate the like graph.
  await check('client CANNOT write a publicLikes record',
    assertFails(setDoc(doc(owner, `publicLikes/game_${GAME}_${OWNER}`), { kind: 'game', itemId: GAME, uid: OWNER })));
  await check('client CANNOT forge a like as another user',
    assertFails(setDoc(doc(other, `publicLikes/game_${GAME}_${OWNER}`), { kind: 'game', itemId: GAME, uid: OWNER })));
  await check('client CANNOT read its OWN publicLikes record',
    assertFails(getDoc(doc(owner, `publicLikes/game_${GAME}_${OWNER}`))));
  // [recoverable-game-deletion] Deletion state is server-only. A forged tombstone
  // would hide a game with no audit record; a cleared one would undelete past the
  // grace period or un-queue a pending purge. Ordinary game writes still work.
  await check('owner CANNOT forge a deletedAt tombstone on their own game',
    assertFails(setDoc(doc(owner, `users/${OWNER}/games/${GAME}`),
      { title: 'G', deletedAt: '2026-07-22T00:00:00.000Z' })));
  await check('owner CANNOT clear a deletedAt tombstone (undelete by client write)',
    assertFails(setDoc(doc(owner, `users/${OWNER}/games/TRASHED-GAME`), { title: 'Trashed' })));
  await check('owner CAN still write an ordinary (tombstone-free) game doc',
    assertSucceeds(setDoc(doc(owner, `users/${OWNER}/games/${GAME}`), { title: 'G' })));
  // [firestore-rules-coverage] Destroying a game is a FIVE-system act — the game
  // subtree, the publicGames/publicTasks gallery index, the accessCodes pointers,
  // Storage photos + game media, and the audit record. Only purgeGameTree does all
  // five. A raw client delete does exactly one: the gallery row keeps serving the
  // game to the world with no owner doc left to unpublish it, the codes dangle, and
  // the run subtree is left orphaned AND unpurgeable (purgeGameNow requires a
  // tombstone that no longer exists). So the delete VERB is denied outright.
  await check('owner CANNOT hard-delete their own game doc (destruction is CF-only)',
    assertFails(deleteDoc(doc(owner, `users/${OWNER}/games/${GAME}`))));
  await check('owner CANNOT hard-delete a TRASHED game (purge is CF-only)',
    assertFails(deleteDoc(doc(owner, `users/${OWNER}/games/TRASHED-GAME-2`))));
  // The tombstone is a RECORD, not a single field: `deletedBy` is as server-only as
  // `deletedAt`, so it can be neither re-attributed nor erased by a client.
  await check('owner CANNOT change deletedBy on a trashed game',
    assertFails(updateDoc(doc(owner, `users/${OWNER}/games/TRASHED-GAME`), { deletedBy: OTHER })));
  await check('owner CANNOT remove deletedBy while keeping deletedAt',
    assertFails(updateDoc(doc(owner, `users/${OWNER}/games/TRASHED-GAME`), { deletedBy: deleteField() })));
  await check('owner CANNOT clear deletedAt by deleting the field',
    assertFails(updateDoc(doc(owner, `users/${OWNER}/games/TRASHED-GAME`), { deletedAt: deleteField() })));
  await check('owner CANNOT move deletedAt forward (restart the grace period)',
    assertFails(updateDoc(doc(owner, `users/${OWNER}/games/TRASHED-GAME`), { deletedAt: '2026-07-20T00:00:00.000Z' })));
  // …and the guard must NOT become "a trashed game is read-only".
  await check('owner CAN still edit an ordinary field of a trashed game',
    assertSucceeds(updateDoc(doc(owner, `users/${OWNER}/games/TRASHED-GAME`), { title: 'Trashed (renamed)' })));
  // The delete verb under a run: `allow write: if false` covers it, asserted once
  // as a class so a future verb split there cannot silently open it.
  await check('owner CANNOT delete a team doc (server-only state, delete verb too)',
    assertFails(deleteDoc(doc(owner, `${runPath}/teams/${TEAM}`))));
  await check('client CANNOT enumerate the publicLikes collection',
    assertFails(getDocs(collection(other, 'publicLikes'))));
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
  // [firestore-rules-coverage] The trash is a per-tenant view. A tombstoned game is
  // still a game document, so it must be exactly as private as a live one — and the
  // listing surface behind listDeletedGames must not be enumerable by anyone else.
  await check('other user CANNOT read another creator\'s TRASHED game',
    assertFails(getDoc(doc(other, `users/${OWNER}/games/TRASHED-GAME`))));
  await check('other user CANNOT list another creator\'s games (their trash)',
    assertFails(getDocs(collection(other, `users/${OWNER}/games`))));
  await check('owner CAN list their own games (trash view is derived from this)',
    assertSucceeds(getDocs(collection(owner, `users/${OWNER}/games`))));

  console.log('\n── Staff scoping: a staff token is confined to its one run ──');
  await check('scoped staff CAN read a team in its run', assertSucceeds(getDoc(doc(staff, `${runPath}/teams/${TEAM}`))));
  await check('scoped staff CAN read alerts in its run', assertSucceeds(getDoc(doc(staff, `${runPath}/alerts/a1`))));
  await check('staff for a DIFFERENT run CANNOT read this run\'s team', assertFails(getDoc(doc(wrongStaff, `${runPath}/teams/${TEAM}`))));
  // [firestore-rules-coverage] …and the ownerUid claim is checked too, not only the
  // runId: a staff token minted by another creator's run must not reach this tenant.
  const foreignStaff = testEnv
    .authenticatedContext('staff3', { staff: true, ownerUid: OTHER, gameId: GAME, runId: RUN })
    .firestore();
  await check('staff of a DIFFERENT OWNER CANNOT read this run\'s team',
    assertFails(getDoc(doc(foreignStaff, `${runPath}/teams/${TEAM}`))));
  await check('staff of a DIFFERENT OWNER CANNOT read this run\'s alerts',
    assertFails(getDoc(doc(foreignStaff, `${runPath}/alerts/a1`))));

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

  console.log('\n── Staff ↔ admin channel: narrower than team chat — participants excluded entirely ──');
  const staffChannelPath = `${runPath}/staffChannel/thread`;
  await check('owner CAN read the staff channel', assertSucceeds(getDoc(doc(owner, staffChannelPath))));
  await check('scoped staff CAN read the staff channel', assertSucceeds(getDoc(doc(staff, staffChannelPath))));
  await check('staff for a DIFFERENT run CANNOT read the staff channel', assertFails(getDoc(doc(wrongStaff, staffChannelPath))));
  await check('staff of a DIFFERENT OWNER CANNOT read the staff channel', assertFails(getDoc(doc(foreignStaff, staffChannelPath))));
  // The one rule that actually differs from team chat: a participant (even the
  // team that owns the run's chat threads) must not read the marshals' channel —
  // that is exactly the operational content this thread exists to keep from teams.
  await check('a run participant CANNOT read the staff channel', assertFails(getDoc(doc(team, staffChannelPath))));
  await check('an attached device CANNOT read the staff channel', assertFails(getDoc(doc(device, staffChannelPath))));
  await check('stranger CANNOT read the staff channel', assertFails(getDoc(doc(other, staffChannelPath))));
  await check('client CANNOT write the staff channel (CF-only)', assertFails(setDoc(doc(owner, staffChannelPath), { messages: [] })));
  await check('staff CANNOT write the staff channel (CF-only)', assertFails(setDoc(doc(staff, staffChannelPath), { messages: [] })));

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

  // ── Multi-phone teams (shared-team-devices) ────────────────────────────────
  // A secondary phone attached via joinTeamAsDevice has no team doc, so the old
  // isRunParticipant() (exists() at the caller's OWN uid) rejected it and every
  // non-founder phone got permission-denied on live-ops UI that PlayScreen
  // renders unconditionally. The deviceMembers reverse index is what admits it —
  // and it must admit ONLY it: a stranger has no marker and still gets nothing.
  await check('attached device CAN read announcements', assertSucceeds(getDoc(doc(device, `${runPath}/announcements/an1`))));
  await check('attached device CAN list announcements', assertSucceeds(getDocs(collection(device, `${runPath}/announcements`))));
  await check('attached device CAN read flash missions', assertSucceeds(getDoc(doc(device, `${runPath}/flashMissions/fm1`))));
  await check('attached device CAN list flash missions', assertSucceeds(getDocs(collection(device, `${runPath}/flashMissions`))));
  await check('attached device CAN read the feed', assertSucceeds(getDoc(doc(device, feedDoc))));
  await check('attached device CAN list the feed collection', assertSucceeds(getDocs(collection(device, `${runPath}/feedItems`))));
  await check('a stranger (no deviceMembers marker) still CANNOT read announcements', assertFails(getDoc(doc(other, `${runPath}/announcements/an1`))));
  await check('a stranger (no deviceMembers marker) still CANNOT list flash missions', assertFails(getDocs(collection(other, `${runPath}/flashMissions`))));
  await check('a stranger (no deviceMembers marker) still CANNOT read the feed', assertFails(getDoc(doc(other, feedDoc))));
  // The marker is server-write-only: a stranger must not be able to mint one for
  // itself and self-admit to the whole run's live-ops.
  await check('client CANNOT read a deviceMembers marker', assertFails(getDoc(doc(device, `${runPath}/deviceMembers/${DEVICE}`))));
  await check('client CANNOT forge a deviceMembers marker', assertFails(setDoc(doc(other, `${runPath}/deviceMembers/${OTHER}`), { teamId: TEAM })));

  console.log('\n── Public/join reads behave as designed ──');
  await check('anyone (even anon) CAN read publicGames', assertSucceeds(getDoc(doc(anon, `publicGames/${GAME}`))));
  await check('anyone (even anon) CAN read publicTasks', assertSucceeds(getDoc(doc(anon, `publicTasks/${GAME}_t1`))));
  // [firestore-rules-coverage / task-library-map-view] publicTasks is world-readable
  // BY DESIGN, so its location privacy can NOT be a rules guarantee: rules gate
  // documents, not fields, and every write here is Admin SDK (rules never evaluate).
  // What rules CAN promise — and what these two assert — is that no client writes
  // the collection at all, including the published-area field.
  await check('client CANNOT write publicTasks.approxLocation (area is CF-written)',
    assertFails(setDoc(doc(owner, `publicTasks/${GAME}_t1`), { approxLocation: { lat: 31.78, lng: 35.22 } })));
  await check('a non-owner CANNOT write another creator\'s publicGames row',
    assertFails(setDoc(doc(other, `publicGames/${GAME}`), { title: 'defaced' })));
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

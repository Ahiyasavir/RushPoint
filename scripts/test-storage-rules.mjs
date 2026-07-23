// Cloud STORAGE rules verification (change: storage-rules-hardening).
//
// A companion to scripts/test-rules.mjs, kept as a SEPARATE file deliberately:
// that script is the Firestore-centric multi-tenant gate and is owned/extended
// elsewhere; this one is exclusively about object storage — participant photo
// and audio submissions (the most sensitive data this product holds: faces of
// participants, often minors, plus the place and time they were there) and
// creator-authored task media.
//
// It asserts, against the REAL storage.rules running in the emulator, that:
//   • a participant writes ONLY under their own run/team prefix
//   • a participant reads ONLY their own team's objects; run-scoped staff read
//     that run and no other
//   • size + content-type limits live in the RULES, not just the client, and
//     stored ACTIVE CONTENT (image/svg+xml) is refused on both prefixes
//   • the creator-media tree is not ENUMERABLE by strangers (list is owner-only)
//   • the removed legacy prefixes (`checkins/`, `stream/`) are dead — deny-all
//
// Emulator-bound, so NOT part of the always-green `npm test` unit gate:
//
//   npm run dev:all            # (or just the emulator) in another terminal
//   node scripts/test-storage-rules.mjs
//
// ⚠ STATUS: WRITTEN BUT NEVER EXECUTED. It was authored while a live playtest
// stack owned this machine's emulator, which must not be restarted. Treat every
// assertion below as unverified until someone runs it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, listAll } from 'firebase/storage';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'rushpoint-storage-rules-test';

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
const OTHER_OWNER = 'other-owner-uid';
const TEAM = 'team-uid';
const TEAM2 = 'team2-uid';
const GAME = 'game-1';
const RUN = 'run-1';
const RUN2 = 'run-2';

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    storage: {
      rules: readFileSync(join(root, 'storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });

  const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // tiny jpeg-ish
  const big = new Uint8Array(11 * 1024 * 1024);         // >10MB
  const jpeg = { contentType: 'image/jpeg' };
  const webm = { contentType: 'audio/webm' };
  const svg = { contentType: 'image/svg+xml' };

  const team = testEnv.authenticatedContext(TEAM).storage();
  const team2 = testEnv.authenticatedContext(TEAM2).storage();
  const owner = testEnv.authenticatedContext(OWNER).storage();
  const otherOwner = testEnv.authenticatedContext(OTHER_OWNER).storage();
  const anon = testEnv.unauthenticatedContext().storage();
  const staff = testEnv
    .authenticatedContext('staff-uid', { staff: true, ownerUid: OWNER, gameId: GAME, runId: RUN })
    .storage();
  const staffOtherRun = testEnv
    .authenticatedContext('staff2-uid', { staff: true, ownerUid: OWNER, gameId: GAME, runId: RUN2 })
    .storage();

  const mine = `runs/${RUN}/teams/${TEAM}/t1-1.jpg`;

  console.log('\n── Participant uploads: bound to the authenticated uid ──');
  await check('team CAN upload a JPEG to its OWN team folder',
    assertSucceeds(uploadBytes(ref(team, mine), img, jpeg)));
  await check('team CAN upload an audio clip to its OWN team folder',
    assertSucceeds(uploadBytes(ref(team, `runs/${RUN}/teams/${TEAM}/t2-1.webm`), img, webm)));
  await check('team CANNOT upload into ANOTHER team folder',
    assertFails(uploadBytes(ref(team2, mine), img, jpeg)));
  await check('an anonymous (signed-out) client CANNOT upload at all',
    assertFails(uploadBytes(ref(anon, `runs/${RUN}/teams/${TEAM}/anon.jpg`), img, jpeg)));

  console.log('\n── Content limits live in the RULES, not the client ──');
  await check('non-image/audio content type is rejected',
    assertFails(uploadBytes(ref(team, `runs/${RUN}/teams/${TEAM}/x.txt`), img, { contentType: 'text/plain' })));
  await check('SVG (stored ACTIVE CONTENT) is rejected on the participant prefix',
    assertFails(uploadBytes(ref(team, `runs/${RUN}/teams/${TEAM}/x.svg`), img, svg)));
  await check('an audio type outside the allowlist is rejected',
    assertFails(uploadBytes(ref(team, `runs/${RUN}/teams/${TEAM}/x.wav`), img, { contentType: 'audio/wav' })));
  await check('>10MB upload is rejected',
    assertFails(uploadBytes(ref(team, `runs/${RUN}/teams/${TEAM}/big.jpg`), big, jpeg)));

  console.log('\n── Photo READ privacy (faces of participants) ──');
  await check('a team CAN read its OWN photo',
    assertSucceeds(getBytes(ref(team, mine))));
  await check('a DIFFERENT team CANNOT read another team\'s photo',
    assertFails(getBytes(ref(team2, mine))));
  await check('a DIFFERENT team CANNOT LIST another team\'s folder',
    assertFails(listAll(ref(team2, `runs/${RUN}/teams/${TEAM}`))));
  await check('run-scoped staff CAN read a team photo in THEIR run',
    assertSucceeds(getBytes(ref(staff, mine))));
  await check('staff scoped to a DIFFERENT run CANNOT read it',
    assertFails(getBytes(ref(staffOtherRun, mine))));
  await check('anon CANNOT read a participant photo',
    assertFails(getBytes(ref(anon, mine))));

  console.log('\n── Creator-authored task media ──');
  const media = `gameMedia/${OWNER}/games/${GAME}/t1-1.jpg`;
  await check('creator CAN upload media under their OWN uid prefix',
    assertSucceeds(uploadBytes(ref(owner, media), img, jpeg)));
  await check('another creator CANNOT write into that prefix',
    assertFails(uploadBytes(ref(otherOwner, media), img, jpeg)));
  await check('a participant CANNOT overwrite creator media',
    assertFails(uploadBytes(ref(team, media), img, jpeg)));
  await check('SVG task media is rejected',
    assertFails(uploadBytes(ref(owner, `gameMedia/${OWNER}/games/${GAME}/x.svg`), img, svg)));
  // get stays public on purpose: the render path uses tokenized download URLs.
  await check('anyone CAN get a media object by its exact path (render path)',
    assertSucceeds(getBytes(ref(anon, media))));
  // …but the tree must not be ENUMERABLE: publicGames is world-readable and
  // carries ownerUid, so a listable prefix would hand strangers every object of
  // every private/unpublished game.
  await check('a stranger CANNOT LIST a creator\'s media tree',
    assertFails(listAll(ref(otherOwner, `gameMedia/${OWNER}/games/${GAME}`))));
  await check('an anonymous client CANNOT LIST a creator\'s media tree',
    assertFails(listAll(ref(anon, `gameMedia/${OWNER}`))));
  await check('the OWNER CAN list their own media tree',
    assertSucceeds(listAll(ref(owner, `gameMedia/${OWNER}`))));

  console.log('\n── Removed legacy prefixes are dead ──');
  await check('nobody can write the removed v1 `checkins/` prefix',
    assertFails(uploadBytes(ref(team, `checkins/${TEAM}/x.jpg`), img, jpeg)));
  await check('nobody can read the removed v1 `checkins/` prefix',
    assertFails(getBytes(ref(team, `checkins/${TEAM}/x.jpg`))));
  await check('nobody can write the removed `stream/` prefix',
    assertFails(uploadBytes(ref(team, 'stream/x.jpg'), img, jpeg)));
  await check('nobody can read the removed `stream/` prefix',
    assertFails(getBytes(ref(team, 'stream/x.jpg'))));
  await check('an unmatched top-level path is denied',
    assertFails(uploadBytes(ref(team, 'whatever/x.jpg'), img, jpeg)));

  await testEnv.cleanup();
  console.log(`\n${failures === 0 ? 'ALL STORAGE-RULES TESTS PASSED' : failures + ' STORAGE-RULES TEST(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

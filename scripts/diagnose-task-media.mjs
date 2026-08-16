// ─── Operator entry point: task-media diagnose & repair ──────────────────────
//
// WHAT IT FIXES. Before `task-media-durability`, `normalizeStagesMedia` DROPPED any
// media entry whose URL the saving runtime's accept-set did not recognise, then deleted
// the `media` field outright — and `updateGame` returned success. Since the Builder
// autosaves the whole `stages` array ~1.5s after any edit, one runtime disagreement
// (VPS_UPLOAD_ORIGIN unset, the API re-domained, a playtest save touching a production
// game, or the old `req.protocol` fallback minting an http:// URL) permanently erased a
// creator's mission photo from Firestore with no error anywhere.
//
// The FILE was never touched. It is still under `gameMedia/{ownerUid}/games/{gameId}/…`,
// named `{safeTaskId}-{epochMs}.{ext}` — so the picture is recoverable and the task it
// belonged to is recoverable with it. This script finds those orphans and puts them back.
//
//   npm run diagnose:task-media                       # DRY-RUN vs the local emulator
//   npm run diagnose:task-media -- --owner=<uid>      # one creator
//   npm run diagnose:task-media -- --game=<gameId>    # one game
//
// Real project:
//   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
//   npm run diagnose:task-media -- --project=rushpoint-pwa-7daaa --owner=<uid>
//   # …then, to actually write:
//   ... --execute --confirm-project=rushpoint-pwa-7daaa
//
// On the VPS the objects live on DISK, not in a bucket, so point --uploads-dir at the
// bind mount (docker-compose.api.yml maps ./uploads → /data/uploads):
//   npm run diagnose:task-media -- --project=rushpoint-pwa-7daaa --owner=<uid> \
//        --uploads-dir=/opt/rushpoint/uploads
//
// FLAGS
//   (none)                    DRY-RUN. Reads only, writes nothing. The default.
//   --execute                 The ONLY way to mutate anything.
//   --project=<id>            Target a real Firebase project instead of the emulator.
//   --confirm-project=<id>    Required to --execute against a real project; must equal
//                             --project exactly (retyping it is the guard).
//   --owner=<uid>             Only this creator's games (repeatable, comma-separated).
//   --game=<gameId>           Only this game (implies its owner).
//   --uploads-dir=<path>      Read objects from a local UPLOAD_DIR instead of a bucket.
//   --origin=<url>            Origin to mint repaired URLs on (default:
//                             https://api.rush-point.com — must match VPS_UPLOAD_ORIGIN).
//   --help
//
// IDEMPOTENT. A repaired task references the object, so it is no longer an orphan and a
// second run finds nothing. Re-running is always safe.
//
// All the decisions are pure and unit-tested in scripts/lib/taskMediaRepair.mjs
// (scripts/test-task-media-repair.ts). This file is only I/O.
import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { planMediaRepair, applyMediaRepair } from './lib/taskMediaRepair.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const list = (name) => String(flag(name) || '').split(',').map((s) => s.trim()).filter(Boolean);

if (flag('help')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n')
    .filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const EXECUTE = flag('execute') === true;
const PROJECT = flag('project') || process.env.RUSHPOINT_DIAGNOSE_PROJECT || '';
const CONFIRM = flag('confirm-project') || '';
const UPLOADS_DIR = flag('uploads-dir') || process.env.UPLOAD_DIR || '';
const ORIGIN = String(flag('origin') || process.env.VPS_UPLOAD_ORIGIN || 'https://api.rush-point.com')
  .replace(/\/+$/, '');
const OWNERS = list('owner');
const GAMES = list('game');

// A real project may only be written to when the operator retypes its id. Same guard as
// scripts/backfill-public-tasks.mjs — the emulator needs no ceremony, production does.
if (EXECUTE && PROJECT && CONFIRM !== PROJECT) {
  console.error(`✗ --execute against project "${PROJECT}" requires --confirm-project=${PROJECT}`);
  process.exit(1);
}

if (!PROJECT) {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
}
admin.initializeApp(PROJECT ? { projectId: PROJECT } : { projectId: 'rushpoint-pwa-7daaa' });
const db = admin.firestore();

const gameMediaPrefix = (ownerUid, gameId) => `gameMedia/${ownerUid}/games/${gameId}/`;

/** Object names under a game's media prefix — from the local UPLOAD_DIR or the bucket. */
async function listObjects(ownerUid, gameId) {
  const prefix = gameMediaPrefix(ownerUid, gameId);
  if (UPLOADS_DIR) {
    const dir = path.join(UPLOADS_DIR, prefix);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((n) => fs.statSync(path.join(dir, n)).isFile())
      .map((n) => prefix + n);
  }
  try {
    const [files] = await admin.storage().bucket().getFiles({ prefix });
    return files.map((f) => f.name);
  } catch (e) {
    console.warn(`  ! could not list storage for ${prefix}: ${e.message}`);
    return [];
  }
}

async function collectGames() {
  const out = [];
  if (GAMES.length > 0 && OWNERS.length === 0) {
    console.error('✗ --game needs --owner (games are stored under users/{ownerUid}/games)');
    process.exit(1);
  }
  const owners = OWNERS.length > 0
    ? OWNERS
    : (await db.collection('users').get()).docs.map((d) => d.id);
  for (const ownerUid of owners) {
    const snap = await db.collection(`users/${ownerUid}/games`).get();
    for (const doc of snap.docs) {
      if (GAMES.length > 0 && !GAMES.includes(doc.id)) continue;
      out.push({ ownerUid, gameId: doc.id, game: doc.data() });
    }
  }
  return out;
}

const main = async () => {
  console.log(`\n🔎 task-media diagnose — ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`   project: ${PROJECT || '(emulator)'}   source: ${UPLOADS_DIR || 'storage bucket'}`);
  console.log(`   repaired URLs will be minted on: ${ORIGIN}\n`);

  const games = await collectGames();
  let damaged = 0;
  let repaired = 0;

  for (const { ownerUid, gameId, game } of games) {
    const objects = await listObjects(ownerUid, gameId);
    if (objects.length === 0) continue;
    const plan = planMediaRepair(objects, game.stages);
    if (plan.orphans.length === 0) continue;
    damaged++;
    console.log(`\n📁 ${game.title || gameId}  (${ownerUid}/${gameId})`);
    console.log(`   ${objects.length} uploaded file(s), ${plan.referencedCount} still referenced`);
    for (const o of plan.orphans) {
      const who = o.taskId
        ? (game.stages ?? []).flatMap((s) => s.tasks ?? []).find((t) => t.id === o.taskId)
        : null;
      console.log(`   🖼  ORPHAN ${o.fileName}`
        + `  →  ${o.taskId ? `task "${who?.title ?? o.taskId}"` : 'NO SURVIVING TASK'}`);
    }
    if (!EXECUTE) continue;

    const { stages, reattached, skipped } = applyMediaRepair(
      game.stages, plan.orphans,
      (name) => `${ORIGIN}/uploads/${name}`,
      () => randomUUID(),
    );
    if (reattached.length === 0) {
      console.log(`   → nothing reattachable (${skipped.length} orphan(s) have no task)`);
      continue;
    }
    // Rewrite the whole stages array. NEVER a dotted update into an array element —
    // that coerces the array to a map and breaks the run flow.
    await db.doc(`users/${ownerUid}/games/${gameId}`).update({
      stages, updatedAt: new Date().toISOString(),
    });
    repaired += reattached.length;
    console.log(`   ✓ reattached ${reattached.length} file(s)`);
  }

  console.log(`\n${damaged === 0 ? '✓ no orphaned task media found' : `⚠ ${damaged} game(s) with orphaned media`}`);
  if (EXECUTE) console.log(`✓ reattached ${repaired} file(s) in total`);
  else if (damaged > 0) console.log('  (DRY-RUN — re-run with --execute to reattach)');
};

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

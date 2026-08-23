// ─── Operator entry point: seed the 11 static templates into Firestore ────────
//
// One-off migration for change: admin-manage-game-templates. Templates used to
// be a static, in-repo array (apps/creator-web/src/templates.ts). This script
// materializes each one (minus 'blank', which stays a hardcoded client-side
// special case) as a real Game document owned by the given admin uid, flagged
// isTemplate: true — exactly what the admin would get by creating it through
// /admin/templates by hand. After this has been run and verified, templates.ts
// and templateLabels.ts's per-template lookups are dead code (see cleanup step
// in openspec/changes/admin-manage-game-templates/tasks.md §10).
//
//   npm run backfill:seed-templates -- --admin-uid=<uid>                dry-run vs the local emulator
//   npm run backfill:seed-templates -- --admin-uid=<uid> --execute      really seed the emulator
//
// Real project:
//   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
//   RUSHPOINT_WEB_API_KEY=<web api key> \
//   npm run backfill:seed-templates -- --project=rushpoint-pwa-7daaa --admin-uid=<uid> \
//        --execute --confirm-project=rushpoint-pwa-7daaa
//
// FLAGS
//   --admin-uid=<uid>          REQUIRED. Real Firebase Auth uid the templates are
//                              created under (so they're editable via the normal
//                              /admin/templates + Builder UI afterwards).
//   (no --execute)             DRY-RUN. The default. Reads only, writes nothing.
//   --execute                  The ONLY way to mutate anything.
//   --project=<id>             Target a real Firebase project instead of the emulator.
//   --confirm-project=<id>     Required to --execute against a real project.
//   --help
//
// IDEMPOTENT: skips any template key that already has a matching isTemplate doc
// (by title) under --admin-uid, so re-running never creates duplicates.
//
// AUTH: same mechanism as scripts/e2e-verify.mjs and backfill-public-tasks.mjs —
// the Admin SDK mints a custom token for --admin-uid carrying { admin: true },
// and the client SDK signs in with it. The created games are OWNED by that uid
// (not a synthetic operator identity), because the whole point is that the real
// admin can then edit them normally.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import adminSdk from 'firebase-admin';
import { TEMPLATES } from '../apps/creator-web/src/templates.ts';

const HELP = `
backfill-seed-templates — migrate the static template array into Firestore

  npm run backfill:seed-templates -- --admin-uid=<uid>                     dry-run vs the local emulator
  npm run backfill:seed-templates -- --admin-uid=<uid> --execute           seed the local emulator
  npm run backfill:seed-templates -- --project=<id> --admin-uid=<uid> --execute --confirm-project=<id>

Flags: --admin-uid=<uid> (required) --execute --project=<id> --confirm-project=<id> --help
`;

function parseArgs(argv) {
  const out = { execute: false, project: undefined, confirmProject: undefined, adminUid: undefined, help: false };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') out.help = true;
    else if (raw === '--execute') out.execute = true;
    else if (raw.startsWith('--project=')) out.project = raw.slice('--project='.length);
    else if (raw.startsWith('--confirm-project=')) out.confirmProject = raw.slice('--confirm-project='.length);
    else if (raw.startsWith('--admin-uid=')) out.adminUid = raw.slice('--admin-uid='.length);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(HELP); process.exit(0); }
if (!args.adminUid) {
  console.error('[backfill] ✗ --admin-uid=<uid> is required.');
  console.error(HELP);
  process.exit(1);
}
const isEmulator = !args.project;
const projectId = args.project || 'rushpoint-pwa-7daaa';
if (!isEmulator && args.execute && args.confirmProject !== args.project) {
  console.error('[backfill] ✗ --execute against a real project requires --confirm-project=<id> matching --project exactly.');
  process.exit(1);
}
const REGION = process.env.RUSHPOINT_FUNCTIONS_REGION || 'us-central1';

console.log('');
console.log(`[backfill] target: ${isEmulator ? 'LOCAL EMULATOR' : `REAL PROJECT ${projectId}`}`);
console.log(`[backfill] admin uid: ${args.adminUid}`);
console.log(`[backfill] mode: ${args.execute ? 'EXECUTE (will write)' : 'DRY-RUN (reads only)'}`);
console.log('');

if (isEmulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
} else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('[backfill] ✗ GOOGLE_APPLICATION_CREDENTIALS is required for a real project.');
  process.exit(1);
}
const apiKey = isEmulator ? 'emulator-key' : (process.env.RUSHPOINT_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '');
if (!apiKey) {
  console.error('[backfill] ✗ RUSHPOINT_WEB_API_KEY is required for a real project.');
  process.exit(1);
}

async function main() {
  adminSdk.initializeApp(
    isEmulator
      ? { projectId }
      : { credential: adminSdk.credential.applicationDefault(), projectId },
  );

  const app = initializeApp({ apiKey, projectId, appId: 'rushpoint-backfill-templates' }, 'backfill-templates');
  const auth = getAuth(app);
  const functions = getFunctions(app, REGION);
  if (isEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }

  const customToken = await adminSdk.auth().createCustomToken(args.adminUid, { admin: true });
  await signInWithCustomToken(auth, customToken);
  console.log(`[backfill] signed in as ${args.adminUid} (admin claim, token-only)`);

  if (args.execute && !isEmulator) {
    console.log('[backfill] executing against a REAL project in 5 s — Ctrl+C to abort…');
    await new Promise((r) => setTimeout(r, 5000));
  }

  const createGame = httpsCallable(functions, 'createGame');
  const updateGame = httpsCallable(functions, 'updateGame');
  const setGameTemplateFlag = httpsCallable(functions, 'setGameTemplateFlag');
  const listGames = httpsCallable(functions, 'listGames');

  const { data: existing } = await listGames();
  const existingTemplateTitles = new Set(
    (existing?.games ?? []).filter((g) => g.isTemplate).map((g) => g.title),
  );

  const toSeed = TEMPLATES.filter((tpl) => tpl.key !== 'blank');
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < toSeed.length; i++) {
    const tpl = toSeed[i];
    const title = tpl.key; // English fallback title — admin retitles via the Builder as desired.
    if (existingTemplateTitles.has(title)) {
      console.log(`[backfill]   skip  ${tpl.key} — a template with this title already exists`);
      skipped++;
      continue;
    }
    const stages = tpl.build().map((s, idx) => ({ ...s, order: idx }));
    const stageCount = stages.length;
    const taskCount = stages.reduce((sum, s) => sum + s.tasks.length, 0);
    console.log(`[backfill]   ${args.execute ? 'CREATE' : 'would create'}  ${tpl.key}  (${stageCount} stages, ${taskCount} tasks, order=${i + 1})`);
    if (!args.execute) continue;

    const { data: g } = await createGame({ title, mode: tpl.mode, tags: [] });
    await updateGame({ gameId: g.gameId, stages, scoringPreset: tpl.scoringPreset });
    await setGameTemplateFlag({
      gameId: g.gameId, isTemplate: true, templateEmoji: tpl.emoji, templateOrder: i + 1,
    });
    created++;
  }

  console.log('');
  console.log(`[backfill] ── ${args.execute ? 'SEED' : 'DRY-RUN'} COMPLETE ──`);
  console.log(`[backfill]   candidates : ${toSeed.length}`);
  console.log(`[backfill]   created    : ${created}${args.execute ? '' : ' (would be — nothing was written)'}`);
  console.log(`[backfill]   skipped    : ${skipped} (already present)`);
  if (!args.execute) console.log('[backfill]   → re-run with --execute to actually create them.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[backfill] ✗ ${err?.stack ?? err}`);
    process.exit(1);
  });

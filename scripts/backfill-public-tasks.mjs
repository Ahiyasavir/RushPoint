// ─── Operator entry point: publicTasks legacy-coordinate backfill ─────────────
//
// Drives the admin-only callable `backfillPublicTaskCoordinatesNow` to completion.
//
// WHAT IT FIXES. Before `task-library-map-view`, `publishGame` copied a task's
// EXACT authored `coordinates` into `publicTasks/{id}` — a collection whose rule is
// `allow read: if true` — hideLocation tasks included. The fix only changed what is
// written from then on; documents already in Firestore still carry the exact point
// and carry NO coarse `approxLocation`, which is why they also do not appear on the
// creator's task-library map ("no task has a published area"). This sweep repairs
// them: it deletes `coordinates` and writes the coarse `approxLocation` the current
// code would have written (or nothing at all, for a hidden-location task).
//
// Until this script existed the callable had exactly one caller in the repo —
// `scripts/e2e-verify.mjs`. A remediation nobody can invoke closes nothing.
//
//   npm run backfill:public-tasks                 # DRY-RUN vs the local emulator
//   npm run backfill:public-tasks -- --execute    # really sweep the emulator
//
// Real project (see DEPLOY.md §11 for the full runbook):
//   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
//   RUSHPOINT_WEB_API_KEY=<web api key> \
//   npm run backfill:public-tasks -- --project=rushpoint-pwa-7daaa \
//        --execute --confirm-project=rushpoint-pwa-7daaa
//
// FLAGS
//   (none)                    DRY-RUN. The default. Reads only, writes nothing.
//   --execute                 The ONLY way to mutate anything.
//   --project=<id>            Target a real Firebase project instead of the emulator.
//   --confirm-project=<id>    Required to --execute against a real project; must
//                             exactly equal --project (retyping it is the guard).
//   --limit=N                 Documents per page (1…1000, default 500).
//   --max-pages=N             Bound on pages per invocation (default 200).
//   --start-after=<docId>     Resume from a previous run's last cursor.
//   --help
//
// ENV
//   RUSHPOINT_BACKFILL_PROJECT   same as --project (still needs --confirm-project)
//   GOOGLE_APPLICATION_CREDENTIALS  service-account JSON — REQUIRED for a real project
//   RUSHPOINT_WEB_API_KEY / VITE_FIREBASE_API_KEY  web API key — REQUIRED for a real
//                             project (used to exchange the admin custom token for an
//                             ID token; the emulator accepts any key)
//   RUSHPOINT_FUNCTIONS_REGION   default us-central1
//
// AUTH. The callable is `assertAdmin`-gated with no emulator bypass, so this script
// authenticates exactly the way `scripts/e2e-verify.mjs` does: the Admin SDK mints a
// custom token carrying `{ admin: true }` and the client SDK signs in with it. Against
// the emulator that needs no credentials at all; against a real project it needs a
// service account (the identity that signs the token) plus the project's web API key
// (the client exchanges the custom token for an ID token). Nothing persistent is
// granted — the admin claim lives only inside that one short-lived token.
//
// IDEMPOTENT + RESUMABLE. The callable skips any document that already conforms
// (`hasLegacyCoordinates` pre-check) and a repaired document conforms, so re-running
// repairs nothing. An interrupted sweep is resumed with `--start-after=<last cursor>`
// (printed on every page), and re-running from the beginning is equally safe — only
// slower.
//
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import adminSdk from 'firebase-admin';
import {
  parseBackfillArgs,
  decidePage,
  accumulateTotals,
  describeTarget,
} from './lib/publicTaskBackfill.mjs';

const HELP = `
backfill-public-tasks — repair legacy publicTasks documents (privacy sweep)

  npm run backfill:public-tasks                          dry-run vs the local emulator
  npm run backfill:public-tasks -- --execute             sweep the local emulator
  npm run backfill:public-tasks -- --project=<id> --execute --confirm-project=<id>

Flags: --execute --dry-run --project=<id> --confirm-project=<id>
       --limit=N --max-pages=N --start-after=<docId> --help

Full runbook: DEPLOY.md §11.
`;

const args = parseBackfillArgs(process.argv.slice(2), process.env);

if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (!args.ok) {
  for (const e of args.errors) console.error(`[backfill] ✗ ${e}`);
  console.error(HELP);
  process.exit(1);
}

const isEmulator = args.target === 'emulator';
const REGION = process.env.RUSHPOINT_FUNCTIONS_REGION || 'us-central1';

// ── Loud pre-flight: nobody sweeps production by accident ────────────────────
console.log('');
console.log(describeTarget(args));
console.log('');

if (isEmulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
} else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('[backfill] ✗ GOOGLE_APPLICATION_CREDENTIALS is required for a real project.');
  console.error('[backfill]   Point it at a service-account JSON for this project (DEPLOY.md §11).');
  process.exit(1);
}

const apiKey = isEmulator
  ? 'emulator-key'
  : (process.env.RUSHPOINT_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || '');
if (!apiKey) {
  console.error('[backfill] ✗ RUSHPOINT_WEB_API_KEY (the project\'s web API key) is required for a real project.');
  process.exit(1);
}

async function main() {
  adminSdk.initializeApp(
    isEmulator
      ? { projectId: args.projectId }
      : { credential: adminSdk.credential.applicationDefault(), projectId: args.projectId },
  );

  const app = initializeApp({ apiKey, projectId: args.projectId, appId: 'rushpoint-backfill' }, 'backfill');
  const auth = getAuth(app);
  const functions = getFunctions(app, REGION);
  if (isEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }

  // Same mechanism as scripts/e2e-verify.mjs: a real custom token with the admin
  // claim, so the REAL gate is exercised (there is no emulator bypass to lean on).
  const customToken = await adminSdk.auth()
    .createCustomToken('rushpoint-backfill-operator', { admin: true });
  await signInWithCustomToken(auth, customToken);
  console.log('[backfill] signed in as rushpoint-backfill-operator (admin claim, token-only)');

  if (!args.dryRun && !isEmulator) {
    console.log('[backfill] executing against a REAL project in 5 s — Ctrl+C to abort…');
    await new Promise((r) => setTimeout(r, 5000));
  }

  const call = httpsCallable(functions, 'backfillPublicTaskCoordinatesNow');

  let cursor = args.startAfter;
  let totals = null;
  let pageIndex = 0;
  const startedAt = Date.now();

  for (;;) {
    let page;
    try {
      page = (await call({
        limit: args.limit,
        startAfter: cursor,
        dryRun: args.dryRun,
      })).data;
    } catch (err) {
      console.error(`[backfill] ✗ page ${pageIndex + 1} failed :: ${err?.code ?? ''} ${err?.message ?? err}`);
      if (cursor) console.error(`[backfill]   resume with --start-after=${cursor}`);
      return 1;
    }

    const decision = decidePage({ page, previousCursor: cursor, pageIndex, maxPages: args.maxPages });
    totals = accumulateTotals(totals, page);

    const n = (v) => String(v ?? 0).padStart(5);
    console.log(
      `[backfill] page ${String(pageIndex + 1).padStart(3)}`
      + `  scanned ${n(page?.scanned)}`
      + `  repaired ${n(page?.repaired)}`
      + `  skipped ${n((page?.scanned ?? 0) - (page?.repaired ?? 0))}`
      + `  cleared ${n(page?.cleared)}`
      + `  orphaned ${n(page?.orphaned)}`
      + `  cursor ${page?.cursor ?? '—'}`,
    );

    if (decision.action === 'fail') {
      console.error(`[backfill] ✗ aborting: ${decision.reason}`);
      return 1;
    }
    if (decision.action === 'stop') break;

    cursor = decision.cursor;
    pageIndex++;
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log(`[backfill] ── ${args.dryRun ? 'DRY-RUN' : 'SWEEP'} COMPLETE in ${secs}s ──`);
  console.log(`[backfill]   pages    : ${totals.pages}`);
  console.log(`[backfill]   scanned  : ${totals.scanned}`);
  console.log(`[backfill]   repaired : ${totals.repaired}${args.dryRun ? ' (would be — nothing was written)' : ''}`);
  console.log(`[backfill]   skipped  : ${totals.skipped} (already conformant)`);
  console.log(`[backfill]   cleared  : ${totals.cleared} (hidden-location tasks left with NO published area)`);
  console.log(`[backfill]   orphaned : ${totals.orphaned} (source task unresolvable — failed closed)`);
  if (args.dryRun && totals.repaired > 0) {
    console.log('[backfill]   → re-run with --execute to actually repair them.');
  }
  if (!args.dryRun && totals.repaired === 0) {
    console.log('[backfill]   → nothing to repair. The sweep is already complete (it is idempotent).');
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[backfill] ✗ ${err?.stack ?? err}`);
    process.exit(1);
  });

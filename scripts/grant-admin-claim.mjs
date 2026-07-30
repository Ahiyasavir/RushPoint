// ─── Operator entry point: grant the `admin` custom claim ─────────────────────
//
// Every existing `admin`-gated callable (listAuditLogs, pruneRunNow,
// backfillPublicTaskCoordinatesNow, and now listPlatformUsers — change:
// admin-user-activity-dashboard) assumes the claim already exists on the caller's
// Auth token. Nothing in the repo grants it on a REAL account: the e2e suite mints
// it directly against the Auth emulator (`adminSdk.auth().createCustomToken(...,
// { admin: true })`), which proves the gate works but sets nothing persistent.
// This script is the missing first-party path — a real person becomes an admin by
// signing in normally (their own email/password or Google, the same AuthGate every
// creator uses) and an operator running this once against their uid/email.
//
// Nobody's password is ever seen, entered, or handled by this script — it only
// flips a server-side custom claim on an account the person already controls.
//
//   node scripts/grant-admin-claim.mjs --email=you@example.com
//                                                    # DRY-RUN vs the local emulator
//   node scripts/grant-admin-claim.mjs --email=you@example.com --execute
//                                                    # really grant it (emulator)
//
// Real project:
//   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
//   node scripts/grant-admin-claim.mjs --project=rushpoint-pwa-7daaa \
//        --email=you@example.com --execute --confirm-project=rushpoint-pwa-7daaa
//
// FLAGS
//   --email=<addr>             Target account by email (mutually exclusive with --uid).
//   --uid=<id>                 Target account by uid.
//   --execute                  The ONLY way to mutate anything. Default is dry-run.
//   --project=<id>             Target a real Firebase project instead of the emulator.
//   --confirm-project=<id>     Required to --execute against a real project; must
//                              exactly equal --project (retyping it is the guard).
//   --revoke                   Remove the admin claim instead of granting it.
//   --help
//
// Existing custom claims (e.g. a `staff` token — though in practice no account
// should carry both) are preserved: this MERGES { admin: true } into whatever
// claims the account already has, it never clobbers them.
import adminSdk from 'firebase-admin';

const HELP = `
grant-admin-claim — grant (or revoke) the platform-admin custom claim on one account

  node scripts/grant-admin-claim.mjs --email=<addr>                     dry-run vs the local emulator
  node scripts/grant-admin-claim.mjs --email=<addr> --execute           grant it (emulator)
  node scripts/grant-admin-claim.mjs --project=<id> --email=<addr> \\
       --execute --confirm-project=<id>                                 grant it on a real project

Flags: --email=<addr> --uid=<id> --execute --revoke
       --project=<id> --confirm-project=<id> --help
`;

function parseArgs(argv) {
  const out = { execute: false, revoke: false, projectId: null, confirmProject: null, email: null, uid: null, help: false };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') out.help = true;
    else if (raw === '--execute') out.execute = true;
    else if (raw === '--revoke') out.revoke = true;
    else if (raw.startsWith('--project=')) out.projectId = raw.slice('--project='.length);
    else if (raw.startsWith('--confirm-project=')) out.confirmProject = raw.slice('--confirm-project='.length);
    else if (raw.startsWith('--email=')) out.email = raw.slice('--email='.length);
    else if (raw.startsWith('--uid=')) out.uid = raw.slice('--uid='.length);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(HELP); process.exit(0); }

if (!args.email && !args.uid) {
  console.error('[grant-admin] ✗ --email=<addr> or --uid=<id> is required.');
  console.log(HELP);
  process.exit(1);
}
if (args.email && args.uid) {
  console.error('[grant-admin] ✗ pass --email OR --uid, not both.');
  process.exit(1);
}

const isEmulator = !args.projectId;
const projectId = args.projectId ?? (process.env.GCLOUD_PROJECT || 'rushpoint-pwa-7daaa');

if (isEmulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
} else if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('[grant-admin] ✗ GOOGLE_APPLICATION_CREDENTIALS is required for a real project.');
  console.error('[grant-admin]   Point it at a service-account JSON for this project.');
  process.exit(1);
}

// Same footgun guard as backfill-public-tasks.mjs: --execute against a real
// project requires RETYPING the project id, not just passing --execute.
if (args.execute && !isEmulator && args.confirmProject !== projectId) {
  console.error(`[grant-admin] ✗ --execute against a real project requires --confirm-project=${projectId} (got: ${args.confirmProject ?? '(none)'}).`);
  process.exit(1);
}

async function main() {
  adminSdk.initializeApp(
    isEmulator
      ? { projectId }
      : { credential: adminSdk.credential.applicationDefault(), projectId },
  );
  const auth = adminSdk.auth();

  const target = args.email
    ? await auth.getUserByEmail(args.email).catch(() => null)
    : await auth.getUser(args.uid).catch(() => null);

  if (!target) {
    console.error(`[grant-admin] ✗ no account found for ${args.email ? `email ${args.email}` : `uid ${args.uid}`}.`);
    console.error('[grant-admin]   The account must already exist — sign in once via the normal creator-web login first.');
    process.exit(1);
  }

  const existingClaims = target.customClaims ?? {};
  const nextClaims = args.revoke
    ? { ...existingClaims, admin: false }
    : { ...existingClaims, admin: true };

  console.log(`[grant-admin] target: ${target.email ?? target.uid} (uid: ${target.uid})`);
  console.log(`[grant-admin] project: ${projectId}${isEmulator ? ' (emulator)' : ''}`);
  console.log(`[grant-admin] current claims: ${JSON.stringify(existingClaims)}`);
  console.log(`[grant-admin] would set:      ${JSON.stringify(nextClaims)}`);

  if (!args.execute) {
    console.log('\n[grant-admin] DRY-RUN — nothing changed. Re-run with --execute to apply.');
    return;
  }

  if (!isEmulator) {
    console.log('\n[grant-admin] executing against a REAL project in 5 s — Ctrl+C to abort…');
    await new Promise((r) => setTimeout(r, 5000));
  }

  await auth.setCustomUserClaims(target.uid, nextClaims);
  console.log(`\n[grant-admin] ✓ ${args.revoke ? 'revoked' : 'granted'} admin claim for ${target.email ?? target.uid}.`);
  console.log('[grant-admin]   The account must sign OUT and back IN (or wait for its next token');
  console.log('[grant-admin]   refresh, ~1h) before the new claim appears in its ID token.');
}

main().catch((e) => {
  console.error('[grant-admin] ✗ failed:', e?.message || e);
  process.exit(1);
});

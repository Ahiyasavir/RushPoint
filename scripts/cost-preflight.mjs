#!/usr/bin/env node
/**
 * scripts/cost-preflight.mjs — pre-deploy cost-safety checker.
 *   npm run cost:preflight
 *
 * READ-ONLY BY CONSTRUCTION: it reads repository files and prints a verdict.
 * It never writes a file, never deploys, never calls a network or cloud API,
 * and never mutates project state. Running it is always safe.
 *
 * It checks the cost controls that live IN THE REPO, and then prints — loudly —
 * the console-only controls it CANNOT see, so nobody mistakes a green run for
 * "I am protected". The console steps are the ones that actually cap money;
 * see docs/BUDGET_10_SETUP.md.
 *
 * Exits non-zero if any automated check fails.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..');

/** Highest DEFAULT_MAX_INSTANCES we consider cost-safe for a ~96-function project. */
const MAX_ALLOWED_DEFAULT_INSTANCES = 50;

const LOG_TS = join(REPO, 'functions', 'src', 'obs', 'log.ts');
const INDEXES = join(REPO, 'firestore.indexes.json');
const ENV_EXAMPLES = [
  join(REPO, 'apps', 'creator-web', '.env.example'),
  join(REPO, 'apps', 'play-web', '.env.example'),
];

/** Composite indexes that keep the live-ops listeners bounded (unindexed = full scans = reads = $). */
const REQUIRED_INDEXES = [
  { collectionGroup: 'feedItems', fields: ['active', 'createdAt'] },
  { collectionGroup: 'announcements', fields: ['active', 'createdAt'] },
  { collectionGroup: 'flashMissions', fields: ['isActive', 'createdAt'] },
];

/** App Check knobs both client apps must expose (App Check blocks unattested abuse). */
const REQUIRED_ENV_KEYS = ['VITE_APP_CHECK_SITE_KEY', 'VITE_APP_CHECK_ENFORCE'];

/** Read a file, or null when it does not exist (never throws for a missing path). */
function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

console.log('💸 RushPoint cost preflight — repo-side controls only\n');

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`✗ ${msg}`);
};
const pass = (msg) => console.log(`✓ ${msg}`);

// 1) Per-callable maxInstances cap — the single biggest in-code cost lever.
{
  const src = readOrNull(LOG_TS);
  if (src == null) {
    fail(`Could not read functions/src/obs/log.ts — cannot confirm any maxInstances cap exists.`);
  } else {
    const m = src.match(/^export\s+const\s+DEFAULT_MAX_INSTANCES\s*=\s*(\d+)\s*;/m);
    if (!m) {
      fail(
        'DEFAULT_MAX_INSTANCES is NOT declared in functions/src/obs/log.ts. ' +
          'Without it every callable can scale unbounded — worst case is thousands of $/day.',
      );
    } else {
      const value = Number(m[1]);
      if (value > MAX_ALLOWED_DEFAULT_INSTANCES) {
        fail(
          `DEFAULT_MAX_INSTANCES = ${value} — too high for a $10/month budget ` +
            `(max ${MAX_ALLOWED_DEFAULT_INSTANCES}). gen-1 runs 1 request per instance, so this ` +
            `multiplies across ~96 callables.`,
        );
      } else {
        pass(`DEFAULT_MAX_INSTANCES = ${value} (per-callable instance cap is in force).`);
      }
    }
  }
}

// 2) Composite indexes — an unindexed live-ops listener reads far more than it needs.
{
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(INDEXES, 'utf8'));
  } catch (e) {
    fail(`Could not read/parse firestore.indexes.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (parsed) {
    const have = (parsed.indexes ?? []).map((i) => ({
      collectionGroup: i.collectionGroup,
      fields: (i.fields ?? []).map((f) => f.fieldPath),
    }));
    const missing = REQUIRED_INDEXES.filter(
      (want) =>
        !have.some(
          (got) =>
            got.collectionGroup === want.collectionGroup &&
            want.fields.every((f) => got.fields.includes(f)),
        ),
    );
    if (missing.length) {
      fail('firestore.indexes.json is missing bounded-listener composite index(es):');
      for (const m of missing) console.log(`    - ${m.collectionGroup}: ${m.fields.join(' + ')}`);
    } else {
      pass(`All ${REQUIRED_INDEXES.length} live-ops composite indexes are declared.`);
    }
  }
}

// 3) App Check env knobs present in BOTH apps (so enforcement can be turned on later).
for (const path of ENV_EXAMPLES) {
  const rel = path.slice(REPO.length + 1).replace(/\\/g, '/');
  const src = readOrNull(path);
  if (src == null) {
    fail(`Missing ${rel} — App Check configuration is undiscoverable.`);
    continue;
  }
  const absent = REQUIRED_ENV_KEYS.filter((k) => !new RegExp(`^${k}=`, 'm').test(src));
  if (absent.length) fail(`${rel} is missing App Check key(s): ${absent.join(', ')}`);
  else pass(`${rel} declares ${REQUIRED_ENV_KEYS.join(' + ')}.`);
}

// ─── The part this script CANNOT check ────────────────────────────────────────
console.log(`
${'─'.repeat(72)}
⚠  YOU MUST DO THESE MANUALLY — this script CANNOT verify any of them.
   They live in the Google Cloud / Firebase console. Nothing above tells you
   whether they are done. UNVERIFIED, every one of them:

   [ ] 1. Cloud Functions QUOTA lowered (IAM & Admin → Quotas & System Limits →
          filter "Cloud Functions" → Max project CPU / Max project memory /
          Max concurrent invocations for background functions → Edit).
          This is the ONLY enforced hard wall. Decreases need Google review —
          request them BEFORE you need them.
   [ ] 2. Budget "Awareness" at $5, alerts at 20 / 50 / 80 / 100%.
   [ ] 3. Kill-switch budget (separate, higher) wired to Pub/Sub. Tripwire with
          HOURS of lag — not a wall. Runbook: docs/COST_CONTROLS.md.
   [ ] 4. App Check ENFORCEMENT turned on (after a soak with it dark).
   [ ] 5. Cloud Storage bucket REGION is us-central1 / us-west1 / us-east1 —
          the Storage free tier exists ONLY there. Cannot be read from the repo.

   Full ordered checklist: docs/BUDGET_10_SETUP.md
${'─'.repeat(72)}`);

console.log(
  failed
    ? '\n✗ Repo-side cost controls are NOT all in place (see above). Fix before deploying.'
    : '\n✓ Repo-side cost controls look correct. The 5 manual console steps are still on you.',
);
process.exit(failed ? 1 : 0);

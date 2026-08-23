// Pure tests for the production backend-origin guard
// (change: deploy-backend-origin-guard).
//
// THE INCIDENT (2026-08-14). `apps/creator-web/.env` sets
// VITE_API_ORIGIN=https://api.rush-point.com; a gitignored `.env.local` overrode it
// with an EMPTY value so local dev could not autosave into real creator data. That
// part was correct. What nobody accounted for is that **Vite loads `.env.local` in
// EVERY mode, including a production build** — so `npm run deploy:hosting` baked the
// empty value into the real bundle and every callable on creator.rush-point.com
// pointed nowhere. The live console showed "טעינת המשחקים נכשלה".
//
// WHY NO EXISTING GATE CAUGHT IT: the build succeeded, `base:check` passed (the asset
// base was right), `bundle:budget` passed, the deploy reported success, the served
// asset hash matched the local build exactly, and the site returned 200. Every signal
// was green because every signal was measuring something else. The bundle was shipped
// faithfully — it was simply built against the wrong backend.
//
// TWO INDEPENDENT TRIPWIRES, because either alone leaves a hole:
//   1. envOverrideHazards — a `.env.local` in an app dir is refused OUTRIGHT. This
//      fires before any build and names the fix (`.env.development.local`, which
//      Vite loads in dev mode ONLY). Catches the cause.
//   2. checkBundleOrigin — a BUILT production bundle must actually contain the origin
//      its `.env` declares. Catches the effect, however it was caused (a stale
//      `dist`, a bad CI env, a future override file nobody thought of).
//
// No emulator, no build needed — synthetic fixtures.
//   npx tsx scripts/test-backend-origin-guard.ts
import {
  ORIGIN_ENV_VAR, SAFE_DEV_OVERRIDE, PRODUCTION_BUNDLE_CONTRACT,
  parseEnvValue, envOverrideHazards, checkBundleOrigin,
} from './lib/backendOriginGuard.mjs';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── parseEnvValue ────────────────────────────────────────────────────────────
check('reads a plain assignment',
  parseEnvValue('VITE_API_ORIGIN=https://api.rush-point.com\n', ORIGIN_ENV_VAR) === 'https://api.rush-point.com');
check('an EMPTY assignment reads as empty string, NOT as absent',
  parseEnvValue('VITE_API_ORIGIN=\n', ORIGIN_ENV_VAR) === '');
check('an absent key reads as null', parseEnvValue('OTHER=1\n', ORIGIN_ENV_VAR) === null);
check('a commented-out assignment is not a value',
  parseEnvValue('# VITE_API_ORIGIN=https://x\n', ORIGIN_ENV_VAR) === null);
check('surrounding whitespace and quotes are stripped',
  parseEnvValue('  VITE_API_ORIGIN = "https://api.rush-point.com"  \n', ORIGIN_ENV_VAR) === 'https://api.rush-point.com');
check('the LAST assignment wins, as dotenv does',
  parseEnvValue('VITE_API_ORIGIN=https://a\nVITE_API_ORIGIN=https://b\n', ORIGIN_ENV_VAR) === 'https://b');
// Totality: this reads files that humans hand-edit.
check('garbage input does not throw', parseEnvValue(undefined as never, ORIGIN_ENV_VAR) === null);
check('an empty file does not throw', parseEnvValue('', ORIGIN_ENV_VAR) === null);

// ── envOverrideHazards: the CAUSE ────────────────────────────────────────────
{
  const hazards = envOverrideHazards({ app: 'creator-web', filenames: ['.env', '.env.local'] });
  check('a .env.local is reported as a hazard', hazards.length === 1, JSON.stringify(hazards));
  check('the hazard names the file', (hazards[0] ?? '').includes('.env.local'));
  check('the hazard names the SAFE replacement', (hazards[0] ?? '').includes(SAFE_DEV_OVERRIDE));
  check('the hazard says why (it applies to production builds)',
    /production/i.test(hazards[0] ?? ''), hazards[0]);
}
check('the safe dev override is NOT a hazard',
  envOverrideHazards({ app: 'creator-web', filenames: ['.env', SAFE_DEV_OVERRIDE] }).length === 0);
check('an ordinary .env alone is not a hazard',
  envOverrideHazards({ app: 'creator-web', filenames: ['.env', '.env.example'] }).length === 0);
check('no env files at all is not a hazard',
  envOverrideHazards({ app: 'play-web', filenames: [] }).length === 0);
check('a malformed argument does not throw',
  envOverrideHazards(undefined as never).length === 0);

// ── checkBundleOrigin: the EFFECT ────────────────────────────────────────────
{
  const ok = checkBundleOrigin({
    label: 'creator-web/dist',
    bundleText: 'const x="https://api.rush-point.com";',
    expectedOrigin: 'https://api.rush-point.com',
  });
  check('a bundle carrying its declared origin passes', ok.ok === true, ok.problem ?? '');
}
{
  // The exact shape of the incident: built with the origin stripped out.
  const bad = checkBundleOrigin({
    label: 'creator-web/dist',
    bundleText: 'const x="";const y=getFunctions(app);',
    expectedOrigin: 'https://api.rush-point.com',
  });
  check('a bundle MISSING its declared origin fails', bad.ok === false);
  check('the failure names the artifact', (bad.problem ?? '').includes('creator-web/dist'));
  check('the failure names the origin that should be there',
    (bad.problem ?? '').includes('api.rush-point.com'));
  check('the failure explains the consequence, not just the mismatch',
    /callable|backend|nowhere/i.test(bad.problem ?? ''), bad.problem ?? '');
}
// Nothing declared ⇒ nothing to enforce. An app that legitimately uses the default
// Firebase Functions endpoint must not be failed by a guard about a var it never set.
check('an app that declares no origin is not failed',
  checkBundleOrigin({ label: 'x', bundleText: 'anything', expectedOrigin: null }).ok === true);
check('an app whose .env declares an EMPTY origin is not failed either',
  checkBundleOrigin({ label: 'x', bundleText: 'anything', expectedOrigin: '' }).ok === true);
// Totality — it runs in a gate; a throw here reads as a broken build.
check('a missing bundle body fails cleanly rather than throwing',
  checkBundleOrigin({ label: 'x', bundleText: undefined as never, expectedOrigin: 'https://a' }).ok === false);

// ── The contract itself ──────────────────────────────────────────────────────
check('the production contract covers BOTH shipped apps',
  PRODUCTION_BUNDLE_CONTRACT.length === 2
  && PRODUCTION_BUNDLE_CONTRACT.some((c) => c.app === 'creator-web')
  && PRODUCTION_BUNDLE_CONTRACT.some((c) => c.app === 'play-web'),
  JSON.stringify(PRODUCTION_BUNDLE_CONTRACT));
// dist-playtest is emulator-bound by design (isEmulatorBuild covers MODE==='playtest'),
// so requiring the production origin there would fail a correct build.
check('the contract covers only the GATE/deploy output, never dist-playtest',
  PRODUCTION_BUNDLE_CONTRACT.every((c) => c.outDir === 'dist'),
  JSON.stringify(PRODUCTION_BUNDLE_CONTRACT.map((c) => c.outDir)));

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

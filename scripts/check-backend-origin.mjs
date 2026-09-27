// Production backend-origin check (change: deploy-backend-origin-guard).
//
//   npm run origin:check        (runs inside `npm run verify`, after both builds)
//   node scripts/check-backend-origin.mjs
//
// Asserts two things the 2026-08-14 outage proved nothing else asserts:
//   1. No app carries a `.env.local` — Vite applies it to production builds too, so
//      a local-only override ships to real users.
//   2. Every DEPLOYED bundle actually contains the VITE_API_ORIGIN its own `.env`
//      declares, so it talks to the real backend rather than nowhere.
//
// That outage passed every existing gate: the build succeeded, base:check passed,
// bundle:budget passed, the deploy reported success, the served asset hash matched
// the local build exactly, and the site returned 200 — while creator.rush-point.com
// could not load a single game. Those gates verify the bundle was built and shipped
// FAITHFULLY; none of them verify it was built against the right backend.
//
// An unbuilt directory is SKIPPED, never failed — a fresh checkout has no dist.
// All decision logic is pure and unit-tested in scripts/test-backend-origin-guard.ts;
// this file only reads files and prints.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORIGIN_ENV_VAR, API_KEY_ENV_VAR, PRODUCTION_BUNDLE_CONTRACT,
  parseEnvValue, envOverrideHazards, checkBundleOrigin, checkBundleApiKey, formatProblems,
} from './lib/backendOriginGuard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('\n🔌 Backend-origin check (production bundles talk to the real backend)\n');

let failures = 0;
let checked = 0;
let skipped = 0;

// Every app named by the contract, deduped — the env-file check is per app, not
// per artifact.
const apps = [...new Set(PRODUCTION_BUNDLE_CONTRACT.map((c) => c.app))];

// ── 1. Env-file hazards (the CAUSE) ─────────────────────────────────────────
for (const app of apps) {
  const appDir = path.join(root, 'apps', app);
  let filenames = [];
  try {
    filenames = fs.readdirSync(appDir).filter((f) => f.startsWith('.env'));
  } catch {
    continue; // no such app dir — nothing to police
  }
  const problems = envOverrideHazards({ app, filenames });
  if (problems.length > 0) {
    failures += problems.length;
    console.error(formatProblems(problems));
  } else {
    console.log(`  ✓  apps/${app.padEnd(24)} env files safe (${filenames.join(', ') || 'none'})`);
  }
}

// ── 2. Built bundles carry their declared origin (the EFFECT) ───────────────
for (const artifact of PRODUCTION_BUNDLE_CONTRACT) {
  const label = `${artifact.app}/${artifact.outDir}`;
  const assetsDir = path.join(root, 'apps', artifact.app, artifact.outDir, 'assets');

  if (!fs.existsSync(assetsDir)) {
    skipped += 1;
    console.log(`  ·  ${label.padEnd(30)} not built — skipped`);
    continue;
  }

  // What does this app DECLARE? `.env` is the committed source of truth.
  let envText = '';
  try {
    envText = fs.readFileSync(path.join(root, 'apps', artifact.app, '.env'), 'utf8');
  } catch { /* no .env — nothing declared, handled below */ }
  const expectedOrigin = parseEnvValue(envText, ORIGIN_ENV_VAR);
  const expectedKey = parseEnvValue(envText, API_KEY_ENV_VAR);

  // Concatenate the built JS. The origin lands in whichever chunk holds the
  // Firebase wiring, and which chunk that is is a build detail we must not encode.
  let bundleText = '';
  try {
    for (const file of fs.readdirSync(assetsDir)) {
      if (file.endsWith('.js')) bundleText += fs.readFileSync(path.join(assetsDir, file), 'utf8');
    }
  } catch (err) {
    failures += 1;
    console.error(`  ✗  ${label.padEnd(30)} could not be read: ${err.message}`);
    continue;
  }

  const res = checkBundleOrigin({ label, bundleText, expectedOrigin });
  checked += 1;
  if (res.skipped) {
    console.log(`  ·  ${label.padEnd(30)} declares no ${ORIGIN_ENV_VAR} — nothing to enforce`);
  } else if (res.ok) {
    console.log(`  ✓  ${label.padEnd(30)} points at ${expectedOrigin}`);
  } else {
    failures += 1;
    console.error(formatProblems([res.problem]));
  }

  // The API key is asserted separately from the origin: a missing key breaks AUTH,
  // which fails earlier and harder than a missing backend origin (2026-08-27 —
  // both live apps shipped the "emulator-key" fallback and nobody could sign in).
  const keyRes = checkBundleApiKey({ label, bundleText, expectedKey });
  if (keyRes.skipped) {
    console.log(`  ·  ${label.padEnd(30)} declares no ${API_KEY_ENV_VAR} — fallback absent, nothing to compare`);
  } else if (keyRes.ok) {
    console.log(`  ✓  ${label.padEnd(30)} carries its real ${API_KEY_ENV_VAR}`);
  } else {
    failures += 1;
    console.error(formatProblems([keyRes.problem]));
  }
}

console.log('');
if (failures > 0) {
  console.error(`❌ Backend-origin check FAILED (${failures} problem(s)).`);
  console.error('   Do NOT deploy: the bundle would load fine and reach no backend.\n');
  process.exit(1);
}
console.log(`✅ Backend-origin check passed (${checked} checked, ${skipped} not built).\n`);

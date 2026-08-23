// Runs BOTH rules suites (Firestore + Storage) inside ONE emulator boot.
//
//   node scripts/emulator-exec.mjs --only=firestore,storage "node scripts/run-rules-suites.mjs"
//
// Why (change: gauntlet-speed): verify:emulator used to spend a full
// `emulators:exec` boot on each rules suite, and each boot brought up the
// FUNCTIONS emulator — which loads the whole bundled functions/lib/index.js —
// even though neither suite calls a single callable. Both suites talk only to
// firestore + storage, and their identities come from
// @firebase/rules-unit-testing's `authenticatedContext`, which mints tokens
// locally rather than through the auth emulator. So one lighter boot covers both.
//
// Deliberately NOT folded into the e2e or simulate boots: those are the heavy,
// long-lived phases the fresh-JVM-per-phase rule exists for. This merges the two
// LIGHT phases with each other, which is the part that was pure overhead.
//
// Both suites always run — a failure in the first must not hide the second's
// result — and the exit code is non-zero if either failed.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = ['test-rules.mjs', 'test-storage-rules.mjs'];
const failed = [];

for (const suite of suites) {
  console.log(`\n\x1b[1m═══ ${suite} ═══\x1b[0m\n`);
  const res = spawnSync(process.execPath, [join(here, suite)], {
    stdio: 'inherit',
    cwd: dirname(here),
  });
  if (res.status !== 0) failed.push(suite);
}

if (failed.length > 0) {
  console.error(`\n\x1b[31m✗ rules suite(s) FAILED: ${failed.join(', ')}\x1b[0m`);
  process.exit(1);
}
console.log(`\n\x1b[32m✓ Both rules suites passed (${suites.join(' · ')}).\x1b[0m`);

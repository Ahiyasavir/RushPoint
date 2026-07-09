// Pure-logic unit-test runner — the TDD "fast lane".
//
// Discovers and runs every scripts/test-*.ts assertion script (tsx) in one shot,
// reporting a per-file pass/fail and exiting non-zero if ANY file fails. This is
// what wires the otherwise-orphaned pure-logic tests into the `npm test` gate so
// they can never silently rot again (a stale test-projection.ts referencing a
// renamed helper went unnoticed for exactly this reason).
//
// These tests need NO emulator — they import shared/functions pure logic directly
// (scoring, geo, validation, projection, station idempotency, …). Emulator-bound
// lifecycle checks live in scripts/e2e-verify.mjs (`npm run e2e`).
//
//   node scripts/run-unit-tests.mjs
//
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const files = readdirSync(here)
  .filter((f) => /^test-.*\.ts$/.test(f))
  .sort();

if (files.length === 0) {
  console.error('No scripts/test-*.ts files found.');
  process.exit(1);
}

console.log(`\n🧪 Pure-logic unit suite — ${files.length} file(s)\n`);

const failed = [];
for (const file of files) {
  console.log(`\x1b[1m▶ ${file}\x1b[0m`);
  const res = spawnSync('npx', ['tsx', join(here, file)], {
    stdio: 'inherit',
    shell: true,
  });
  if (res.status !== 0) failed.push(file);
  console.log('');
}

if (failed.length > 0) {
  console.error(`\x1b[31m✗ ${failed.length}/${files.length} unit file(s) FAILED: ${failed.join(', ')}\x1b[0m`);
  process.exit(1);
}

console.log(`\x1b[32m✓ All ${files.length} pure-logic unit file(s) passed.\x1b[0m`);

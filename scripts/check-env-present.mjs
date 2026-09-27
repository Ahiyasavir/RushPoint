// Fail-fast env-presence check for the DEPLOY PATH (change: deploy-env-presence-guard).
//
//   node scripts/check-env-present.mjs <target>     target: hosting | backend | rules | fn | all
//   npm run env:check -- hosting
//
// Runs as the FIRST step of every `deploy:*` script, BEFORE any build. It reads
// the gitignored source `.env` files directly and refuses to proceed if a
// required one is missing, empty, or still carries the "emulator-key" fallback.
//
// THE INCIDENT (2026-08-27, twice): a deploy ran from a git worktree, which does
// not carry the gitignored `apps/*/.env`. Every `VITE_*` fell back to its
// emulator default, creator.rush-point.com shipped `apiKey: "emulator-key"`, and
// nobody could sign in. `origin:check` would have caught it too — but only after
// ~4 full app builds, and only if the deploy went through the npm script. This
// check is the cheap early tripwire; the post-build guard stays as the backstop.
//
// All decision logic is pure and unit-tested in scripts/test-env-presence-guard.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateDeployEnv, DEPLOY_ENV_REQUIREMENTS } from './lib/envPresenceGuard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = (process.argv[2] || '').trim();

if (!Object.prototype.hasOwnProperty.call(DEPLOY_ENV_REQUIREMENTS, target)) {
  console.error(`\n❌ env:check needs a target: ${Object.keys(DEPLOY_ENV_REQUIREMENTS).join(' | ')}\n`);
  process.exit(2);
}

const readFile = (rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
};

console.log(`\n🔑 env:check (${target}) — required .env files present before build\n`);

const { ok, results, problems } = evaluateDeployEnv(target, readFile);

for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'}  ${r.path}`);
}

if (!ok) {
  console.error('');
  for (const p of problems) console.error(`  ✗  ${p}`);
  console.error('\n❌ Do NOT deploy. Restore the env file(s) from the main checkout, then retry.\n');
  process.exit(1);
}

console.log(`\n✅ env:check passed (${results.length} file(s)).\n`);

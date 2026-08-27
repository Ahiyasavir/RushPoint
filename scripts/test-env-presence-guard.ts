// Pure tests for the fail-fast deploy env-presence guard
// (change: deploy-env-presence-guard).
//
// THE INCIDENT (2026-08-27, twice in one day): a deploy ran from a git worktree,
// which does not carry the gitignored `apps/*/.env`. Vite fell every `VITE_*`
// back to its emulator default, creator.rush-point.com shipped
// `apiKey: "emulator-key"`, Firebase Auth rejected it, and no one — creator or
// participant — could sign in. `origin:check` would have caught it, but only
// after ~4 full app builds. This guard reads the source `.env` files directly,
// before any build, and is the FIRST step of every `deploy:*`.
//
// No emulator, no build, no fs — synthetic fixtures.
//   npx tsx scripts/test-env-presence-guard.ts
import {
  checkEnvFile, evaluateDeployEnv, dedupeRequirements, DEPLOY_ENV_REQUIREMENTS,
} from './lib/envPresenceGuard.mjs';
import { FALLBACK_API_KEY } from './lib/backendOriginGuard.mjs';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const REAL_KEY = 'AIzaSyReal-Production-Key-000000000000000';
const goodEnv = `VITE_FIREBASE_API_KEY=${REAL_KEY}\nVITE_API_ORIGIN=https://api.rush-point.com\n`;

// ── checkEnvFile ─────────────────────────────────────────────────────────────
check('missing file (null text) fails',
  checkEnvFile({ path: 'apps/creator-web/.env', text: null }, true).ok === false);

check('missing-file message names the worktree cause',
  /worktree|fresh clone|CI/.test(checkEnvFile({ path: 'apps/play-web/.env', text: null }, true).problem ?? ''));

check('empty file fails',
  checkEnvFile({ path: 'apps/creator-web/.env', text: '   \n\n' }, true).ok === false);

check('whitespace-only counts as empty, not as a bad key',
  /EMPTY/.test(checkEnvFile({ path: 'apps/creator-web/.env', text: '  ' }, true).problem ?? ''));

check('good env with a real key passes',
  checkEnvFile({ path: 'apps/creator-web/.env', text: goodEnv }, true).ok === true);

check('emulator-key fallback is refused',
  checkEnvFile({ path: 'apps/creator-web/.env', text: `VITE_FIREBASE_API_KEY=${FALLBACK_API_KEY}\n` }, true).ok === false);

check('present-but-no-key fails when requireApiKey',
  checkEnvFile({ path: 'apps/creator-web/.env', text: 'VITE_API_ORIGIN=https://api.rush-point.com\n' }, true).ok === false);

check('empty key value fails when requireApiKey',
  checkEnvFile({ path: 'apps/creator-web/.env', text: 'VITE_FIREBASE_API_KEY=\n' }, true).ok === false);

check('functions/.env: presence is enough, no key required',
  checkEnvFile({ path: 'functions/.env', text: 'STRIPE_SECRET=sk_live_x\nQR_SECRET=abc\n' }, false).ok === true);

check('functions/.env still fails when missing',
  checkEnvFile({ path: 'functions/.env', text: null }, false).ok === false);

check('commented-out key is treated as absent',
  checkEnvFile({ path: 'apps/creator-web/.env', text: '# VITE_FIREBASE_API_KEY=xyz\n' }, true).ok === false);

// ── dedupeRequirements ───────────────────────────────────────────────────────
check('dedupe keeps strictest (requireApiKey wins)',
  dedupeRequirements([
    { path: 'functions/.env', requireApiKey: false },
    { path: 'functions/.env', requireApiKey: true },
  ]).every((r) => r.requireApiKey === true));

check('deploy:all requirements dedupe to 3 distinct paths',
  dedupeRequirements(DEPLOY_ENV_REQUIREMENTS.all).length === 3);

// ── evaluateDeployEnv ────────────────────────────────────────────────────────
const allGood = (rel: string) =>
  rel === 'functions/.env' ? 'QR_SECRET=abc\n' : goodEnv;

check('hosting passes when both app envs are good',
  evaluateDeployEnv('hosting', allGood).ok === true);

check('hosting fails when play-web/.env is missing',
  evaluateDeployEnv('hosting', (rel) => (rel === 'apps/play-web/.env' ? null : goodEnv)).ok === false);

check('backend fails when functions/.env is missing',
  evaluateDeployEnv('backend', () => null).ok === false);

check('all reports every missing file at once',
  evaluateDeployEnv('all', () => null).problems.length === 3);

check('unknown target is a hard failure',
  evaluateDeployEnv('bogus', () => null).ok === false);

check('hosting requires exactly the two Vite apps',
  DEPLOY_ENV_REQUIREMENTS.hosting.map((r) => r.path).sort().join(',')
    === 'apps/creator-web/.env,apps/play-web/.env');

console.log(failures === 0 ? '\n✅ ALL PASS' : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

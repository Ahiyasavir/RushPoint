// Fail-fast env-presence guard for the DEPLOY PATH — PURE.
//
// THE INCIDENT THIS EXISTS FOR (2026-08-27, twice in one day). A build/deploy
// ran from a git worktree (equivalently: a fresh clone, or a CI runner). The
// `apps/*/.env` and `functions/.env` files are gitignored, so none of them were
// present. Vite fell every `VITE_*` back to its emulator-safe default:
// `apps/creator-web` shipped `apiKey: "emulator-key"`, Firebase Auth rejected it,
// and NOBODY — creator or participant — could sign in. The Hebrew console read
// "ההתחברות נכשלה. נסה שוב בעוד רגע."
//
// `origin:check` / `checkBundleApiKey` already catch this AFTER a full build, and
// `deploy:hosting` now runs them. But they run late (after ~4 app builds) and
// only if the deploy goes through the npm script. This guard is the CHEAP, EARLY
// tripwire: it reads the source `.env` files directly, before anything is built,
// and refuses to proceed if a required one is missing, empty, or still carries
// the `emulator-key` fallback. Wire it as the FIRST step of every `deploy:*`.
//
// Pure: no fs, no child_process, no network. The caller reads the files and
// passes {path, text} records; this module only decides.
//   • scripts/check-env-present.mjs      — the real files (`npm run env:check`)
//   • scripts/test-env-presence-guard.ts — synthetic fixtures (in `npm test`)

import { parseEnvValue, FALLBACK_API_KEY } from './backendOriginGuard.mjs';

/** The Firebase Web API key. Absent ⇒ the app authenticates nobody. */
export const API_KEY_ENV_VAR = 'VITE_FIREBASE_API_KEY';

/**
 * Which env files each deploy target requires to be present and sane.
 *
 *   • `hosting` builds the two Vite apps — each needs its own `.env` with a real
 *     Firebase Web API key (the variable whose absence breaks auth outright).
 *   • `backend` / `rules` / `fn` deploy Cloud Functions, which read server-only
 *     secrets from `functions/.env` (STRIPE_*, QR_SECRET). That file has no
 *     `VITE_*` key to sanity-check, so it is presence-only.
 *
 * `requireApiKey: true` ⇒ the file must also parse a non-empty
 * VITE_FIREBASE_API_KEY that is not the `emulator-key` fallback.
 */
export const DEPLOY_ENV_REQUIREMENTS = {
  hosting: [
    { path: 'apps/creator-web/.env', requireApiKey: true },
    { path: 'apps/play-web/.env', requireApiKey: true },
  ],
  backend: [
    { path: 'functions/.env', requireApiKey: false },
  ],
};

DEPLOY_ENV_REQUIREMENTS.rules = DEPLOY_ENV_REQUIREMENTS.backend;
DEPLOY_ENV_REQUIREMENTS.fn = DEPLOY_ENV_REQUIREMENTS.backend;
DEPLOY_ENV_REQUIREMENTS.all = [
  ...DEPLOY_ENV_REQUIREMENTS.backend,
  ...DEPLOY_ENV_REQUIREMENTS.hosting,
];

/**
 * De-duplicate a set of {path, requireApiKey} requirements by path, keeping the
 * STRICTEST (requireApiKey wins). `deploy:all` unions two lists that can overlap.
 */
export function dedupeRequirements(reqs) {
  const byPath = new Map();
  for (const r of reqs ?? []) {
    if (!r || typeof r.path !== 'string') continue;
    const prev = byPath.get(r.path);
    byPath.set(r.path, { path: r.path, requireApiKey: Boolean(prev?.requireApiKey || r.requireApiKey) });
  }
  return [...byPath.values()];
}

/**
 * Evaluate one env file.
 *
 * `record` is `{ path, text }` where `text` is the file's contents, or `null`
 * when the file does not exist. Returns `{ path, ok, problem }`.
 *
 * Total — never throws. A hand-edited or absent file must produce a verdict, not
 * a stack trace.
 */
export function checkEnvFile(record, requireApiKey) {
  const path = record?.path ?? '(unknown file)';
  const text = record?.text;

  if (text === null || text === undefined) {
    return {
      path,
      ok: false,
      problem:
        `${path} is MISSING. It is gitignored, so a git worktree, a fresh clone, `
        + `and a CI runner all start without it. Copy it in from the main checkout `
        + `(C:\\Users\\savir\\Projects\\Rushpoint) before deploying — a build without `
        + `it ships the "emulator-key" fallback and every sign-in fails.`,
    };
  }

  if (typeof text !== 'string' || text.trim() === '') {
    return { path, ok: false, problem: `${path} is EMPTY — it declares nothing, so the build falls back to emulator defaults.` };
  }

  if (!requireApiKey) {
    return { path, ok: true, problem: null };
  }

  const key = parseEnvValue(text, API_KEY_ENV_VAR);
  if (key === null || key === '') {
    return {
      path,
      ok: false,
      problem: `${path} has no ${API_KEY_ENV_VAR}. The build would ship the "${FALLBACK_API_KEY}" fallback and Firebase Auth would reject every sign-in.`,
    };
  }
  if (key === FALLBACK_API_KEY) {
    return {
      path,
      ok: false,
      problem: `${path} sets ${API_KEY_ENV_VAR}="${FALLBACK_API_KEY}" — that is the emulator fallback, not a real key. Restore the production value.`,
    };
  }
  return { path, ok: true, problem: null };
}

/**
 * Full verdict for a deploy target. `target` is a key of DEPLOY_ENV_REQUIREMENTS
 * ('hosting' | 'backend' | 'rules' | 'fn' | 'all'); `readFile(path)` returns the
 * file text or null. Returns `{ ok, results, problems }`.
 */
export function evaluateDeployEnv(target, readFile) {
  const reqs = dedupeRequirements(DEPLOY_ENV_REQUIREMENTS[target]);
  if (reqs.length === 0) {
    return { ok: false, results: [], problems: [`Unknown deploy target "${target}" — no env requirements declared.`] };
  }
  const results = reqs.map((r) => checkEnvFile({ path: r.path, text: readFile(r.path) }, r.requireApiKey));
  const problems = results.filter((r) => !r.ok).map((r) => r.problem);
  return { ok: problems.length === 0, results, problems };
}

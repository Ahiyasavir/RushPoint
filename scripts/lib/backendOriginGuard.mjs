// Production backend-origin guard (change: deploy-backend-origin-guard) — PURE.
//
// THE INCIDENT THIS EXISTS FOR (2026-08-14). `apps/creator-web/.env` sets
// VITE_API_ORIGIN=https://api.rush-point.com — the self-hosted VPS every callable
// goes to. A gitignored `apps/creator-web/.env.local` overrode it with an EMPTY
// value so a LOCAL dev server could not autosave into real creator data (the Builder
// saves 1.5s after any edit, so that protection is genuinely wanted).
//
// But **Vite loads `.env.local` in EVERY mode, including `vite build --mode
// production`.** So `npm run deploy:hosting` compiled the empty value into the real
// bundle, and creator.rush-point.com shipped with every callable pointing nowhere.
// The live console showed "טעינת המשחקים נכשלה" and nothing else was wrong.
//
// WHY EVERY EXISTING SIGNAL STAYED GREEN — this is the part worth remembering:
// the build succeeded, `base:check` passed (the asset base WAS correct),
// `bundle:budget` passed, `firebase deploy` reported success, the served asset hash
// matched the local build byte for byte, and the site answered 200. All true, all
// irrelevant: they verify that the bundle was built and shipped faithfully, never
// that it was built against the right backend. A hash match proves you deployed the
// file you built; it says nothing about whether that file is correct.
//
// TWO TRIPWIRES, because either one alone leaves a hole:
//   1. `envOverrideHazards` — refuses a `.env.local` in an app directory outright,
//      BEFORE any build, and names the fix. Catches the cause.
//   2. `checkBundleOrigin` — a built production bundle must actually contain the
//      origin its own `.env` declares. Catches the effect however it arises: a stale
//      `dist`, a mis-set CI variable, some future override file nobody predicted.
//
// Pure: no fs, no child_process, no network. Callers supply the bytes.
//   • scripts/test-backend-origin-guard.ts — synthetic fixtures (in `npm test`)
//   • scripts/check-backend-origin.mjs     — the real files (`npm run origin:check`)

// THE SECOND INCIDENT (2026-08-27), which is why tripwire 3 below exists. Both
// live apps were serving a bundle built with NO `.env` present at all — so EVERY
// `VITE_*` variable fell back to its emulator-safe default. creator-web shipped
// `apiKey: "emulator-key"` and every sign-in died on
// `auth/api-key-not-valid.-please-pass-a-valid-api-key.`; play-web shipped the
// same key, so no participant could sign in anonymously either. Nobody could log
// in and nobody could join a game.
//
// `origin:check` would have caught it — a bundle with no `.env` also has no
// VITE_API_ORIGIN — but ONLY if it had run, and `deploy:hosting` did not run it.
// Two changes came out of that: the deploy script now runs base:check +
// origin:check before `firebase deploy`, and the API key gets its own assertion
// rather than being caught by accident as a side effect of the origin one. The
// key is the variable whose absence breaks AUTH, which fails earlier and harder
// than a missing backend origin, so it deserves to be named in its own right.

/** The variable that routes callables away from the default Functions endpoint. */
export const ORIGIN_ENV_VAR = 'VITE_API_ORIGIN';

/** The Firebase Web API key. Absent ⇒ the app cannot authenticate anyone. */
export const API_KEY_ENV_VAR = 'VITE_FIREBASE_API_KEY';

/**
 * The emulator-safe fallback both apps' `services/firebase.ts` use when
 * VITE_FIREBASE_API_KEY is undefined. Harmless locally (the Auth emulator accepts
 * any non-empty string); fatal in production, where Google rejects it outright.
 * Its presence in a DEPLOYED bundle is proof the build saw no key.
 */
export const FALLBACK_API_KEY = 'emulator-key';

/**
 * Env files Vite applies to EVERY mode, production included. A local-only override
 * placed here silently becomes part of a real deploy — the whole incident above.
 */
export const UNSAFE_OVERRIDE_FILENAMES = ['.env.local'];

/**
 * The correct home for a dev-only override: Vite loads `.env.development.local`
 * only when mode === 'development', so a production build cannot inherit it.
 */
export const SAFE_DEV_OVERRIDE = '.env.development.local';

/**
 * Built artifacts that are DEPLOYED and therefore must talk to the real backend.
 *
 * `dist` only. `dist-playtest` is emulator-bound by design (isEmulatorBuild in
 * packages/shared/src/env.ts is `DEV || MODE === 'playtest'`), so demanding the
 * production origin there would fail a perfectly correct build.
 */
export const PRODUCTION_BUNDLE_CONTRACT = [
  { app: 'creator-web', outDir: 'dist' },
  { app: 'play-web', outDir: 'dist' },
];

/**
 * Read `key` out of dotenv-style text.
 *
 * Returns the string value (possibly EMPTY), or null when the key is absent or only
 * appears commented out. The empty/absent distinction is the entire point: an empty
 * assignment is what broke production, so it must never be reported as "not set".
 * The last assignment wins, matching dotenv. Total — this reads hand-edited files.
 */
export function parseEnvValue(text, key) {
  if (typeof text !== 'string' || typeof key !== 'string') return null;
  let found = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip one matching pair of surrounding quotes, as dotenv does.
    if (value.length >= 2
      && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    found = value;
  }
  return found;
}

/**
 * Problems with an app's env FILES, independent of any build.
 *
 * Fires on a `.env.local`, whose only distinguishing property is the one that made
 * it dangerous: it applies to production builds too. The message names the file, the
 * consequence, and the rename that fixes it — a guard that only says "no" costs the
 * next person the same hour this cost.
 */
export function envOverrideHazards(args) {
  const app = args?.app ?? '(unknown app)';
  const filenames = Array.isArray(args?.filenames) ? args.filenames : [];
  const problems = [];
  for (const name of filenames) {
    if (!UNSAFE_OVERRIDE_FILENAMES.includes(name)) continue;
    problems.push(
      `apps/${app}/${name} is loaded by Vite in EVERY mode, so it applies to a `
      + `production build and ships to real users. A local-only override belongs in `
      + `${SAFE_DEV_OVERRIDE} (dev mode only) — rename it.`,
    );
  }
  return problems;
}

/**
 * Does a built production bundle actually carry the backend origin it declares?
 *
 * `expectedOrigin` null/empty ⇒ nothing declared ⇒ nothing to enforce: an app using
 * the default Functions endpoint must not be failed by a guard about a variable it
 * never set. Anything else must appear literally in the bundle text.
 */
export function checkBundleOrigin({ label, bundleText, expectedOrigin } = {}) {
  const name = label ?? '(unknown artifact)';
  if (expectedOrigin === null || expectedOrigin === undefined || expectedOrigin === '') {
    return { ok: true, problem: null, skipped: true };
  }
  if (typeof bundleText !== 'string' || bundleText === '') {
    return {
      ok: false,
      problem: `${name}: no bundle text could be read, so its backend origin cannot be verified.`,
    };
  }
  if (!bundleText.includes(expectedOrigin)) {
    return {
      ok: false,
      problem:
        `${name}: built WITHOUT its declared ${ORIGIN_ENV_VAR} ("${expectedOrigin}"). `
        + `Every callable in this bundle would point nowhere instead of at the backend — `
        + `the app loads and returns 200 while no data ever arrives. Most likely an env `
        + `override applied to the production build (see ${SAFE_DEV_OVERRIDE}), or a stale `
        + `${'dist'} from an earlier build. Rebuild and re-check before deploying.`,
    };
  }
  return { ok: true, problem: null, skipped: false };
}

/**
 * Does a built production bundle carry a REAL Firebase API key?
 *
 * Fails on the `emulator-key` fallback (the build saw no key at all) and on a key
 * that disagrees with the one `.env` declares (a stale dist, or a build from a
 * checkout carrying different env files).
 *
 * `expectedKey` null/empty ⇒ the app declares no key, so there is nothing to
 * compare against — but the FALLBACK is still refused, because a deployed bundle
 * containing it is broken regardless of what any env file says. That asymmetry is
 * deliberate: "I can't verify this" and "I can see this is wrong" are different
 * verdicts, and only the second one should fail a build that declared nothing.
 */
export function checkBundleApiKey({ label, bundleText, expectedKey } = {}) {
  const name = label ?? '(unknown artifact)';
  if (typeof bundleText !== 'string' || bundleText === '') {
    return {
      ok: false,
      problem: `${name}: no bundle text could be read, so its Firebase API key cannot be verified.`,
    };
  }

  if (bundleText.includes(`"${FALLBACK_API_KEY}"`) || bundleText.includes(`'${FALLBACK_API_KEY}'`)) {
    return {
      ok: false,
      problem:
        `${name}: built WITHOUT ${API_KEY_ENV_VAR} — it carries the "${FALLBACK_API_KEY}" `
        + `fallback. Firebase Auth rejects that key in production, so EVERY sign-in fails `
        + `with auth/api-key-not-valid and no participant can join. The build saw no `
        + `apps/<app>/.env (it is gitignored, so a fresh clone, a git worktree or a CI `
        + `runner has none). Restore the env file, rebuild, and re-check before deploying.`,
    };
  }

  if (expectedKey === null || expectedKey === undefined || expectedKey === '') {
    return { ok: true, problem: null, skipped: true };
  }

  if (!bundleText.includes(expectedKey)) {
    return {
      ok: false,
      problem:
        `${name}: does not contain the ${API_KEY_ENV_VAR} its own .env declares. `
        + `The bundle was built against different env files, or dist is stale. `
        + `Rebuild and re-check before deploying.`,
    };
  }
  return { ok: true, problem: null, skipped: false };
}

/** Render problems for a terminal, one per line. */
export function formatProblems(problems) {
  return (problems ?? []).map((p) => `  ✗  ${p}`).join('\n');
}

// Pure-logic tests for the Firebase App Check wiring decision (change: app-check-ready).
//
// App Check is a lockout weapon pointed at our own users: attach it in an emulator
// build and every local/playtest/e2e session breaks; enforce it before the real apps
// are registered in the Firebase console and every real phone gets rejected. So the
// whole feature is defined by what it must NOT do, and that is what this suite pins:
//
//   1. NO INIT in an emulator build (DEV or --mode playtest) — ever, key or not.
//   2. NO INIT when no site key is configured — the .env.example ships it blank, so
//      "unconfigured" is the normal state and must be byte-for-byte today's behaviour.
//   3. Enforcement DEFAULTS TO 'off' — every unrecognised value included. A typo
//      ('true', 'enforc', 'yes') must never silently become enforcement.
//   4. TOTAL — no env shape throws, so a broken decision can't white-screen an app.
//   5. The server guard throws ONLY in 'enforce' mode with a missing context.app.
//
//   npx tsx scripts/test-app-check.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  shouldInitAppCheck,
  appCheckEnforcement,
  appCheckSiteKey,
  APP_CHECK_SITE_KEY_ENV,
  APP_CHECK_ENFORCE_ENV,
  type AppCheckEnv,
} from '../packages/shared/src/appCheck';
import { assertAppCheck } from '../functions/src/appCheckGuard';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const here = dirname(fileURLToPath(import.meta.url));
const KEY = '6Lc-test-site-key';
const env = (o: Record<string, unknown>) => o as AppCheckEnv;

// ─── 1. shouldInitAppCheck — the emulator lanes stay untouched ────────────────
check('production build with a key → init',
  shouldInitAppCheck(env({ DEV: false, MODE: 'production', [APP_CHECK_SITE_KEY_ENV]: KEY })) === true);

// `vite dev`: the Auth/Functions emulators never mint App Check tokens.
check('DEV build with a key → NO init',
  shouldInitAppCheck(env({ DEV: true, MODE: 'development', [APP_CHECK_SITE_KEY_ENV]: KEY })) === false);
// The playtest bundle is a PRODUCTION build (DEV === false) that talks to the
// emulator through the tunnel — the exact case isEmulatorBuild exists for.
check('--mode playtest with a key → NO init',
  shouldInitAppCheck(env({ DEV: false, MODE: 'playtest', [APP_CHECK_SITE_KEY_ENV]: KEY })) === false);
check('DEV + playtest together → NO init',
  shouldInitAppCheck(env({ DEV: true, MODE: 'playtest', [APP_CHECK_SITE_KEY_ENV]: KEY })) === false);

// ─── 2. No key configured ⇒ today's behaviour, exactly ────────────────────────
check('production, key absent → NO init',
  shouldInitAppCheck(env({ DEV: false, MODE: 'production' })) === false);
for (const blank of ['', '   ', '\t\n']) {
  check(`production, blank key ${JSON.stringify(blank)} → NO init`,
    shouldInitAppCheck(env({ DEV: false, MODE: 'production', [APP_CHECK_SITE_KEY_ENV]: blank })) === false);
}
for (const bad of [null, undefined, 0, 1, {}, [], true, NaN]) {
  check(`production, non-string key ${String(bad)} → NO init`,
    shouldInitAppCheck(env({ DEV: false, [APP_CHECK_SITE_KEY_ENV]: bad })) === false);
}

// appCheckSiteKey itself: trimmed value or null, never an empty string.
check('site key is trimmed', appCheckSiteKey(env({ [APP_CHECK_SITE_KEY_ENV]: `  ${KEY}  ` })) === KEY);
check('missing site key → null', appCheckSiteKey(env({})) === null);
check('blank site key → null', appCheckSiteKey(env({ [APP_CHECK_SITE_KEY_ENV]: '  ' })) === null);

// ─── 3. Enforcement defaults to 'off' ─────────────────────────────────────────
check('no value → off', appCheckEnforcement(env({})) === 'off');
check("explicit 'off' → off", appCheckEnforcement(env({ [APP_CHECK_ENFORCE_ENV]: 'off' })) === 'off');
check("'monitor' → monitor", appCheckEnforcement(env({ [APP_CHECK_ENFORCE_ENV]: 'monitor' })) === 'monitor');
check("'enforce' → enforce", appCheckEnforcement(env({ [APP_CHECK_ENFORCE_ENV]: 'enforce' })) === 'enforce');
check("' ENFORCE ' (case/space) → enforce",
  appCheckEnforcement(env({ [APP_CHECK_ENFORCE_ENV]: ' ENFORCE ' })) === 'enforce');
// THE lockout guard: nothing that merely *looks* affirmative may enforce.
for (const bad of ['true', 'yes', '1', 'on', 'enforc', 'enforced', 'ENFORCE!', 'monitor,enforce', 'strict']) {
  check(`unrecognised ${JSON.stringify(bad)} → off`,
    appCheckEnforcement(env({ [APP_CHECK_ENFORCE_ENV]: bad })) === 'off',
    appCheckEnforcement(env({ [APP_CHECK_ENFORCE_ENV]: bad })));
}
for (const bad of [null, undefined, 1, true, {}, []]) {
  check(`non-string enforcement ${String(bad)} → off`,
    appCheckEnforcement(env({ [APP_CHECK_ENFORCE_ENV]: bad })) === 'off');
}

// ─── 4. Totality — a malformed env must never throw ───────────────────────────
let threw = false;
try {
  for (const bad of [undefined, null, 0, 42, 'env', true, [], () => undefined, Object.create(null)]) {
    shouldInitAppCheck(bad as unknown as AppCheckEnv);
    appCheckEnforcement(bad as unknown as AppCheckEnv);
    appCheckSiteKey(bad as unknown as AppCheckEnv);
  }
  // A hostile env whose getters throw must not take the app down either.
  const hostile = {} as Record<string, unknown>;
  Object.defineProperty(hostile, APP_CHECK_SITE_KEY_ENV, { get() { throw new Error('boom'); } });
  Object.defineProperty(hostile, APP_CHECK_ENFORCE_ENV, { get() { throw new Error('boom'); } });
  shouldInitAppCheck(hostile as AppCheckEnv);
  appCheckEnforcement(hostile as AppCheckEnv);
} catch {
  threw = true;
}
check('no env shape makes a decision throw', threw === false);
check('a garbage env still refuses to init', shouldInitAppCheck(undefined as unknown as AppCheckEnv) === false);
check('a garbage env still defaults to off', appCheckEnforcement(undefined as unknown as AppCheckEnv) === 'off');

// ─── 5. assertAppCheck — throws in 'enforce' mode ONLY ────────────────────────
function throwsAssert(context: unknown, mode: unknown): boolean {
  try {
    assertAppCheck(
      context as { app?: unknown },
      mode as 'off' | 'monitor' | 'enforce',
      'testCallable',
    );
    return false;
  } catch {
    return true;
  }
}

const VERIFIED = { app: { appId: 'app-1', token: {} }, auth: { uid: 'u1' } };
const UNVERIFIED = { auth: { uid: 'u1' } };

check("enforce + missing context.app → throws", throwsAssert(UNVERIFIED, 'enforce') === true);
check("enforce + verified context.app → passes", throwsAssert(VERIFIED, 'enforce') === false);
check("enforce + null context → throws", throwsAssert(null, 'enforce') === true);
// Everything below is the DARK path: never throws, whatever the context looks like.
for (const mode of ['off', 'monitor', undefined, 'ENFORCE', 'enforc', 'true', null, 1, {}]) {
  check(`mode ${JSON.stringify(mode)} + missing app → does NOT throw`, throwsAssert(UNVERIFIED, mode) === false);
  check(`mode ${JSON.stringify(mode)} + verified app → does NOT throw`, throwsAssert(VERIFIED, mode) === false);
  check(`mode ${JSON.stringify(mode)} + garbage context → does NOT throw`, throwsAssert(undefined, mode) === false);
}
// 'off' is a PURE no-op: it must not even log (monitor is the observation phase).
check('off mode with no context is a no-op', throwsAssert(undefined, 'off') === false);

// ─── 6. Wiring guards — the apps must actually USE the decision ───────────────
// A pure function nobody calls protects nothing; there is no component test runner
// for either web app, so the wiring is asserted against the source.
for (const app of ['play-web', 'creator-web']) {
  const src = readFileSync(join(here, '..', 'apps', app, 'src', 'services', 'firebase.ts'), 'utf8');
  check(`${app} imports the shared decision`, src.includes('shouldInitAppCheck'));
  check(`${app} initializes App Check behind that decision`,
    /if\s*\(\s*shouldInitAppCheck\(/.test(src), '');
  check(`${app} uses ReCaptchaV3Provider`, src.includes('ReCaptchaV3Provider'));
  check(`${app} auto-refreshes its token`, src.includes('isTokenAutoRefreshEnabled: true'));
  // Startup must survive a bad/blocked key — a white-screened app is worse than
  // an unattested one (this repo's rule: client-side gates fail OPEN).
  check(`${app} wraps App Check init in try/catch`,
    /try\s*{[\s\S]{0,600}?initializeAppCheck\([\s\S]{0,600}?}\s*catch/.test(src));
  // It must read the key from the env var, not a literal.
  check(`${app} reads the site key from the env`, src.includes('appCheckSiteKey('));
}

// The shared barrel must export it (legalContent/legalMarkdown are the deliberate
// deep-import exceptions; appCheck is not one of them).
const barrel = readFileSync(join(here, '..', 'packages', 'shared', 'src', 'index.ts'), 'utf8');
check('the shared barrel exports appCheck', /export \* from '\.\/appCheck';/.test(barrel));

// The guard ships DARK: no callable may call it yet (see appCheckGuard.ts header).
const fnIndex = readFileSync(join(here, '..', 'functions', 'src', 'index.ts'), 'utf8');
check('assertAppCheck is not wired into any callable yet', !fnIndex.includes('assertAppCheck('));

// Both .env.example files must document the two knobs, with enforcement off.
for (const app of ['play-web', 'creator-web']) {
  const example = readFileSync(join(here, '..', 'apps', app, '.env.example'), 'utf8');
  check(`${app}/.env.example documents the site key`, example.includes(`${APP_CHECK_SITE_KEY_ENV}=`));
  check(`${app}/.env.example ships enforcement off`, example.includes(`${APP_CHECK_ENFORCE_ENV}=off`));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

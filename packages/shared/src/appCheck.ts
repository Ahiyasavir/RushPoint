// Firebase App Check — the WIRING decision, kept pure so it can be regression-locked
// by a unit test and shared verbatim by both web apps (change: app-check-ready).
//
// The whole point of this module is that App Check ships READY but DARK:
//   * a build with no site key configured must behave exactly as it does today;
//   * an emulator/playtest build must NEVER attach App Check — the Auth/Functions
//     emulators do not mint App Check tokens, so attaching it would break dev:all,
//     the playtest tunnel and the e2e suite;
//   * enforcement is opt-in and defaults to 'off', because enforcing before the
//     real apps are registered in the Firebase console locks out EVERY real user.
//
// Every function here is TOTAL: a malformed / missing / hostile `env` yields the
// SAFEST answer (no init, no enforcement) instead of throwing. This follows the
// repo's fail-open convention for client-side gates (safeZone.ts, stuckGuards.ts):
// a broken decision must never stop a player from reaching the server.

import { isEmulatorBuild } from './env';

/** The env var carrying the reCAPTCHA v3 site key (public by design). */
export const APP_CHECK_SITE_KEY_ENV = 'VITE_APP_CHECK_SITE_KEY';
/** The env var carrying the enforcement level. */
export const APP_CHECK_ENFORCE_ENV = 'VITE_APP_CHECK_ENFORCE';

/**
 * How the SERVER should treat a request that arrives without a valid App Check token.
 *  - 'off'     — ignore entirely (the default, and the only safe pre-registration value).
 *  - 'monitor' — log it, but serve the request (the observation phase before enforcing).
 *  - 'enforce' — reject it (only once every real app is registered and attesting).
 */
export type AppCheckEnforcement = 'off' | 'monitor' | 'enforce';

/** Shape read from `import.meta.env`; every field optional, nothing trusted. */
export interface AppCheckEnv {
  DEV?: boolean;
  MODE?: string;
  [APP_CHECK_SITE_KEY_ENV]?: unknown;
  [APP_CHECK_ENFORCE_ENV]?: unknown;
  [key: string]: unknown;
}

/** Read a string env value, tolerating any garbage the bundler could hand us. */
function readString(env: unknown, key: string): string {
  if (!env || typeof env !== 'object') return '';
  const raw = (env as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * The configured reCAPTCHA v3 site key, or null when none is set. An empty /
 * whitespace-only / non-string value counts as "not configured" — `.env.example`
 * ships the key blank, so the empty string is the NORMAL state, not an error.
 */
export function appCheckSiteKey(env: AppCheckEnv | undefined | null): string | null {
  const key = readString(env, APP_CHECK_SITE_KEY_ENV);
  return key.length > 0 ? key : null;
}

/**
 * Should this build attach App Check to the Firebase app at startup?
 * False for any emulator build (dev + `--mode playtest`), false when no site key
 * is configured, true otherwise. Total: garbage input ⇒ false.
 */
export function shouldInitAppCheck(env: AppCheckEnv | undefined | null): boolean {
  try {
    if (!env || typeof env !== 'object') return false;
    if (isEmulatorBuild(env as { DEV?: boolean; MODE?: string })) return false;
    return appCheckSiteKey(env) !== null;
  } catch {
    return false;
  }
}

/**
 * The declared enforcement level. Defaults to 'off' for ANY unrecognised value —
 * a typo ('enforc', 'true', 'yes') must never silently become enforcement.
 * Case-insensitive; whitespace-tolerant.
 */
export function appCheckEnforcement(env: AppCheckEnv | undefined | null): AppCheckEnforcement {
  try {
    const raw = readString(env, APP_CHECK_ENFORCE_ENV).toLowerCase();
    if (raw === 'enforce') return 'enforce';
    if (raw === 'monitor') return 'monitor';
    return 'off';
  } catch {
    return 'off';
  }
}

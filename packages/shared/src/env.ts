// Build-environment gates shared by the play-web + creator-web Firebase wiring.
// Pure (no import.meta) so they can be regression-locked by a unit test.

/**
 * Whether a Vite build should wire the LOCAL Firebase emulator instead of real
 * Firebase. True in `vite dev` (DEV) AND in the production `--mode playtest`
 * build that the always-on tunnel host serves (browser-02 P0 #1): without the
 * playtest branch the minified bundle drops all emulator wiring and hits real
 * Firebase — where anonymous auth is disabled (auth/admin-restricted-operation)
 * — so no real phone can join a playtest link. Keyed on MODE, not just DEV,
 * precisely because a playtest build is a PRODUCTION build (DEV === false).
 */
export function isEmulatorBuild(env: { DEV?: boolean; MODE?: string }): boolean {
  return env.DEV === true || env.MODE === 'playtest';
}

import { isEmulatorBuild, isTaskMediaValid } from '@rushpoint/shared';

/**
 * The media check the SERVER applies, as this build's server applies it. On the emulator the server
 * also accepts the Storage emulator's own URLs (functions/src/storageOriginOpts.ts); the browser used
 * the production rule everywhere, so on a local stack or a playtest every uploaded picture came back
 * "ההעלאה לא עברה" in the setup walk and the mission editor while the upload had in fact worked
 * (found 29.10). Production is unchanged: there the emulator form is refused on both sides.
 */
export function acceptsTaskMedia(m: unknown, env: { DEV?: boolean; MODE?: string } | undefined): boolean {
  return isTaskMediaValid(m, { allowLocalEmulator: isEmulatorBuild(env ?? {}) });
}

/** `acceptsTaskMedia` for this build. */
export function isAcceptedTaskMedia(m: unknown): boolean {
  let env: { DEV?: boolean; MODE?: string } | undefined;
  try { env = import.meta.env; } catch { env = undefined; }
  return acceptsTaskMedia(m, env);
}

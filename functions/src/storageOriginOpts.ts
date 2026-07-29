// Shared Storage URL accept-set for callables (wave-c emulator + VPS uploads).
// validation.ts stays pure — env is read here only.
import type { StorageOriginOptions } from '@rushpoint/shared';

export function storageOriginOpts(): StorageOriginOptions {
  const opts: StorageOriginOptions = {
    allowLocalEmulator: process.env.FUNCTIONS_EMULATOR === 'true',
  };
  const vps = process.env.VPS_UPLOAD_ORIGIN?.trim();
  if (vps) opts.vpsOrigin = vps.replace(/\/+$/, '');
  return opts;
}

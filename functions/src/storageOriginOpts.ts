// Shared Storage URL accept-set for callables (wave-c emulator + VPS uploads).
// validation.ts stays pure — env is read here only.
//
// The canonical upload origins are COMPILED IN (RUSHPOINT_UPLOAD_ORIGINS in shared) and
// merely UNIONED with the env var here (change: task-media-durability). They used to come
// from `VPS_UPLOAD_ORIGIN` alone, which made one env var load-bearing for data retention:
// absent or renamed, the callables stopped recognising the URLs this platform itself had
// minted, and `normalizeTaskMedia` — a filter — deleted every creator's stored picture on
// the next autosave while reporting success. The env var stays supported so a staging or
// self-hosted origin is still configurable; it is just no longer the only thing standing
// between a creator and losing their photos.
import type { StorageOriginOptions } from '@rushpoint/shared';

export function storageOriginOpts(): StorageOriginOptions {
  const opts: StorageOriginOptions = {
    allowLocalEmulator: process.env.FUNCTIONS_EMULATOR === 'true',
  };
  const vps = process.env.VPS_UPLOAD_ORIGIN?.trim();
  if (vps) opts.vpsOrigins = [vps.replace(/\/+$/, '')];
  return opts;
}

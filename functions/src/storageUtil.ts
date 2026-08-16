// Storage cleanup helpers shared by deletion + retention paths.
//
// Uploaded participant photos live under `runs/{runId}/teams/{teamId}/…`.
// Deleting a run, a game, or an account must also remove those objects, or they
// orphan in the bucket forever (cost + a "right to erasure" gap). All helpers
// are best-effort: a failure is logged but never aborts the surrounding delete.
//
// On the self-hosted VPS (no Firebase Storage bucket), the same paths are stored
// on disk under UPLOAD_DIR; deleteLocalUploadPrefix mirrors bucket().deleteFiles.

import * as functions from 'firebase-functions';
import fs from 'node:fs';
import path from 'node:path';
import { storage } from './firebase';
// Prefixes come from pure, unit-tested derivation (change: storage-rules-hardening).
// They are built INSIDE the try so a refused (blank / slash-bearing) id is logged
// and skipped instead of issuing a widened `deleteFiles` — a `runs/` prefix would
// erase every run's photos in the bucket.
import { runPhotoPrefix, gameMediaPrefix } from './storagePaths';

const UPLOAD_DIR = process.env.UPLOAD_DIR?.trim() || '';

/** Resolve a prefix under UPLOAD_DIR, or null if it would escape the root. */
function safeUploadPath(prefix: string): string | null {
  const target = path.resolve(UPLOAD_DIR, prefix);
  const root = path.resolve(UPLOAD_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) {
    functions.logger.warn('storageUtil: refused path escape', { prefix });
    return null;
  }
  return target;
}

async function deleteLocalUploadPrefix(prefix: string): Promise<void> {
  if (!UPLOAD_DIR) return;
  const target = safeUploadPath(prefix);
  if (!target) return;
  await fs.promises.rm(target, { recursive: true, force: true });
}

// Remove every uploaded object for one run.
export async function deleteRunPhotos(runId: string): Promise<void> {
  const prefix = runPhotoPrefix(runId);
  try {
    await storage.bucket().deleteFiles({ prefix });
  } catch (e) {
    functions.logger.warn(`deleteRunPhotos: bucket delete failed for run ${runId}`, e);
  }
  try {
    await deleteLocalUploadPrefix(prefix);
  } catch (e) {
    functions.logger.warn(`deleteRunPhotos: local delete failed for run ${runId}`, e);
  }
}

// Remove uploaded objects for many runs (sequential keeps memory + API load low).
export async function deleteRunsPhotos(runIds: string[]): Promise<void> {
  for (const id of runIds) await deleteRunPhotos(id);
}

/**
 * Copy every creator-authored media object from one game's prefix to another's, and
 * report the old→new OBJECT PATH mapping (change: task-media-durability).
 *
 * Media objects are keyed on the owning game id — `gameMedia/{ownerUid}/games/{gameId}/…`
 * — but `duplicateGame` copied the game DOCUMENT verbatim, so the copy's tasks kept
 * pointing into the SOURCE game's folder. It rendered until the source was purged, at
 * which point `deleteGameMedia` prefix-deleted that folder and every picture in the
 * "duplicate" broke. Copying the bytes is what makes the two games independent.
 *
 * Best-effort like its sibling: an object that fails to copy is logged and simply left
 * out of the mapping, so its url keeps addressing the source object. Degraded but
 * working always beats a url pointing at nothing.
 *
 * Prefixes go through `gameMediaPrefix`, so a blank/slash-bearing id throws instead of
 * widening into "copy the creator's entire media tree".
 */
export async function copyGameMedia(
  srcOwnerUid: string,
  srcGameId: string,
  destOwnerUid: string,
  destGameId: string,
  // Restrict to the objects the caller actually references. The `draft` prefix is shared
  // by every game a creator has started, so migrating one game's draft media must not
  // sweep another's in with it.
  only?: (objectName: string) => boolean,
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  let srcPrefix: string;
  let destPrefix: string;
  try {
    srcPrefix = gameMediaPrefix(srcOwnerUid, srcGameId);
    destPrefix = gameMediaPrefix(destOwnerUid, destGameId);
  } catch (e) {
    functions.logger.warn('copyGameMedia: invalid prefix', { srcGameId, destGameId, e });
    return mapping;
  }
  if (srcPrefix === destPrefix) return mapping;

  try {
    const [files] = await storage.bucket().getFiles({ prefix: srcPrefix });
    for (const file of files) {
      if (only && !only(file.name)) continue;
      const destName = destPrefix + file.name.slice(srcPrefix.length);
      try {
        await file.copy(destName);
        mapping.set(file.name, destName);
      } catch (e) {
        functions.logger.warn(`copyGameMedia: bucket copy failed for ${file.name}`, e);
      }
    }
  } catch (e) {
    functions.logger.warn(`copyGameMedia: bucket list failed for ${srcPrefix}`, e);
  }

  // VPS disk mirror. There is no Storage bucket in production, so in practice this is
  // the branch that runs; the bucket branch above simply no-ops with an empty listing.
  if (UPLOAD_DIR) {
    try {
      const srcDir = safeUploadPath(srcPrefix);
      const destDir = safeUploadPath(destPrefix);
      if (srcDir && destDir && fs.existsSync(srcDir)) {
        const names = (await fs.promises.readdir(srcDir))
          .filter((name) => !only || only(srcPrefix + name));
        if (names.length > 0) await fs.promises.mkdir(destDir, { recursive: true });
        for (const name of names) {
          await fs.promises.cp(path.join(srcDir, name), path.join(destDir, name), { recursive: true });
          mapping.set(srcPrefix + name, destPrefix + name);
        }
      }
    } catch (e) {
      functions.logger.warn(`copyGameMedia: local copy failed for ${srcPrefix}`, e);
    }
  }
  return mapping;
}

// Remove creator-authored task media (change: task-media-attachments). Uploads
// live under `gameMedia/{ownerUid}/games/{gameId}/…`; omit gameId to purge the
// creator's entire media tree (account deletion / right to erasure).
export async function deleteGameMedia(ownerUid: string, gameId?: string): Promise<void> {
  let prefix: string;
  try {
    prefix = gameMediaPrefix(ownerUid, gameId ?? undefined);
  } catch (e) {
    functions.logger.warn(`deleteGameMedia: invalid prefix for ${ownerUid}/${gameId ?? '*'}`, e);
    return;
  }
  try {
    await storage.bucket().deleteFiles({ prefix });
  } catch (e) {
    functions.logger.warn(`deleteGameMedia: bucket delete failed for ${ownerUid}/${gameId ?? '*'}`, e);
  }
  try {
    await deleteLocalUploadPrefix(prefix);
  } catch (e) {
    functions.logger.warn(`deleteGameMedia: local delete failed for ${ownerUid}/${gameId ?? '*'}`, e);
  }
}

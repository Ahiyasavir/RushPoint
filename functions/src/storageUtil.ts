// Storage cleanup helpers shared by deletion + retention paths.
//
// Uploaded participant photos live under `runs/{runId}/teams/{teamId}/…`.
// Deleting a run, a game, or an account must also remove those objects, or they
// orphan in the bucket forever (cost + a "right to erasure" gap). All helpers
// are best-effort: a failure is logged but never aborts the surrounding delete.

import * as functions from 'firebase-functions';
import { storage } from './firebase';
// Prefixes come from pure, unit-tested derivation (change: storage-rules-hardening).
// They are built INSIDE the try so a refused (blank / slash-bearing) id is logged
// and skipped instead of issuing a widened `deleteFiles` — a `runs/` prefix would
// erase every run's photos in the bucket.
import { runPhotoPrefix, gameMediaPrefix } from './storagePaths';

// Remove every uploaded object for one run.
export async function deleteRunPhotos(runId: string): Promise<void> {
  try {
    await storage.bucket().deleteFiles({ prefix: runPhotoPrefix(runId) });
  } catch (e) {
    functions.logger.warn(`deleteRunPhotos: failed for run ${runId}`, e);
  }
}

// Remove uploaded objects for many runs (sequential keeps memory + API load low).
export async function deleteRunsPhotos(runIds: string[]): Promise<void> {
  for (const id of runIds) await deleteRunPhotos(id);
}

// Remove creator-authored task media (change: task-media-attachments). Uploads
// live under `gameMedia/{ownerUid}/games/{gameId}/…`; omit gameId to purge the
// creator's entire media tree (account deletion / right to erasure).
export async function deleteGameMedia(ownerUid: string, gameId?: string): Promise<void> {
  try {
    // `gameId ?? undefined` keeps the whole-tree form EXPLICIT: an accidental
    // empty-string gameId is refused rather than silently purging every game.
    const prefix = gameMediaPrefix(ownerUid, gameId ?? undefined);
    await storage.bucket().deleteFiles({ prefix });
  } catch (e) {
    functions.logger.warn(`deleteGameMedia: failed for ${ownerUid}/${gameId ?? '*'}`, e);
  }
}

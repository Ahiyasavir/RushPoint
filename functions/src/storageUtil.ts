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

async function deleteLocalUploadPrefix(prefix: string): Promise<void> {
  if (!UPLOAD_DIR) return;
  const target = path.resolve(UPLOAD_DIR, prefix);
  const root = path.resolve(UPLOAD_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) {
    functions.logger.warn('deleteLocalUploadPrefix: refused path escape', { prefix });
    return;
  }
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

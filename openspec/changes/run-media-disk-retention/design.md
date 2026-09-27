# Design: run-media-disk-retention

## D1: one helper, two stores

`storageUtil.ts` gains `deleteRunUploads(runId): Promise<{ bucket: boolean; disk: boolean }>`:
bucket delete (best effort, false on throw), then the disk prefix when `UPLOAD_DIR` is set (false on
throw, true when unset because there is nothing to delete there). `deleteRunPhotos` becomes a thin
wrapper so the two existing callers are unchanged. The prefix still comes from `runPhotoPrefix`, so a
blank id still throws before any delete and can never widen to `runs/`.

## D2: pruneRunPII uses it

`storagePurged = r.bucket || (r.disk && UPLOAD_DIR set)`. On the VPS the bucket leg fails (no
bucket) and the disk leg succeeds, so the stamp is truthful.

## Test strategy

- Vitest `functions/src/storageUtil.test.ts`: with `UPLOAD_DIR` pointed at a temp dir, files under
  `runs/r1/teams/x/` are gone after `deleteRunUploads('r1')`, `runs/r2/` is untouched, and a blank id
  deletes nothing.
- Source guard in the same file: `pruneRunPII` calls `deleteRunUploads`, never a bare bucket
  `deleteFiles` on the run prefix (the exact regression).

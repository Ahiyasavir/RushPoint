# Proposal: run-media-disk-retention

## Why

Found while verifying `media-upload-reliability` (design D8). The Privacy Policy promises that
uploaded photos are "auto-deleted 90 days after run completion". The retention core
(`pruneRunPII`, `functions/src/maintenance/index.ts`) deletes a run's uploads ONLY through
`storage.bucket().deleteFiles`. Production has no Firebase Storage bucket: every participant photo,
audio clip and video lives on the VPS disk under `UPLOAD_DIR/runs/{runId}`. On the VPS the bucket
call throws, the sweep logs a warning, stamps the run `piiPrunedAt` and never returns to it, so the
media stays on disk forever while the run reads as cleaned.

The disk helper already exists (`deleteRunPhotos` in `functions/src/storageUtil.ts` removes the
bucket prefix AND the disk prefix) and is used by game purge and account deletion. The retention
path simply never adopted it. The GPS track got its disk deletion in `vps-track-storage`; the
media did not.

## What changes

- `pruneRunPII` removes the run's uploads from BOTH stores through the shared helper, and
  `storagePurged` reports true when either store was cleared without error.
- The helper reports what it did, so the result is honest.

## Out of scope

- A backfill for runs already stamped `piiPrunedAt` whose media survived on disk: a one-off operator
  step recorded in tasks (list `/data/uploads/runs/*` whose run is pruned, delete), not code.

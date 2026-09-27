# Tasks: run-media-disk-retention

## 1. RED
- [x] 1.1 `functions/src/storageUtil.test.ts`: disk deletion scoped to the run, blank id refused, and
      the `pruneRunPII` source guard. Confirm RED.

## 2. GREEN
- [x] 2.1 `deleteRunUploads` in `storageUtil.ts`; `deleteRunPhotos` wraps it.
- [x] 2.2 `pruneRunPII` uses it; `storagePurged` reflects either store.

## 3. Verify and ship
- [ ] 3.1 `npm run verify`, `npm run e2e` (exit codes to a file).
- [ ] 3.2 After the VPS rebuild: list run folders under `/data/uploads/runs` whose run is already
      `piiPrunedAt` and delete them once (operator step, read the list before deleting).

## Progress notes (2026-09-26)

- RED observed: 4 failures (`deleteRunUploads is not a function`, and the guard found the bare
  bucket call). GREEN: `functions/src/storageUtil.test.ts` 4/4, run with no bucket configured,
  which is exactly the VPS.

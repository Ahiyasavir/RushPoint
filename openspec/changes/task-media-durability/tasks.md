# Tasks — task-media-durability

TDD: every logic task starts RED. Run `npm test` after each RED step and confirm the new
assertion actually fails before writing the implementation.

## 1. Durability of stored media (the data-loss fix)

- [x] 1.1 RED — `scripts/test-task-media-durability.ts`: a stored `image` URL that the
      CURRENT accept-set rejects must survive `normalizeTaskMediaDetailed(..., keepUrls)`.
- [x] 1.2 RED — a URL NOT in `keepUrls` that fails the accept-set must be reported in
      `rejected`, not silently absent.
- [x] 1.3 GREEN — add `normalizeTaskMediaDetailed(input, opts, keepUrls?)` to
      `packages/shared/src/validation.ts`; `normalizeTaskMedia` delegates to it unchanged.
- [x] 1.4 GREEN — `normalizeStagesMedia(stages, storedStages)` in
      `functions/src/games/index.ts` builds `keepUrls` per task id from the stored doc,
      throws `invalid-argument` naming any rejected NEW url, and `logger.warn`s each
      retained-but-drifted url with gameId/taskId.
- [x] 1.5 GREEN — `updateGame` passes the stored stages; `createGame` passes none (nothing
      is stored yet, so every url is new and must pass).
- [x] 1.6 REFACTOR — confirm `importGameFile` uses the same door and behaves identically.

## 2. Origin accept-set robustness

- [x] 2.1 RED — canonical origin accepted with `VPS_UPLOAD_ORIGIN` unset; `http://` known
      host accepted; `https://evil.example/uploads/x.jpg` refused in every mode.
- [x] 2.2 GREEN — `RUSHPOINT_UPLOAD_ORIGINS` in `validation.ts`; `StorageOriginOptions`
      takes `vpsOrigins: string[]`; `extractStorageObjectPath` checks them all plus the
      `http://` form of a known host.
- [x] 2.3 GREEN — `storageOriginOpts()` unions the constant with the env var.
- [x] 2.4 GREEN — `functions/server.js`: prefer env → canonical → request-derived, and read
      `x-forwarded-proto` so the fallback can't mint `http://` behind the proxy.

## 3. Re-host media on duplicate / translate / first save

- [x] 3.1 RED — `rewriteStagesMedia(stages, mapping)`: image/video urls rewritten, youtube
      untouched, an unmapped url left alone, a task with no media untouched.
- [x] 3.2 GREEN — `rewriteStagesMedia` in `packages/shared/src/validation.ts`.
- [x] 3.3 GREEN — `copyGameMedia()` in `functions/src/storageUtil.ts` (bucket + VPS disk,
      best-effort, prefixes via `gameMediaPrefix`), returning the old→new url mapping.
- [x] 3.4 GREEN — `duplicateGame` copies then rewrites before `newRef.set(copy)`.
- [x] 3.5 GREEN — `translateGame` does the same.
- [x] 3.6 GREEN — `createGame` migrates `…/games/draft/…` objects onto the real gameId.

## 4. Builder: media beside the description

- [x] 4.1 RED — `scripts/test-task-opt-in-groups.ts`: `OPT_IN_GROUP_KEYS` no longer contains
      `'media'`.
- [x] 4.2 GREEN — remove `'media'` from `OPT_IN_GROUP_KEYS` and its arms in
      `groupHasContent` / `groupSummary` / `clearGroupPatch`.
- [x] 4.3 GREEN — render `MediaSection` in `DetailsStepBody` under the description field,
      un-gated; drop the `OptInGroup` wrapper from `ExecutionStepBody`.
- [x] 4.4 GREEN — `onPickFile` commits off a latest-task ref, not the render closure.
- [x] 4.5 GREEN — validate the uploaded url with `isTaskMediaValid` client-side and show
      `b.mediaUploadError` when it fails.
- [x] 4.6 GATE — `npm run i18n:check:strict` clean, zero new PART B warnings.

## 5. Operator diagnose / repair

- [x] 5.1 RED — `scripts/test-task-media-repair.ts` for the pure planning helper: given a
      task's media and the object names on disk, decide which files are orphans and which
      task each belongs to (`{taskId}-{ts}.{ext}`).
- [x] 5.2 GREEN — `scripts/lib/taskMediaRepair.mjs` with that pure logic.
- [x] 5.3 GREEN — `scripts/diagnose-task-media.mjs`, DRY-RUN by default, `--execute
      --confirm-project=<id>` to re-attach.

## 6. Gates

- [x] 6.1 `npm test`
- [x] 6.2 `npm run verify`
- [ ] 6.3 `npm run e2e` with the extended media scenario
- [ ] 6.4 `npm run verify:emulator` (sequential, to a log file, exit code checked)

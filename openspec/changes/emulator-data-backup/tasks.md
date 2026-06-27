## 1. RED — failing pure-logic tests

- [ ] 1.1 Create `scripts/test-emulator-backup.ts` asserting `isSnapshotDue(lastTs, nowTs, intervalMs)`: returns false when `now - last < interval`, true at/after the interval, and true when `lastTs` is null. Import from the not-yet-existing `scripts/lib/emulatorBackup.mjs`.
- [ ] 1.2 Add assertions for `snapshotName(nowTs)`: deterministic for a fixed input, and lexicographically sortable in chronological order for increasing timestamps.
- [ ] 1.3 Add assertions for `selectSnapshotsToPrune(names, keepN)`: returns the oldest `len - keepN` when over the limit, `[]` when at/under the limit, and `[]` when `keepN >= count`.
- [ ] 1.4 Add assertions for `selectRestoreTarget(entries)` (entries = `{name, valid}[]`): newest valid entry; skips a newest-but-invalid in favor of an older valid one; returns null on empty / all-invalid.
- [ ] 1.5 Run `npm test` and confirm the new script FAILS for the right reason (module/exports missing), not a typo.

## 2. GREEN — implement pure helpers

- [ ] 2.1 Create `scripts/lib/emulatorBackup.mjs` exporting `isSnapshotDue`, `snapshotName`, `selectSnapshotsToPrune`, `selectRestoreTarget` as pure functions (no `Date.now()`, FS, or spawn inside — time and listings are passed in).
- [ ] 2.2 Run `npm test`; confirm `scripts/test-emulator-backup.ts` now passes.

## 3. REFACTOR — tidy helpers

- [ ] 3.1 Tidy `emulatorBackup.mjs` (shared sort/validity helper, clear names, brief doc comments) keeping the test green; ensure validity check matches dev-emulator's `firebase-export-metadata.json` import gate.

## 4. Runner + wiring (impure I/O)

- [ ] 4.1 Create `scripts/emulator-backup.mjs`: a `setInterval` loop that, when `isSnapshotDue`, runs `firebase emulators:export "<.firebase/backups/<snapshotName>>" --force`, then prunes folders from `selectSnapshotsToPrune`, logging each snapshot path. Read interval/`keepN` from env with documented defaults (2 min / keep 10).
- [ ] 4.2 Start the backup loop from `scripts/dev-emulator.mjs` after the emulator spawns and stop/forward-signal it on exit, gated behind `RUSHPOINT_BACKUP` (reuse the existing quoting + `shell: true` spawn pattern; never write into `DATA_DIR`).
- [ ] 4.3 Add an `emulator:restore` npm script + `scripts/emulator-restore.mjs` that runs `selectRestoreTarget` over `.firebase/backups/`, copies the chosen snapshot into `.firebase/emulator-data` (so `--import` picks it up), prints what it restored, and exits non-zero if none found.

## 5. Docs

- [ ] 5.1 Document the `RUSHPOINT_BACKUP` flag, the rotating-snapshot behavior, and the restore procedure in DEPLOY.md (and the playtest notes), including the crash-recovery steps.

## 6. Manual verification (impure path)

- [ ] 6.1 Boot the stack with `RUSHPOINT_BACKUP=1`, confirm timestamped folders appear under `.firebase/backups/` on each interval and that rotation keeps only the newest N.
- [ ] 6.2 Simulate a crash (`kill -9` / hard-stop the emulator process), run `npm run emulator:restore`, reboot the emulator, and confirm the seeded/played data is present.

## 7. Gates

- [ ] 7.1 Run all gates green: `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run e2e`.

## 1. Shared rules — RED then GREEN (pure)
- [x] 1.1 RED: `scripts/test-trackable.ts` — `canPickUp` (only when unheld), `canDrop` (only
  the holder). Confirm fail.
- [x] 1.2 GREEN: `packages/shared/src/trackable.ts` (`Trackable`, `TrackableLogEntry`,
  `canPickUp`, `canDrop`); export from shared. `npm test` → 6 pass.

## 2. functions
- [x] 2.1 `createTrackable` (owner) writes `…/runs/{runId}/trackables/{id}`.
- [x] 2.2 `pickUpTrackable` / `dropTrackable` (controller-gated via `resolveCallerTeam`) —
  transactional holder transfer guarded by `canPickUp`/`canDrop`; appends to an append-only
  `…/trackables/{id}/log`.
- [x] 2.3 `getRunTrackables` (participant or owner via `resolveTeamContext`). Re-export all four.

## 3. rules + retention
- [x] 3.1 `trackables/{id}` (+ nested `/log`) — read if authenticated, write:false (CF-only).
- [x] 3.2 `pruneRunPII` deletes trackable log entries (they name teams = PII).

## 4. UI
- [x] 4.1 play-web `TrackablesPanel` in PlayScreen (controller can pick up / drop; holder
  status shown); calls.ts wrappers; `trackables.*` i18n EN + HE.
- [x] 4.2 creator-web `TrackablesConsole` in RunConsole (author + see holders); calls.ts
  wrappers; `runConsole.trackables*` i18n EN + HE.

## 5. Tests / gates
- [x] 5.1 e2e: owner creates → A picks up (becomes holder) → B can't pick up/drop → A drops
  (released). Covers all four callables (coverage guard).
- [x] 5.2 typecheck · i18n:check · no-dashes · lint · builds — green.
- [ ] 5.3 consolidated verify:emulator — in progress.

## Notes
- Within-run only (v1). Cross-run/QR-portable trackables + player-owned history are deferred
  (they need the player-identity work). No task-proximity gate on pickup in v1 (any task).

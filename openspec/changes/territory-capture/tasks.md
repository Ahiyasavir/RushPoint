## 1. Shared helpers — RED then GREEN (pure)
- [x] 1.1 RED: `scripts/test-capture-zone.ts` — `isWithinZone` (inside/outside/NaN),
  `canCapture` (unowned / flip rival / not own). Confirm fail.
- [x] 1.2 GREEN: `packages/shared/src/captureZone.ts` (`CaptureZone`, `isWithinZone`,
  `canCapture`); export from shared. `npm test` → 7 pass.

## 2. functions
- [x] 2.1 `createZone` / `deleteZone` (owner) manage `…/runs/{runId}/zones/{id}`.
- [x] 2.2 `getRunZones` (participant/owner) for live map + list.
- [x] 2.3 `captureZone` (controller) — re-validates GPS proximity server-side, guards with
  `canCapture`, and **awards the capture bonus immediately** in the same transaction via
  `team.bonusPenalty` (a bonus = negative penalty). This keeps live (refreshLeaderboard) and
  final (finalizeRun) standings identical — NO change to `buildRankings`. Re-export all four.

## 3. rules + retention
- [x] 3.1 `zones/{id}` — read if authenticated (ownership renders live), write:false (CF-only).
- [x] 3.2 `pruneRunPII` deletes zones (they carry the owning team's display name).

## 4. UI
- [x] 4.1 play-web `ZonesPanel` in PlayScreen — list zones + a controller "Capture" button
  using the phone's GPS; `zones.*` i18n EN + HE.
- [x] 4.2 creator-web `ZonesConsole` in RunConsole — author zones (title + lat/lng) + see
  holders + delete; `runConsole.zones*` i18n EN + HE.

## 5. Tests / gates
- [x] 5.1 e2e: create zone → A captures inside (owner + bonus applied as −bonusPenalty) → A
  can't re-capture → out-of-radius rejected → B flips ownership. (Coverage guard.)
- [x] 5.2 typecheck · i18n · no-dashes · lint · builds — green.
- [ ] 5.3 consolidated verify:emulator (e2e + rules + **leaderboard-invariant/parity oracle** +
  sims) — final run pending.

## Notes
- v1 = flat capture/flip bonus at capture time (parity-safe). "Points per minute held" needs a
  scheduler — deferred. Zone authoring uses lat/lng inputs (map-pick center is a follow-up).

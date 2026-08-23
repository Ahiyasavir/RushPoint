## 1. RED — failing tests first

- [x] 1.1 Extend `scripts/test-stuck-player-guards.ts` with a `blockedGuidance` section in the same
      house style (`check(label, cond, detail)`), importing `blockedGuidance` and
      `BLOCKED_HELP_KEY` from `../apps/play-web/src/lib/stuckGuards`.
- [x] 1.2 Encode the reason → kind fixtures from the design's Test Strategy: every value of
      `SafeZoneReason` plus `unverifiable`, and the missing / `null` / empty / unknown / non-string
      cases mapping to `unknown`.
- [x] 1.3 Encode the distance fixtures: rounding, and `null` for every untrusted or non-finite
      input, and for every kind other than `outside`.
- [x] 1.4 Encode the invariants asserted over EVERY fixture: `offerHelp`, `offerRecheck`,
      `blameless === (kind !== 'outside')`, and `metersBack === null` off the `outside` kind.
- [x] 1.5 Include the new section in the existing `Date.now` stub sweep (epoch, ±6 h).
- [x] 1.6 Add the wiring guards over `TaskRunner.tsx` source: `blockedGuidance(` is called, the card
      references `BLOCKED_HELP_KEY`, `requestHelp` takes an id parameter instead of latching
      `task!.id`, and the geofence escape hatch no longer requires `dist != null`.
- [x] 1.7 Run `npx tsx scripts/test-stuck-player-guards.ts` and confirm it FAILS for the right
      reason. Record the failure verbatim.

## 2. GREEN — the pure decision

- [x] 2.1 Add `blockedGuidance`, `BlockedGuidance`, `BlockedKind` and `BLOCKED_HELP_KEY` to
      `apps/play-web/src/lib/stuckGuards.ts` per D1/D2/D3/D4. No React, no storage, no `Date.now`.
- [x] 2.2 Re-run the script; the pure section goes GREEN and only the wiring guards remain red.

## 3. GREEN — server distance + client wiring

- [x] 3.1 `functions/src/runs/index.ts`: `evaluateTeamOutOfBounds` also returns
      `metersOutside: number | null` (D6), and `requestNextTask` includes it in the out-of-bounds
      response. Abnormal path only; additive.
- [x] 3.2 `apps/play-web/src/services/calls.ts`: widen the `requestNextTask` result type with
      `outOfBounds?: boolean` and `metersOutside?: number | null`, and admit the safe-zone reason
      values alongside `NoAssignmentReason`.
- [x] 3.3 `TaskRunner.tsx`: capture `{ reason, metersOutside }` from an `outOfBounds` routing
      response into local state, and render the out-of-bounds card from `blockedGuidance()` — kind
      specific title/body, the distance line for `outside` only, "staff can release you", the host
      help affordance (`BLOCKED_HELP_KEY`) and the "check again" button that re-fires
      `requestNextTask`.
- [x] 3.4 `TaskRunner.tsx`: `requestHelp(forId: string)` latches the id it is given; the geofence
      call site passes `task.id`, the blocked card passes `BLOCKED_HELP_KEY`.
- [x] 3.5 `TaskRunner.tsx`: `GeofenceAuto`'s escape hatch fires when stuck and NOT known to be
      inside (D7).
- [x] 3.6 Add the new keys to BOTH dictionaries in `apps/play-web/src/i18n.ts` (Hebrew in Hebrew,
      English in English, no dashes of any kind). Re-read the file immediately before editing — a
      parallel lane also edits it.
- [x] 3.7 Re-run `npx tsx scripts/test-stuck-player-guards.ts` and confirm fully GREEN.

## 4. REFACTOR + gates

- [x] 4.1 Re-read the changed regions of `TaskRunner.tsx` and `i18n.ts` for concurrent edits; keep
      the additions minimal and revert nothing.
- [x] 4.2 `npm run typecheck` — green.
- [x] 4.3 `npm run lint` — 0 errors.
- [x] 4.4 `npm test` — green.
- [x] 4.5 `npm run play:build` — green.
- [x] 4.6 `npm run bundle:budget` — green.
- [x] 4.7 `npm run i18n:check:strict` — PART A clean, zero NEW PART B warnings.
- [x] 4.8 Record verbatim gate output and flag what stays unverified (no browser run: on-device
      rendering of the four cards under a real safe-zone breach, and the emulator-bound gates, which
      a live playtest stack owns).

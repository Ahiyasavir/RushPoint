# Shared Team Devices — tasks (RED → GREEN → REFACTOR)

## 1. Pure device/role logic (vitest lane)

- [x] 1.1 RED: create `functions/src/runs/teamDevices.test.ts` covering `resolveDeviceRole`
      (controller / viewer / legacy doc without `controllerUid` → founding uid is controller /
      unattached uid → null), `assertController` (passes controller + legacy founding uid; throws
      `permission-denied` for viewer and stranger), `generateDeviceJoinCode` (length 6, unambiguous
      alphabet, deterministic with injected rng), `canAttachDevice` (rejects duplicate uid, 8-device
      cap, finished team; accepts fresh uid + backfills legacy doc shape). Run `npm test` in
      functions/ — confirm it FAILS (module missing).
- [x] 1.2 GREEN: implement `functions/src/runs/teamDevices.ts` (pure — no Firestore imports in the
      tested helpers) until 1.1 passes.
- [x] 1.3 REFACTOR: extend `packages/shared/src/types/index.ts` `RunTeam` with `deviceUids?`,
      `controllerUid?`, `deviceJoinCode?`, `devices?: TeamDevice[]` (+ `TeamDevice` type); make
      teamDevices.ts consume the shared types; `npm run typecheck` green.

## 2. Callable behavior (e2e lane)

- [x] 2.1 RED: extend `scripts/e2e-verify.mjs` with a `device2` party and failing assertions:
      wrong `teamCode` → not-found; `joinTeamAsDevice` happy path returns the team's ids +
      `deviceUids` contains both uids; `getMyTeamState` from device2 → same team, `myRole` viewer,
      includes `controllerUid`/`deviceJoinCode`/`devices`; mutating call from device2 →
      `permission-denied`; `transferController` → device2 submits OK and device1 now rejected;
      `claimController` from device1 → control returns; stranger `claimController` →
      `permission-denied`. Run `npm run e2e` — confirm the new block FAILS (callables missing).
- [x] 2.2 GREEN: implement in `functions/src/runs/index.ts`: `joinRun` stamps
      `deviceUids/[uid]`, `controllerUid`, `devices`, `deviceJoinCode`;
      `resolveTeamRefForCaller(uid, ctx)` (direct-doc fast path, else `array-contains` query);
      new callables `joinTeamAsDevice`, `transferController`, `claimController` (transactions,
      rate-limited, validated); wire `assertController` into `completeTask`, `requestNextTask`,
      `requestTaskHint`, `submitTaskAnswer`, `submitSequenceStep`, `checkOutTask`;
      `getMyTeamState` resolves via helper and returns `controllerUid`, `devices`,
      `deviceJoinCode`, `myRole`.
- [x] 2.3 GREEN: switch `functions/src/index.ts` station callables (`verifyStationCode`,
      `submitStationPhoto`) + `updateLocation` to resolve-and-assert-controller, and `triggerSOS`
      to resolve-only (any attached device); keep the payload-teamId mismatch guard against the
      resolved id. Re-export the 3 new callables from `functions/src/index.ts`.
- [x] 2.4 GREEN: `firestore.rules` — team read for attached uids
      (`'deviceUids' in resource.data && request.auth.uid in resource.data.deviceUids`), writes
      still denied. Run `npm run e2e` — entire suite green, including the new block.
- [x] 2.5 REFACTOR: dedupe the old `teamId = uid` derivations through the helper; confirm no
      callable trusts payload teamId; `npm test` + `npm run e2e` still green.

## 3. play-web UI

- [x] 3.1 Typed wrappers in `apps/play-web/src/services/calls.ts` (`joinTeamAsDevice`,
      `transferController`, `claimController`; extend `MyTeamState`); add `teamId` to `Session`
      in `store.ts` (backfill: existing sessions without it fall back to uid).
- [x] 3.2 JoinScreen: team-mode toggle "create team / join my team's phone", device-code form →
      `joinTeamAsDevice` → save session with returned `teamId`; all strings via `t.*` (HE+EN).
- [x] 3.3 PlayScreen: subscribe/state-fetch by `session.teamId`; derive `isController` live from
      the team doc; add `TeamDevicesPanel` (device join code + copy, devices list, controller
      badge, controller-only transfer buttons, viewer confirm-gated take-control) and a viewer
      banner naming the controller.
- [x] 3.4 TaskRunner: `readOnly` prop disables all inputs/submits; map the `not-controller`
      rejection to a localized "control moved to another phone" toast on every submit path.
- [x] 3.5 Verify with preview tools on :5181 (two anonymous contexts: create → attach → live sync
      → viewer blocked → transfer → takeover) and run `npm run i18n:check` +
      `npm run i18n:check:strict` — zero PART A errors, zero NEW PART B findings.

## 4. Gates

- [x] 4.1 Full gate set green: `npm run typecheck` · `npm run lint` · `npm test` ·
      `npm run creator:build` · `npm run play:build` · `npm run e2e` · `npm run i18n:check`.

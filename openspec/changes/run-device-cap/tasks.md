## 1. Pure logic — RED then GREEN

- [x] 1.1 (RED) In `functions/src/runs/teamDevices.test.ts`, add failing tests for a not-yet-existing `canAddRunDevice` + `MAX_RUN_DEVICES`: count 0 and 15 → `{ ok: true }`; count 16 (and 17) → `{ ok: false, reason: 'run-full' }`; assert `MAX_RUN_DEVICES === 16`. Run `npx vitest run functions/src/runs/teamDevices.test.ts` and confirm it FAILS to compile/pass. — RED confirmed (3 failing).
- [x] 1.2 (GREEN) In `functions/src/runs/teamDevices.ts`, add `export const MAX_RUN_DEVICES = 16;` and `export function canAddRunDevice(currentDeviceCount: number): { ok: true } | { ok: false; reason: 'run-full' }`. Re-run the vitest file — all green (20/20).

## 2. Shared type

- [x] 2.1 Add `deviceCount?: number;` to the `Run` interface in `packages/shared/src/types/index.ts` (comment: monotonic total phones across all teams; falls back to participantCount on legacy runs). Run `npm run shared:build`.

## 3. Enforcement — joinRun

- [x] 3.1 In `functions/src/runs/index.ts` `joinRun`, inside the existing run transaction, compute `usedDevices = r.deviceCount ?? r.participantCount ?? 0`; if `!canAddRunDevice(usedDevices).ok`, throw `HttpsError('resource-exhausted', <run-full msg>, { cap: MAX_RUN_DEVICES, used: usedDevices })` BEFORE writing the team. On success, also set `deviceCount: usedDevices + 1` in the same `t.update(runRef, …)` that bumps `participantCount`.
- [x] 3.2 Import `MAX_RUN_DEVICES` / `canAddRunDevice` where `MAX_TEAM_DEVICES` is already imported.

## 4. Enforcement — joinTeamAsDevice

- [x] 4.1 In `functions/src/runs/index.ts` `joinTeamAsDevice`, within the same transaction that attaches the device, read the run doc, compute `usedDevices = run.deviceCount ?? run.participantCount ?? 0`, and reject with the same `resource-exhausted` error when `!canAddRunDevice(usedDevices).ok` — evaluated together with the existing `canAttachDevice` per-team check.
- [x] 4.2 On a successful attach, increment `run.deviceCount` by one in the same transaction.

## 5. Callable behavior — e2e (RED then GREEN)

- [x] 5.1 (RED) In `scripts/e2e-verify.mjs`, add a scenario that launches a run, joins phones up to `MAX_RUN_DEVICES` (mixing `joinRun` teams and `joinTeamAsDevice` attaches), asserts each is admitted, then asserts the 17th phone is rejected with `resource-exhausted`. (Scenario added; asserts deviceCount growth on both paths + rejection on both paths.)
- [x] 5.2 (GREEN) Run `npm run e2e` (via the emulator) and confirm the new scenario passes and the callable-coverage guard stays green. — device-cap scenario: 7 checks, 0 failed; suite ✅ ALL PASS incl. coverage guard.

## 6. Single knob + creator warning (added scope)

- [x] 6a.1 Move `MAX_RUN_DEVICES` + `canAddRunDevice` into `@rushpoint/shared` (`runCapacity.ts`) as the single source of truth; add `isRunDeviceCapActive()` (false when `Infinity`); export from the shared index. Re-export from `functions/src/runs/teamDevices.ts` so existing call sites + tests are unchanged.
- [x] 6a.2 In `apps/creator-web` `RunConsolePage` `JoinShare`, show a bilingual warning (`t.runConsole.deviceCapNote({ max })`) reading `MAX_RUN_DEVICES` from shared, gated by `isRunDeviceCapActive()`. Add HE + EN dictionary entries. Run `npm run i18n:check` (must pass PART A + B).

## 7. Gates

- [x] 7.1 `npm run typecheck` — all workspaces green (5/5).
- [x] 7.2 `npm test` — functions vitest green (teamDevices 20/20).
- [x] 7.3 `npm run creator:build` green; `npm run i18n:check` PART A + B green.
- [x] 7.4 `npm run e2e` — full lifecycle + the new cap scenario green on the REFACTORED build (device-cap 7/7, ✅ ALL PASS, coverage guard green; clean run after freeing an orphaned-emulator port).
- [x] 7.5 `openspec validate run-device-cap --strict` — green.

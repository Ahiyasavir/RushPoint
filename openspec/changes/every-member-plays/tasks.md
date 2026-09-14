## 1. Establish the constraints from the code

- [x] 1.1 Confirmed the device model makes a teammate a SPECTATOR by design: every
  mutating participant callable passes `{ requireController: true }` and
  `assertController` rejects any other device with `not-controller`. The reported
  behaviour is the architecture working as specified, not a defect.
- [x] 1.2 Confirmed `MAX_TEAM_DEVICES = 3` and that `canAttachDevice` refuses the fourth
  with `'full'` — so "every participant on their own device" is **unsatisfiable** for any
  team larger than three, before anyone tries.
- [x] 1.3 Confirmed `RunTeam` already carries `memberCount` AND `deviceUids`, and that
  nothing in the product compares them.
- [x] 1.4 Confirmed the read-cost shape: every attached phone polls `getMyTeamState` on
  its own timer (`PlayScreen`: a 60s refresh and a 3s in-flight poll), so the device
  ceiling multiplies the most-called participant read. This is what decides D1/D2.

## 2. The participation arithmetic — RED

- [x] 2.1 `scripts/test-team-participation.ts`: `teamAttendance` on a team of six with one
  device reports five missing. Run; confirm RED because the module does not exist.
- [x] 2.2 A full team reports no gap; MORE devices than declared is not a shortfall and
  not an error; a legacy doc with no `deviceUids` counts the founding uid.
- [x] 2.3 **An unknown headcount yields `null`, not a number.** `memberCount` is only
  meaningful when the game collects member names, so reporting "5 missing" for a game
  that never asked would be a confident lie. Still RED.
- [x] 2.4 `teamDeviceAllowance`: a team of six may attach six; a small or unknown team
  keeps today's 3; an absurd headcount is bounded by the hard cap; the result is NEVER
  below today's constant, so no team loses capacity.
- [x] 2.5 `effectiveContributorRequirement` / `contributorsSatisfied`: distinct devices
  only; the same device twice counts once; a requirement larger than the team is reduced
  rather than making the mission unwinnable; no requirement means none needed.
- [x] 2.6 Totality on all of it, plus a seeded sweep asserting the allowance is never
  below the current constant and never above the hard cap, and that a satisfied
  requirement is always satisfiable by the devices present.

## 3. The participation arithmetic — GREEN

- [x] 3.1 `packages/shared/src/teamParticipation.ts` + barrel export. Pure, total, no
  React, no Firebase. **83 assertions green.**
- [x] 3.2 Suite green; no other suite regressed.

## 4. The device allowance (shippable half A)

- [x] 4.1 `canAttachDevice` reads `teamDeviceAllowance(team)` instead of the constant.
  `MAX_TEAM_DEVICES` stays exported as the FLOOR, not the ceiling.
- [x] 4.2 `canAddRunDevice` / `MAX_RUN_DEVICES` untouched and still decides last —
  a generous per-team allowance inside a fixed run ceiling reallocates phones, it does
  not create them.
- [x] 4.3 `functions/src/runs/teamDevices.test.ts` rewritten with the reasoning, not
  silently flipped, and EXTENDED rather than merely repaired: a team of six may now
  attach six and is refused the seventh; a small or unknown headcount keeps exactly the
  old allowance. Passing tests alone would not have proved the new behaviour.

## 5. Visibility (shippable half A)

- [x] 5.1 `listRunTeams` projects `membersNotConnected`; added to
  `ALLOWED_RUN_TEAM_ROW_KEYS` with its classification written down — a COUNT, not a
  name, a position or a guardian record.
- [x] 5.2 A `membersOffline` run signal at **info**, not warn: sharing a phone is a
  legitimate way to play, and crying wolf would teach an organizer to ignore the strip.
  It is surfaced because it was INVISIBLE, not because it is wrong. A null shortfall is
  never counted, which is the whole reason it is null rather than zero.
- [x] 5.3 `TeamDevicesPanel` tells the team how many of them are not yet connected,
  beside the code they already see. Rendered only when the shortfall is KNOWN.
- [x] 5.4 Hebrew and English copy.

## 6. The attendance requirement (half B)

- [x] 6.1 `Game.requireAllMembersOnline`, off by default, in `BUILDER_EDITABLE_FIELDS`
  and the `test-game-presentation` fixture — a field missing from that list never saves
  AND never registers as a change.
- [x] 6.2 Held beside the consent hold, reusing `holdNotice.ts`. **The ORDER is
  load-bearing:** consent OUTRANKS the attendance hold, because turning the attendance
  setting off would not release a team held for consent, and telling them it would is a
  dead end. `startTeams` and `getMyTeamState` partition on the same order, so the
  explanation cannot disagree with the behaviour.
- [x] 6.3 Fails OPEN on an unknown headcount: a team is never blocked on a number the
  platform cannot read.
- [x] 6.4 Builder control + copy.

## 7. Contributions (half B)

- [x] 7.1 `Task.requiredContributors` and `RunTeam.taskContributions` on the types.
- [x] 7.2 A NEW callable `contributeToTask` — the ONLY mutation a non-controller device
  may make. It records a uid and nothing else: no scoring, no completion, no routing.
- [x] 7.3 Typed wrapper in `apps/play-web/src/services/calls.ts`.
- [x] 7.4 The gate lives in `completeTask`, the PARTICIPANT's own path — deliberately
  NOT inside `completeTaskForTeam`, which a staff approval, a skip and the auto-approve
  path all reach. The organizer's tools must never be held hostage to a teammate who has
  not tapped yet.
- [x] 7.5 The contribute control is rendered OUTSIDE `TaskRunner`'s action wrapper,
  which is `pointer-events-none` for a non-controller — and a non-controller is exactly
  who the control is for. Inside it, this would have shipped a button nobody could
  press. The controller sees the progress line too: they are the one who gets refused at
  submit time.
- [x] 7.6 Builder control for `requiredContributors` + `BUILDER_EDITABLE_FIELDS`.

## 8. Gates

### Half A — DONE

- [x] 8.1 `npm run verify` — **302/302 pure-logic unit files green**, i18n PART A and
  PART B clean, every build green, lint 0 errors. The only red gate is the pre-existing
  `check-marketing-output` failure on the untracked `_kit-b83f9d2e` kit.
- [x] 8.2 `npm run e2e` — **ALL PASS**, exit 0, 121/121 callables covered. The device
  allowance and the new `membersNotConnected` projection are both server changes, so the
  whole suite had to stay green; the row allowlist guard accepted the new key only after
  it was consciously classified.
- [x] 8.3 `npm run i18n:check:strict` clean. `scripts/test-no-dashes.ts` caught a Hebrew
  maqaf in the new console copy — rephrased rather than exempted.

### Half B — NOT STARTED

- [x] 8.4 `npm run e2e` — **ALL PASS**, exit 0, and the coverage guard now introspects
  **122** callables, all covered. Every contribution assertion passed: a non-controller
  may contribute and still may NOT submit; the controller is refused while the
  requirement is unmet; one device twice counts ONCE and does not unlock it; a distinct
  device satisfies it; the mission then completes and scores once.
  TWO guards fired first and were answered rather than worked around:
  `test-callable-exports` (a comment inside the `export {...} from` list broke its parse)
  and `test-shared-game-view` (a new `Task` field must be PROJECTED or declared withheld
  — projected, with the reason written down).
- [x] 8.5 `scripts/test-game-presentation.ts` green; `npm run verify` **302/302** unit
  files, i18n PART A and PART B clean.

## 9. Ship

- [ ] 9.1 Half A — allowance, arithmetic, visibility. **Code complete and green.**
  Ship first: useful alone and risk-free, because nothing is gated yet.
- [ ] 9.2 Half B — the attendance requirement and the contribution callable. **Code
  complete and green**, both opt-in and off by default.

## 10. Follow-ups filed, not built

- [ ] 10.1 Tying a contribution to the mission's own interaction rather than a generic
  "I did my part" (design Open Question 1).
- [ ] 10.2 Whether the organizer should see WHO contributed, not just how many — a
  question about surveillance of children that deserves a deliberate answer rather than
  a default (design Open Question 2).

## Context (verified 2026-09-28)

- `pushFlashMission` (`functions/src/index.ts`) writes `runs/{runId}/flashMissions/{id}`
  `{ title(He), description(He), bonusPoints, expiresAt, isActive, createdAt, createdBy }`;
  `LiveOps.tsx` lists `isActive == true` ordered by `createdAt`, filters expiry client-side, and
  renders `+bonusPoints` as text. No deactivate callable; `sweepStaleLiveOps` retires expired ones.
- Every submission door (`submitStationPhoto`, `submitTaskAnswer`, …) resolves the task from the
  GAME TEMPLATE (`findGameTask`). CLAUDE.md: run-scoped operational state belongs on the run, never
  the template.
- `adjustTeamScore` + `appendScoreLedger` (`packages/shared/src/scoreLedger.ts`) move `bonusPenalty`
  and record a reason; `buildRankings` reads the stored team doc (parity rule).
- `Task.timeLimitMinutes` countdown is from `RunTaskRecord.startedAt`, checked by
  `assertWithinTimeLimit` and swept on poll.

## Decisions

### D1: a flash mission is its own run-scoped object, not a stage task

Stored where it is today (`flashMissions/{id}`), extended:
`claimMode: 'first' | 'many'`, `doneBy: 'announce' | 'button' | 'photo' | 'video'`,
`requiresApproval: boolean`, `durationMinutes`, `claims: { [teamId]: { at, status:
'claimed' | 'submitted' | 'approved' | 'rejected' | 'released', mediaUrl?, posterUrl?, reviewedAt? } }`,
`endedAt`. Server-written only (rules unchanged: authenticated read).
A dedicated door (`submitFlashMission`) and scoring through the ledger mean no stage record, no
routing and no stage-completion code is touched: the flash mission cannot break those invariants.

### D2: claiming and the suspended mission

`claimFlashMission({ flashId })` — transaction over the flash doc and the team doc:
- refused if ended/expired, if `first` and another team holds an unreleased claim, if the team is
  held/removed, or already has an open flash claim;
- writes the claim and `team.flashSuspension = { flashId, taskId: activeTaskId | null, at }`.
The team's current record stays `assigned` (its station slot stays held: the team is coming back).
While a suspension is open, the phone shows the flash card instead of the mission, and the
mission's time limit is extended: on resume `RunTaskRecord.suspendedMs += now − at`, and
`assertWithinTimeLimit`/the sweep add `suspendedMs` to the deadline. The sweep never expires a
suspended mission. Resume happens on submit (`button`/`photo`/`video`), on `releaseFlashMission`, and
when the flash mission ends.

### D3: points

Approval (automatic when `!requiresApproval`) appends a ledger entry `{ kind: 'flash', flashId,
points }` and adds to the team's score through the same helper `adjustTeamScore` uses; a reversal
removes it. `doneBy: 'announce'` has no claims: the organizer uses **Award to a team**, which is
the same ledger entry. `first` + approval: a rejected claim reopens the mission to other teams.

### D4: organizer control

`deactivateFlashMission({ flashId })` sets `isActive:false, endedAt`, resumes every open
suspension. The console's flash panel lists active + recently ended missions with takers and
actions; its state is `flashMissionState(doc, nowMs)` (pure): open / taken / ended / expired.

### D5: the player moment

On a new active flash id (seen-set, the `newPendingKeys` pattern): full-screen overlay 2.5 s
(title, points, a burst animation in CSS, `playFlash()` cue, `navigator.vibrate?.([80,60,80])`),
then the banner with countdown and "לקחתי" (or "נלקחה על ידי X" / "הצטרפו" for `many`).
`prefers-reduced-motion` ⇒ no burst. Audio: the join button calls `unlockAudio()`; the join screen
shows "🔊 הגבירו את הווליום וכבו את מצב השקט כדי לשמוע הפתעות".

## Test strategy

- **Pure** `scripts/test-flash-missions.ts`: `flashClaimVerdict` (first taken / many / ended /
  expired / double claim / held); `flashMissionState`; suspension extension arithmetic
  (`deadline + suspendedMs`); legacy docs (no claimMode) read as today's announce-only.
- **e2e** scenario "flash missions": push `first`+`photo` ⇒ team A claims, B refused "taken";
  A's current mission time limit extended by the suspension; A submits ⇒ approve ⇒ ledger +
  score, A back on its mission; reject reopens to B; `many` ⇒ both claim; `deactivateFlashMission`
  ends and resumes; `announce` + award. Authz rows for the privileged ones; coverage guard.
- **UI** preview: composer, moment + sound (after a tap), banner countdown, claim/return, console
  live panel. `npm run i18n:check:strict`, `npm run bundle:budget`.

## D6 (overnight 2026-09-29): a claim lives on the TEAM, not on the flash-mission document

**Why.** Every phone listens to the run's active flash missions (`LiveOps`, `where isActive == true`),
and a listener is billed one read per changed document per listener. With the claims in a map on the
flash document, every claim, submission and review rewrote that document, so every phone re-read it:
a "many" flash at 100 teams × ~2 phones = ~200 listeners × ~200 writes (claim + submit) ≈ **40,000
reads for ONE flash mission**, against the Spark tier's 50,000 a day (the user declined Blaze). It
also made every claim in the run transact on ONE document (contention at exactly the moment the
whole field presses "לקחתי"). v2 is not deployed yet, so no stored claim needs migrating.

**What.**
- `RunTeam.flashClaims?: Record<flashId, FlashClaim>` holds this team's claim (status, at,
  submittedAt, mediaUrl, posterUrl, reviewedAt). The team document is already written by every one
  of these transactions (suspension, award), so this adds no write.
- The flash document keeps only `takenBy?: teamId` in **first** mode: set by the claim, cleared by a
  release, a rejection or the holder's removal. `flashMissionState` reads `takenBy`, never claims.
- `flashClaimVerdict` takes the team's own claim (`team.flashClaims[flashId]`) instead of reading
  the flash document's map.
- **many** mode: claim and submit read the flash document (is it still open?) and write only the
  TEAM: zero writes to the flash document, so zero fan-out and no shared contention.
- `deactivateFlashMission` resumes the teams found by `where('flashSuspension.flashId', '==', id)`
  (single-field index, no composite needed) instead of iterating the claims map.
- The console and the staff app already stream team documents; each builds a flash mission's list
  of takers from `team.flashClaims`. The phone reads its own claim from `getMyTeamState`.

**Cost after.** Phone listeners change only when a flash starts, ends or (first mode) is taken or
freed: a handful of reads per phone per flash, whatever the team count.

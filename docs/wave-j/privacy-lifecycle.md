# Wave-J — Privacy & Data-Lifecycle Sweep

Scope: gallery denormalization leaks, guardian consent, safe-zone, 90-day retention prune,
account deletion / data export, live-location scoping. Read-only static trace.
No dupes with wave-f/g/h/i (wave-g covered hidden-task-content sanitizers + hot-zone coords;
wave-h covered consent *token strength* + join/device IDOR + alerts/teamLocations read-scope).

---

## CONFIRMED findings

| # | file:line | Boundary | Concrete failure | Sev | One-line fix |
|---|-----------|----------|------------------|-----|--------------|
| J1 | `functions/src/runs/index.ts:2093-2129` (`startInstantPlay`) | minor-consent gate | Instant-play seeds `launched:true` + assigns the first task **without ever checking `game.requiresGuardianConsent`**. A published game that is both `allowInstantPlay` and `requiresGuardianConsent` lets a minor play with zero consent — the gate only exists in `startTeams`. | **P1** | If `game.requiresGuardianConsent`, refuse instant-play (or hold the team unlaunched until `grantGuardianConsent`), mirroring `isConsentSatisfied` in `startTeams`. |
| J2 | `functions/src/runs/index.ts:602-618` (`requestGuardianConsent`) + `:620-645` (`grantGuardianConsent`) | consent authenticity | The 128-bit token is returned **directly to the requesting child's device** (`return { token }`, :617); `grantGuardianConsent` accepts that token from **any** authed device with no out-of-band guardian check. The minor can self-call grant with their own token → forged approval (`guardianName` is free text). The "not self-approvable by the child" comment (:600) does not hold. | **P1** | Deliver the token only via an out-of-band channel (guardian email/SMS the owner supplies), or require the grant to come from a device that is NOT in the team's `deviceUids`. At minimum, document that this is a soft gate. |
| J3 | `functions/src/maintenance/index.ts:47-116` (`pruneRunPII`) | 90-day retention | The prune deletes teamLocations, locationTrack, trackable logs, zones, feedItems, photo URLs & consent PII — but **never touches the `alerts` subcollection**. SOS + `safe_zone_breach` alerts store raw `lat`/`lng` (`index.ts:409-413`, `:365-368`) — exactly the "GPS location pings" the policy header (`maintenance/index.ts:5-6`) promises to purge. Location PII is retained indefinitely past retention. | **P1** | Add `${runPath}/alerts` docs to the chunked delete in `pruneRunPII` (or null the lat/lng, keeping the ack fact). |
| J4 | `functions/src/users/index.ts:114-157` (`deleteMyAccount`) | right-to-erasure | Cascade deletes the user tree, wallet, gallery denorm, access codes & Storage — but **not `players/{uid}`** (`runs/index.ts:1028`), which holds the player's `displayName` (PII) + lifetime stats. The profile survives account deletion. Team-HQ `chat` docs the user authored in others' runs also survive. | **P2** | Add `db.recursiveDelete(db.doc('players/'+uid))` to the delete cascade. |
| J5 | `functions/src/maintenance/index.ts:47-116` (`pruneRunPII`) | 90-day retention | `chat` (team↔HQ, `firestore.rules:106`) carries participant free-text (PII) and is **not** pruned. `feedback` free-text survey responses likewise persist (arguably aggregate, but may contain PII). | **P2** | Purge `${runPath}/chat` in `pruneRunPII`; decide feedback policy explicitly. |
| J6 | `functions/src/maintenance/index.ts:163-171` (`pruneRunNow`) | over-deletion | `pruneRunNow` prunes a named run with **no `status`/age check** — an admin can strip a **live** run's photos + GPS mid-game. Admin-only, so low blast radius, but no guard. | **P2** | Reject when `run.status !== 'finished'` unless an explicit `force` flag is passed. |
| J7 | `functions/src/runs/index.ts:614-616` (consent token) | replay window | The token stores `createdAt` but `grantGuardianConsent` (`:631-643`) **never checks a TTL** — a token is valid forever until used. Single-use limits replay, but there is no expiry. | **P2** | Reject tokens older than N hours in the grant transaction; prune stale tokens. |

---

## CLEAN BILLS (verified, no action)

- **Gallery denorm has no secret leak.** `publishGame` (`games/index.ts:387-436`) copies into
  `publicGames`/`publicTasks` only: title, description, mode, scoringPreset, tags, coverImage,
  approxLocation, counts, `allowInstantPlay`, `requirement`, `ownerDisplayName`, task
  type/difficulty/points/estimatedMinutes. **No** `answers`/`numericAnswer`/`steps[].answer`/
  `secretCode`/`hint`, **no** `integrationWebhookUrl`, **no** `manualLeaderboardReveal`
  (`:206-208` deliberately not mirrored), **no** registration-field internals, **no** owner
  email/PII. `updateGame`'s public resync (`:240-261`) copies the same safe subset. **Clean.**
- **duplicateGame / translateGame strip the webhook secret** (`games/index.ts:331`,
  and translateGame rebuilds from `newGame`). Copying another creator's public game cannot
  carry their Slack/Teams webhook or their `allowInstantPlay` opt-in. **Clean.**
- **Unpublished game is unreachable publicly.** `publicGames`/`publicTasks` are the only public-read
  docs (`firestore.rules:173-180`) and exist only after `publishGame`; `checkChallengeAnswer`
  (`games/index.ts:498-501`) and `startInstantPlay` (`runs/index.ts:2086-2087`) both gate on the
  `publicGames` doc existing. Private games are owner-read only (`firestore.rules:39-41`). **Clean.**
- **Live location never leaks to other participants.** `teamLocations` + `locationTrack` are
  **owner-read only** (`firestore.rules:119-128`); `alerts` are owner + run-scoped-staff
  (`:115-118`). Safe-zone breach detection is server-side in `updateLocation`
  (`index.ts:353-372`); the breach flag/alert goes only to owner/staff. `updateLocation` writes
  the pin only for the *controlling* device. **Clean.**
- **exportMyData is self-only, no cross-user data.** Every read is keyed to `uid`
  (`users/index.ts:65-102`); games/wallet/transactions/profile are all the caller's own. It does
  **not** enumerate other creators' runs or any team but the caller's. No cross-user export. **Clean.**
- **Consent gate is server-authoritative for organized runs.** `startTeams` filters on
  `isConsentSatisfied(t, game)` (`runs/index.ts:566`) — not a UI-only gate. (The bypass in J1/J2
  is on the *instant-play* / *self-grant* surfaces, not this one.) **Clean.**
- **Retention sweep is authz'd + idempotent.** `pruneExpiredRunData` is a pubsub schedule;
  `pruneExpiredRunDataNow`/`pruneRunNow` call `assertAdmin` (`maintenance/index.ts:25-30`) — not
  participant-triggerable, no emulator bypass. `sweepExpiredRuns` scopes to `status=='finished'`
  AND `finishedAt < cutoff` (`:124-128`) and skips already-pruned via `piiPrunedAt` (`:133`). **Clean.**
- **Safe-zone polygon is operational, not sensitive.** `SafeZone` is a circle
  (center+radius, `safeZone.ts`); it defines the play boundary participants must see. Not a
  secret; no answer-key or hidden-task correlation beyond the organizer's own choice. **Clean.**

---

## NEEDS RUNTIME CHECK

- **N1 — instant-play consent (J1):** confirm at runtime that a game with both
  `allowInstantPlay:true` and `requiresGuardianConsent:true` actually reaches gameplay via
  `startInstantPlay` without a consent record. Static read shows no gate; a runtime call proves it.
- **N2 — no alternate launch path:** `launched:true` is set only in `startTeams` (`runs/index.ts:576`)
  and `startInstantPlay` (`:2117`). Confirm no other callable (join/requestNextTask/completeTask)
  can flip a pending-consent team to active, which would broaden J1/J2.

---

## Note (design, not a bug)

`publishGame` copies each task's exact `coordinates` into `publicTasks` (`games/index.ts:427`),
which is world-readable (`firestore.rules:177`). This is an explicit owner opt-in for the task
library / marketplace (task reuse needs the pin), and wave-g already treated task coordinates as
gallery-public. It is **not** a secret-key leak, but a creator who publishes a hunt to the gallery
before running it exposes every task's exact location to anyone. Worth a one-line console warning,
not a code fix.

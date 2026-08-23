## Why

A RushPoint creator clicked **Delete** on a game card and lost a real game permanently, in one click,
with no way back and no record that it ever happened.

`deleteGame` (`functions/src/games/index.ts:329`) ends in `db.recursiveDelete(ref)`. That single call
destroys the game document **and every document beneath it** — every run, every team and its whole
progress history, every feed item, feedback response, chat thread and GPS location track. There is no
soft delete, no trash, no undo, and no grace period. The only confirmation is a
`dialog.confirm` (`DashboardPage.tsx:147`) whose accept button is one click away.

Three separate defects turned one misclick into an unrecoverable incident:

1. **No recovery.** The destruction is synchronous and total. A finished run, its team, and its
   history simply ceased to exist. The only reason the incident was diagnosable at all is that a
   dev-only emulator backup loop happened to hold a 20-minute window — luck, not design.
2. **A dangling access code.** `deleteGame` never touches `accessCodes`. After the incident
   `accessCodes/RQH3DG` still existed, pointing at a game that no longer had a document. A
   participant typing that code hits `getJoinInfo`, which resolves the code, reads a missing game
   doc, and fails with a bare `not-found` (`functions/src/runs/index.ts:349`). Verified in code:
   `deleteMyAccount` (`functions/src/users/index.ts:125`) *does* query and delete the owner's access
   codes; `deleteGame` does not.
3. **No audit trail.** `deleteGame` writes nothing to `auditLogs`. "Who deleted this, and when" was
   answerable only by diffing database snapshots. Verified in code: `loggedCallable`
   (`functions/src/obs/log.ts:64-77`) emits a **console-only** `callable.ok` line through the
   Firebase logger — it never persists anything, and `auditLogs` is written by exactly one helper
   (`writeAuditLog`, `functions/src/index.ts:111`) that only `adjustTeamScore` and the station-review
   path call.

Deleting a game is the single most destructive thing a creator can do to their own work, and it is
currently the least protected.

## What Changes

**Deleting a game becomes reversible.**
- `deleteGame` no longer destroys anything. It marks the game deleted (a tombstone carrying *when*
  and *by whom*) and the game disappears from the creator's console, the public gallery, and every
  play surface — exactly as if it were gone.
- A new **Recently deleted** view lists tombstoned games with the time remaining before permanent
  destruction, and restores any one of them, **with all of its runs, teams and history intact**.
- Permanent destruction happens only after a 30-day grace period, or when the creator explicitly
  asks for it from the Recently deleted view. **BREAKING** for any caller that assumed `deleteGame`
  makes `getGame` return `not-found` immediately — it still does, but the data is retained.

**Deleting a game with a LIVE run is refused outright.**
- A run in progress is participants standing in a street holding phones. `deleteGame` today deletes
  it out from under them; from now on it returns `failed-precondition` and names the live run. The
  creator must finalize the run first. Soft-delete is not offered as a compromise here — a
  "deleted" game whose participants are still mid-race is an incoherent state.

**The join code stops dangling.**
- Soft-delete **revokes** the game's access codes (`status: 'revoked'`, an already-supported value);
  restore un-revokes exactly the codes this deletion revoked. Permanent purge deletes them.

**Destructive game actions are recorded.**
- `deleteGame`, the new restore, and the new permanent-delete each write an `auditLogs` entry
  (actor, game, action, timestamp), readable via the existing `listAuditLogs`.

**The delete affordance requires deliberate confirmation.**
- The Dashboard card's one-click `dialog.confirm` is replaced by a two-step, type-the-game-title
  confirmation reusing the mechanics and tone of the existing Settings danger zone
  (`SettingsPage.tsx:280-327`).

## Non-goals

- **No change to `deleteMyAccount`.** Account deletion is a legal right-to-erasure obligation and
  must stay immediate and total. It continues to `recursiveDelete` the whole user tree, tombstoned
  games included.
- **No trash for anything other than a Game.** Runs, teams, tasks and stages are unaffected.
- **No new scheduler.** The 30-day purge rides the existing daily
  `pruneExpiredRunData` schedule in `functions/src/maintenance/index.ts`.
- **No cross-account recovery / support tooling.** Restore is the owner's own action; there is no
  admin "undelete someone else's game" surface.
- **No change to the 90-day run-PII retention prune.** A tombstoned game's runs stay subject to it.
- **No storage retention change on purge.** Purge deletes run photos and game media exactly as
  today's `deleteGame` does; soft-delete deletes neither (that is what makes restore complete).

## Capabilities

### New Capabilities
- `recoverable-game-deletion`: Deleting a game is a reversible, audited, grace-period action. The
  game disappears everywhere immediately, its join codes are revoked, its data is preserved, the
  owner can restore it whole or destroy it early, and destruction otherwise happens automatically
  after a fixed grace period. Deleting a game with a live run is refused.
- `destructive-action-audit`: Destructive creator-initiated actions on a game leave a durable,
  server-written record of actor, target and time in `auditLogs`.

### Modified Capabilities
<!-- None. `run-billing`, `authorization` and `input-validation` in openspec/specs/ are unchanged:
     deleteGame's ownership check, the launch billing path, and payload validation all keep their
     existing contracts. This change adds lifecycle state to a game rather than altering an
     existing requirement. -->

## Impact

- **Surfaces touched:** `packages/shared` types · **three callables** (`deleteGame` changed;
  `restoreGame` and `purgeGameNow` **new** — each needs a typed wrapper in
  `apps/creator-web/src/services/calls.ts` and its own `scripts/e2e-verify.mjs` coverage, because the
  e2e callable-coverage guard fails the suite on any callable that is never invoked) ·
  `apps/creator-web` (Dashboard card + a Recently deleted view + i18n) · `firestore.rules` ·
  the scheduled maintenance sweep. **`apps/play-web` is untouched** — every play surface reaches a
  game through an access code or `publicGames`, both of which this change clears at soft-delete.
- **Read paths that must learn to exclude a tombstoned game** (a missed one means a "deleted" game
  still shows up somewhere): `listGames`, `getGame`, `launchRun`, `startInstantPlay`,
  `duplicateGame`, `translateGame`, `publishGame`, `getJoinInfo`, `joinRun`, `checkChallengeAnswer`,
  `getPublicLeaderboard`, and the `publicGames`/`publicTasks` gallery index. Enumerated with the
  chosen mechanism per path in `design.md`.
- **Risk:** a game is now soft-deleted while its `runs` subtree still exists, so anything that
  reaches a run *without* going through the game doc (a staff token, a resumed participant session)
  could still act on a "deleted" game. Addressed in design by refusing at the game read, which every
  such path performs.
- **Firestore:** a new composite index is expected for the tombstone query; `firestore.rules` gains
  a clause so the tombstone cannot be forged or cleared by a direct client write.
- **Testing:** tombstone/visibility predicates, grace-period expiry math and restore eligibility are
  pure functions in `packages/shared` with tests in the existing no-emulator `npm test` lane;
  callable behavior lands as a new scenario in `scripts/e2e-verify.mjs`.

# Design — recoverable-game-deletion

## Context

`deleteGame` (`functions/src/games/index.ts:298-331`) is a four-step irreversible cascade:
remove the `publicGames` doc + `publicTasks` query results, `deleteRunsPhotos(runIds)`,
`deleteGameMedia(uid, gameId)`, then `db.recursiveDelete(ref)`. The last line takes the game and
everything below it. There is no status check, no `accessCodes` cleanup, and no `auditLogs` write.
The client-side gate is `dialog.confirm(d.deleteConfirm(g.title), d.deleteBtn, true)`
(`DashboardPage.tsx:147`).

Constraints this design must respect:
- Run/team/score docs are server-write-only; every mutation is a callable + a typed wrapper
  (`apps/creator-web/src/services/calls.ts`) and every new callable must be exercised by
  `scripts/e2e-verify.mjs` or the suite's callable-coverage guard fails the run.
- `FIRESTORE_PATHS` from `@rushpoint/shared`; no hardcoded path strings in new code.
- Never dotted-update an array element; `.set({merge})` with a dotted key writes a literal field.
- Firestore has no "move document with subcollections" primitive.
- `deleteMyAccount` is a legal erasure obligation and stays immediate.

## Goals / Non-Goals

**Goals**
1. A deleted game is recoverable, whole (runs, teams, history), for 30 days.
2. A deleted game is invisible on **every** read path, enumerated and enforced by a test.
3. No dangling `accessCodes`.
4. Every destructive game action is attributable after the fact.
5. Deleting a live game is impossible.

**Non-Goals** — as listed in `proposal.md` (no account-deletion change, no trash for other entities,
no second scheduler, no admin cross-account undelete, no change to the 90-day run-PII prune).

## Decisions

### D1 — The tombstone is two fields on the game document, in place

```ts
// packages/shared/src/types/index.ts — Game
deletedAt?: string;   // ISO — presence IS the tombstone
deletedBy?: string;   // uid that deleted it (audit correlation; never displayed to players)
```

**Why in place.** The obvious alternative — move the doc to `users/{uid}/deletedGames/{gameId}` — is
wrong on Firestore: **moving a document does not move its subcollections.** The `runs/…/teams/…`
subtree would stay parked under the old, now-empty `users/{uid}/games/{gameId}` path, reachable by
nothing and cleaned by nothing. That is the same class of orphaning that caused this incident. A
flag on the doc keeps the whole subtree attached, makes restore a two-field delete, and makes
`deleteMyAccount`'s `recursiveDelete(users/{uid})` still sweep tombstoned games with zero changes.

**Why no stored `purgeAfter`.** Derived, not stored: `purgeDueAt = deletedAt + GAME_TRASH_RETENTION_DAYS`.
A stored copy goes stale the moment the retention constant changes, and creates two sources of truth
for "is this destroyable" — the last thing this feature should have.

**Fail-closed rule:** an unparseable `deletedAt` counts as *deleted* (hidden) but **never** as
*purge-due*. A corrupt timestamp must not be a licence to destroy.

New shared module `packages/shared/src/gameLifecycle.ts`, all pure:

| Export | Purpose |
|---|---|
| `GAME_TRASH_RETENTION_DAYS = 30` | grace period |
| `isGameDeleted(g)` | presence of a non-empty `deletedAt` |
| `visibleGames(games)` | the `listGames` filter |
| `deletedGames(games)` | the trash filter |
| `gamePurgeDueAt(deletedAt, days?)` | ISO instant of eligibility, `null` if unparseable |
| `isPurgeDue(deletedAt, now, days?)` | inclusive at the boundary; `false` if unparseable |
| `daysUntilPurge(deletedAt, now, days?)` | UI countdown, floored at 0 |
| `restoreEligibility(game, now)` | `{ok:true}` \| `{ok:false, reason:'not_deleted'\|'purged'}` |

### D2 — Every read path, and how each one now excludes a tombstoned game

Enumerated deliberately, because a missed path means a "deleted" game still shows up somewhere.
Three mechanisms only:

**(a) Guarded at the game read** — a new server helper
`functions/src/games/lifecycle.ts` → `assertGameNotDeleted(game)` (throws `not-found`, the same code
a truly absent game produces, so no caller learns that a tombstone exists) and
`loadOwnedLiveGame(ownerUid, gameId)` for the load+exists+owner+tombstone quartet.

| Callable | File | Guard |
|---|---|---|
| `getGame` | `games/index.ts:496` | `assertGameNotDeleted` after the owner check |
| `updateGame` | `games/index.ts:137` | same — a deleted game cannot be edited |
| `publishGame` | `games/index.ts:387` | same — cannot be re-listed in the gallery |
| `duplicateGame` | `games/index.ts:336` | same, on the **source** game (own or public) |
| `translateGame` | `games/index.ts:574` | same |
| `launchRun` | `runs/index.ts:199` | same — a tombstoned game can never go live |
| `startInstantPlay` | `runs/index.ts:2094` | same |
| `checkChallengeAnswer` | `games/index.ts:545` | same |
| `getJoinInfo` | `runs/index.ts:349` | same |
| `joinRun` | `runs/index.ts:427` | same |
| `getPublicLeaderboard` | `runs/index.ts:1792` | same — the shared board link dies with the game |
| `getRunRecap` | `runs/index.ts:1862` | same |
| `listLiveRuns` | `runs/index.ts:3692` | already loads the game doc for the title; drop tombstoned rows |

**(b) Filtered in memory after the existing query** — no new index, no query rewrite:

| Callable | Filter |
|---|---|
| `listGames` (`games/index.ts:513`) | `visibleGames(...)` over the existing `orderBy('updatedAt').limit(200)` |
| `listDeletedGames` (new) | `deletedGames(...)` over the same query shape |

> Firestore cannot express "field absent" as an equality (`where('deletedAt','==',null)` does **not**
> match documents lacking the field), so a server-side filter would require writing `deletedAt: null`
> onto every existing game — a migration this change explicitly avoids. The `limit(200)` bound is
> unchanged; a creator with >200 games of which many are tombstoned could see a short list, which is
> a pre-existing property of that bound, noted in Risks.

**(c) Handled by index removal, not by a filter** — soft-delete deletes the `publicGames` doc and all
`publicTasks` rows for the game (exactly what today's `deleteGame` already does, now unconditional
rather than only when `visibility === 'public'`). Therefore `searchGallery` and `searchTaskLibrary`
need **no code change at all**: their only source is the gallery index. Same for the play-web
`?game=<id>` promo, which reads `publicGames` directly under the public-read rule.

**Deliberately NOT filtered:**
- `exportMyData` (`users/index.ts:65`) keeps returning tombstoned games, tagged `deleted: true`. The
  data still exists; a right-of-access export that hides it would be a false statement.
- `deleteMyAccount` — unchanged, `recursiveDelete` already covers tombstoned games.
- `sweepExpiredRuns` / `pruneRunPII` — a tombstoned game's finished runs stay subject to the 90-day
  PII prune. Being in the trash must not suspend a privacy commitment.

**Regression guard:** `scripts/test-game-tombstone-readpaths.ts` (pure static source scan, in the
style of `scripts/test-callable-exports.ts`) asserts each callable named in table (a) contains a
tombstone guard within its body, and each in table (b) references the filter helper. A new read path
added later without a guard fails `npm test` with no emulator.

### D3 — A live run refuses deletion outright; it is not soft-deleted

Today `deleteGame` deletes a live run out from under participants who are physically standing in a
street. Verified: there is no `status` check anywhere in the callable.

New behavior: `failed-precondition`, naming the run's access code. **Not** soft-delete, because a
"deleted" game whose participants are mid-race is an incoherent state — `getMyTeamState`,
`completeTask` and the staff console all reach the run through the game doc, so soft-deleting would
either break a live event silently or require the tombstone to be selectively ignored, which
destroys the single meaning of the flag. Refusing is the honest answer: finalize, then delete.

**No index needed.** `deleteGame` already fetches the whole `runs` collection (line 323) to purge
photos; the check is `runs.some(r => r.status !== 'finished')` in memory. An equality query
(`where('status','==','live')`) would miss `'draft'`; `!=` would need an index. `RunStatus` is
`'draft' | 'live' | 'finished'`, so "not finished" is the correct predicate.

### D4 — Access codes are REVOKED on soft-delete, DELETED on purge

`AccessCodeStatus` already includes `'revoked'`, and `getJoinInfo`/`joinRun`/`joinTeamAsDevice`
already refuse it with `permission-denied` "Code revoked" (`runs/index.ts:340,414,2445`). Nothing in
the codebase currently *sets* it. This change is its first producer.

**Why revoke rather than release.** Releasing (deleting) the code immediately would make restore
incomplete in a way the creator cannot fix: the code is printed on flyers and pasted into WhatsApp
groups, and `uniqueCode()` could hand the freed string to a different creator's run within the grace
period. Restore would then return a game whose every shared link is dead or, worse, points at
someone else's event. Holding the code costs 30 days of one string out of a large code space, which
is negligible. Revoking is also the precise fix for the dangling-`RQH3DG` bug: a participant now
gets an honest "this code has been revoked" instead of a `not-found` on a missing game doc.

Two extra fields on the `accessCodes` doc, written only by the server:

```
revokedByGameDeletionAt: <the game's deletedAt, verbatim>
revokedFromStatus:       <'unused' | 'used'>   // what to put back
```

Restore un-revokes **only** codes whose `revokedByGameDeletionAt` equals the tombstone being lifted.
That is what makes a delete → restore → delete → restore cycle correct, and what stops a restore
from resurrecting a code an owner revoked for an unrelated reason later.

The lookup is `accessCodes.where('ownerUid','==',uid).where('gameId','==',gameId)` — a two-field
equality query. **New composite index required** (`accessCodes`: `ownerUid` ASC + `gameId` ASC) in
`firestore.indexes.json`. `deleteMyAccount` gets away with a single-field `ownerUid` query today,
which is auto-indexed; adding `gameId` is not.

### D5 — Purge is BOTH scheduled and on demand, reusing the existing scheduler

Three entry points, one implementation (`purgeGameTree(ownerUid, gameId)` — the exact body of
today's `deleteGame`: gallery index, run photos, game media, `recursiveDelete`, plus the
access-code deletion that was missing, plus an audit entry):

| Entry | Who | Why it exists |
|---|---|---|
| `pruneExpiredRunData` (existing daily schedule, `maintenance/index.ts:168`) also calls `sweepPurgeableGames()` | system | The change explicitly must not add a second scheduler. The retention sweep already runs daily at the right cadence with the right timezone. |
| `purgeGameNow({gameId})` (new, owner) | owner | "Delete permanently" from the trash view. Requires an existing tombstone (`failed-precondition` otherwise) so it can never become a one-call hard delete and re-create the original defect. |
| `purgeDeletedGamesNow({graceDays?})` (new, admin) | platform admin | Mirrors the existing `pruneExpiredRunDataNow`. The optional `graceDays` override is what makes the grace period **provable in e2e in both directions** (30 ⇒ not purged, 0 ⇒ purged) without waiting a month. Admin-gated by the same `assertAdmin` that has no emulator bypass, at the same trust level as the existing `pruneRunNow`. |

The sweep query is `db.collectionGroup('games').where('deletedAt','<=', nowIso)` — an inequality on
a **collection-group** scope, which Firestore does **not** auto-index. Requires a
`fieldOverrides` entry for `games.deletedAt` with `COLLECTION_GROUP` ASCENDING in
`firestore.indexes.json`. Called out because a missing collection-group override fails at runtime,
not at deploy.

### D6 — Restore semantics and its failure modes

`restoreGame({gameId})`: verify owner → verify tombstone present → delete `deletedAt`/`deletedBy`
via `FieldValue.delete()` → un-revoke matching access codes → audit. The runs subtree is untouched
because it was never touched on delete: that is the whole point.

Failure modes, checked in the code:
- **Purged / never existed** → `not-found`. The trash view surfaces it as permanently gone.
- **Not deleted** (double-click, two tabs) → idempotent success; re-running a restore must not error.
- **Non-owner** → `permission-denied` (the doc lives under the owner's uid, so a stranger cannot
  even address it).
- **Name collision — cannot happen.** Games are keyed by document id and duplicate titles are
  already normal (`duplicateGame` produces `"… (copy)"`). No uniqueness constraint exists to violate.
- **Quota — cannot happen.** There is no per-account game cap anywhere (`createGame` imposes none);
  the wallet meters *launches*, not *ownership*. A restored game's runs already consumed their
  credits at launch, and restore creates no run, so restore never charges and never fails on
  billing.
- **Restore does NOT re-publish.** A game that was public at deletion comes back `private`.
  Re-publishing must go through `publishGame`, which re-runs the structural winnability guard
  (`gameStructureProblems`) before re-indexing — silently pushing a game back into the public
  gallery 29 days later would be a surprise, and would skip that validation.

### D7 — The audit trail

`writeAuditLog` (`functions/src/index.ts:111`) is a private function in the root module. It moves
verbatim to **`functions/src/obs/audit.ts`** and is re-imported by `index.ts` and by `games/index.ts`.
No cycle: `index.ts` and `games/index.ts` both already import from `obs/`, and `obs/` imports
nothing from either.

Three new `actionType` values: `game_deleted`, `game_restored`, `game_purged`. Each entry carries
`operatorId` (the uid, or `system:purge-sweep` for the scheduled path), `gameId`, `gameTitle`,
`reason`, and the existing server `timestamp`. Every write is `.catch(logBestEffort(...))` — an
audit failure must never abort the destructive action the creator asked for, or the fix becomes a
new outage.

Explicitly **not** done: making `loggedCallable` persist every invocation. It is console-only by
design (`obs/log.ts:64-77`) and turning ~85 callables into Firestore writes would be a cost and PII
problem. Only destructive game actions get durable records.

### D8 — Rules: the tombstone is server-only

`firestore.rules` currently allows `allow write: if isOwner(uid)` on `users/{uid}/games/{gameId}`.
Verified: **no client code writes a game document** (creator-web's only direct Firestore writes are
`users/{uid}` in `AuthGate.tsx:138` / `SettingsPage.tsx:136`, plus run-scoped `onSnapshot` reads), so
the permission is vestigial. Rather than removing it (a bigger blast radius), it is narrowed:

```
match /games/{gameId} {
  allow read:   if isOwner(uid);
  allow create: if isOwner(uid) && !hasTombstone(request.resource.data);
  allow update: if isOwner(uid) && tombstoneUnchanged();
  allow delete: if isOwner(uid);
  …
}
function hasTombstone(d)     { return d.keys().hasAny(['deletedAt', 'deletedBy']); }
function tombstoneUnchanged() {
  return hasTombstone(request.resource.data) == hasTombstone(resource.data)
      && (!hasTombstone(resource.data)
          || request.resource.data.deletedAt == resource.data.deletedAt);
}
```

A client can neither forge a tombstone (hiding a game from itself with no server record) nor clear
one (undeleting past the grace period, or resurrecting a purged-pending game). Admin SDK bypasses
rules, so the server paths are unaffected. Assertions are added to `scripts/test-rules.mjs`.

### D9 — Client friction reuses the Settings danger-zone pattern

The one-click `dialog.confirm` on the Dashboard card is replaced by the same two-step mechanics as
`SettingsPage.tsx:280-327` (`DangerCard`): a first click reveals an inline danger panel; the
destructive button stays disabled until the creator types the confirmation text; an `✕` cancels.
The difference is **what** must be typed: the **game's own title**, not a fixed word — the incident
was deleting the *wrong game*, and a fixed word like "DELETE" does not discriminate between two
cards. Copy states the game is recoverable for 30 days, which is now true.

The predicate is a pure function so it is testable without a component runner:
`apps/creator-web/src/lib/deleteConfirm.ts` → `matchesGameDeleteConfirmation(typed, title)`
(trims both sides, exact compare, empty title never matches), with a co-located vitest picked up by
`turbo run test`.

A new **Recently deleted** route (`/trash`, `TrashPage`) lists tombstoned games with a
`daysUntilPurge` countdown and Restore / Delete permanently actions, reached from a link on the
Dashboard rather than a new top-level nav entry (a rarely-opened surface should not compete with
Build/Gallery/Wallet). "Delete permanently" reuses the same type-the-title panel.

All new copy goes through `t.*` in **both** dictionaries of `apps/creator-web/src/i18n.ts`, Hebrew in
real Hebrew, and follows the no-dash separator standard (INSTRUCTIONS §3.C).

## Test strategy

**Pure lane (`npm test`, no emulator) — written first, must fail first:**
- `scripts/test-game-lifecycle.ts` — `isGameDeleted`, `visibleGames`/`deletedGames`,
  `gamePurgeDueAt`, `isPurgeDue` at exactly the boundary and ±1 ms, `daysUntilPurge` flooring,
  `restoreEligibility` for each reason, and the fail-closed unparseable-`deletedAt` invariant
  (hidden, never purge-due).
- `scripts/test-game-tombstone-readpaths.ts` — the static read-path guard scan of D2.
- `apps/creator-web/src/lib/deleteConfirm.test.ts` — the confirmation predicate.
- `scripts/test-callable-exports.ts` (existing) automatically covers the wiring of the four new
  callables once their wrappers land.

**Emulator lane (`scripts/e2e-verify.mjs`) — a new scenario `recoverable game deletion`:**
soft-delete hides but preserves (`getGame` `not-found`, `listGames` excludes, the run doc still
exists via a direct admin read) · delete refused while a run is live (`failed-precondition`, game
still has no tombstone) · access code refuses join after delete (`permission-denied`) and works again
after restore · restore returns the game **with its run** · restore of a public game returns it
private and absent from `searchGallery` · non-owner restore denied · `purgeDeletedGamesNow({graceDays:30})`
purges nothing, `({graceDays:0})` purges and then `restoreGame` is `not-found` · `purgeGameNow` on a
non-tombstoned game is `failed-precondition` · `listAuditLogs` (as the platform admin) contains
`game_deleted` and `game_restored`. Each of the four new callables is invoked, satisfying the
coverage guard.

**Rules lane (`scripts/test-rules.mjs`):** a client write introducing `deletedAt` is denied; a client
write clearing it is denied; an ordinary game write still succeeds.

**UI:** `npm run i18n:check` and `npm run i18n:check:strict` must both stay clean (the strict
baseline before this change is **PASS with zero PART A and zero PART B findings**, so any new
hardcoded string is a regression), plus `npm run creator:build` and `npm run lint`.

## Risks / Trade-offs

- **A tombstoned game still has a live subtree.** → Every path that reaches a run first reads the
  game doc (verified across `runs/index.ts`), and D3 makes it impossible for a tombstoned game to
  have a non-finished run in the first place. The static read-path test keeps it that way.
- **Storage is retained for 30 extra days** (run photos + game media are no longer deleted at the
  delete click). → That retention is exactly what makes restore complete; purge deletes both, and
  the 90-day run-PII prune still strips participant photos on its own schedule regardless.
- **`listGames`'s `limit(200)` now counts tombstones.** → Pre-existing bound; a creator at that
  scale is far outside current usage, and the trash view has its own list. Noted rather than fixed.
- **Two new indexes** (accessCodes composite, `games.deletedAt` collection-group override) must be
  deployed before the code. → Ordered in the migration plan below.
- **The `graceDays` override on the admin sweep is a foot-gun** if an admin passes 0 in production.
  → Admin-only behind `assertAdmin` with no emulator bypass, same posture as the existing
  `pruneRunNow`, and it only ever destroys already-tombstoned games.
- **Behavior change for existing callers**: `deleteGame` can now fail with `failed-precondition`.
  → The Dashboard is the only caller and gets an explicit message.

## Migration Plan

1. Deploy `firestore.indexes.json` (accessCodes composite + `games.deletedAt` collection-group
   override) and `firestore.rules` **first**. Both are backward compatible with the current code.
2. Deploy functions. Existing games have no `deletedAt`, so `isGameDeleted` is false everywhere and
   every read path behaves exactly as today.
3. Deploy creator-web.
4. **No data migration.** Absence of the field is the "not deleted" state; nothing is backfilled.
5. **Rollback:** revert functions + creator-web. Any game tombstoned in the meantime becomes visible
   again with its data intact (the old `listGames` does not filter), which is a safe failure
   direction. Rolling back does **not** resurrect anything already purged, so roll back before the
   first grace period elapses if at all.

## Open Questions

- Should a creator be notified (email/in-app) before a tombstoned game is purged? Out of scope here;
  the platform has no transactional email surface yet.
- Should `GAME_TRASH_RETENTION_DAYS` be per-plan (longer for Creator Pro)? Deliberately a single
  constant for now; the pure helpers already take `days` as a parameter, so making it per-plan later
  is a signature change, not a redesign.

## Why

Tonight's batch (`ad6a3e4`, `3953e1f`, `6b48f91`) added new lifecycle state and new world-readable
surfaces: the game **trash tombstone** (`deletedAt`/`deletedBy` + a 30-day grace period),
`publicLikes`, popularity/ranking counters on `publicGames`/`publicTasks`, and the coarse
`approxLocation` contract on `publicTasks`. `firestore.rules` was updated in the same commit. An
audit of the resulting rules against the data model found **two confirmed gaps, both in the game
document rule**, plus a set of new surfaces with no rules test at all.

**Gap 1 — a client can still destroy a game outright (`firestore.rules:50`).**

```
match /games/{gameId} {
  allow create: if isOwner(uid) && !hasTombstone(request.resource.data);
  allow update: if isOwner(uid) && tombstoneUnchanged();
  allow delete: if isOwner(uid);        // ← the hole
}
```

The change `recoverable-game-deletion` states the invariant as *"deletion state is only ever
produced by the server"*, and the rules carefully stop a client from **forging** or **clearing** a
tombstone. But the `delete` verb was left open, so the entire soft-delete mechanism is one
`deleteDoc()` away from being bypassed. Authenticated as the owner (their own browser console, a
mis-scoped future client change, or any code holding their session):

`deleteDoc(doc(db, 'users/<ownerUid>/games/<gameId>'))` succeeds, and:

- the game is gone **permanently** — no tombstone, no 30-day trash, no `restoreGame`, no
  `AUDIT_GAME_DELETED` record. This is precisely THE INCIDENT that change exists to prevent
  (`functions/src/games/index.ts:344`).
- **`publicGames/{gameId}` and every `publicTasks/{gameId}_*` row survive**, because
  `removeGalleryIndex()` only runs inside the callables. The game keeps being **world-readable**
  (`allow read: if true`) forever with no owning document left to unpublish it. So the audit
  question "does deleting a game actually stop it being publicly readable" answers **no** on this
  path — it violates the requirement *"Deletion clears every public surface."*
- the run's `accessCodes` survive dangling — the exact orphan bug the change documents and fixes.
- the run/team/feed/feedback subtree survives orphaned under a non-existent parent, unreachable by
  any callable (they all load the game document first) and unpurgeable (`purgeGameNow` requires a
  tombstone, `loadOwnedTrashedGame` throws `not-found`). Storage photos and game media orphan too.

No client in this repo deletes a game document directly — the only client-side Firestore writes in
either app are `setDoc(doc(db,'users',uid), …)` in `AuthGate.tsx` and `SettingsPage.tsx`. Deletion
goes through the `deleteGame` callable. So denying the verb removes a bypass and breaks nothing.

**Gap 2 — only *half* the tombstone is immutable (`firestore.rules:272-276`).**

```
function tombstoneUnchanged() {
  return hasTombstone(request.resource.data) == hasTombstone(resource.data)
      && (!hasTombstone(resource.data)
          || request.resource.data.deletedAt == resource.data.deletedAt);
}
```

`hasTombstone()` is `hasAny(['deletedAt','deletedBy'])` and the value comparison covers **only**
`deletedAt`. On a game already in the trash, an authenticated owner may therefore
`updateDoc(gameRef, { deletedBy: 'some-other-uid' })` — or remove `deletedBy` entirely — and the
write is allowed: the tombstone is still "present", and `deletedAt` is unchanged. The spec requires
rules to *"reject any direct client write to a game document that introduces, **changes**, or
removes the tombstone fields"* (plural). Impact is low today (nothing authorizes off `deletedBy`;
`auditLogs` holds the authoritative record), but it is a client-writable field that the data model
declares server-written, and the same rule is the only thing standing between a client and the
trash state.

**Coverage gap — tonight's new surfaces are largely untested at the rules layer.** `test-rules.mjs`
gained assertions for popularity/likes and tombstone forge/clear, but nothing covers: hard-deleting
a game, hard-deleting a *trashed* game, mutating `deletedBy`, listing another creator's trash,
reading another creator's trashed game, `publicTasks.approxLocation` writability, or a staff token
minted for a **different owner**.

### Refuted while auditing (deliberately NOT changed)

- **`publicTasks` exact coordinates.** Rules **cannot** enforce this: they can gate a document, not
  a field, and every write is Admin-SDK (rules never evaluate). Enforcement is at the write path and
  it is sound — `publishGame` uses `publicTaskLocation(task)` and `batch.set()` (full overwrite, not
  merge), so re-publishing *erases* a legacy `coordinates` key, and `backfillPublicTaskCoordinates`
  repairs documents that never get re-published. Nothing to fix in rules; stated here so it is not
  mistaken for coverage.
- **Popularity / like forgery.** `publicGames`, `publicTasks` and `publicLikes` are all
  `allow write: if false`, and `publicLikes` denies reads too. Sound, and already asserted.
- **Cross-tenant trash visibility.** `users/{uid}/games` reads require `isOwner(uid)`, so a
  non-owner can neither read nor list another creator's trash. Sound — but untested, so tests are
  added.
- **Staff scoping.** `isStaffForRun()` compares all three claims (`ownerUid`, `gameId`, `runId`);
  staff of run A cannot reach run B. Sound; a same-owner wrong-run case is already tested, a
  wrong-owner case is added.
- **`accessCodes` / `wallets` / `auditLogs` / `rateLimits`.** Unchanged and still sound: `get`-only
  (no enumeration) for codes, owner-read-only for wallets, fully closed for audit logs and rate
  limits. Tonight's new access-code fields (`revokedByGameDeletionAt`, `revokedFromStatus`) are
  written by callables and add no client-writable surface.
- **Server-only run state.** Every run subcollection is `allow write: if false`, which covers the
  `delete` verb as well as writes, so tonight's new fields under runs/teams inherit the deny; there
  is no permissive branch anywhere beneath `/runs/{runId}`.

## What Changes

**A game document becomes undeletable by a client.** Destruction of a game is exclusively a server
act (`purgeGameNow` / the scheduled sweep), because destruction has to take the gallery index, the
access codes, the Storage objects and the audit record with it — things a raw document delete cannot
do. The client path is `deleteGame`, which tombstones.

**The whole tombstone becomes immutable to clients, not just half of it.** Every tombstone field is
compared, so a client can neither introduce, nor change, nor remove any part of the deletion record.
The comparison is written to be total — a document carrying only one of the two fields still yields
a definite allow/deny instead of an evaluation error.

**The rules test suite covers tonight's surfaces.** New assertions for: game hard-delete (live and
trashed), `deletedBy` mutation and removal, tombstone clearing by field deletion, an ordinary edit of
a trashed game still succeeding (the guard is not over-broad), cross-tenant trash read + list,
`publicTasks` public read and its unwritability including `approxLocation`, and a staff token minted
for a different owner.

### Non-goals

- **No callable, product or UI change.** No `functions/`, no `packages/shared`, no `apps/**`, no
  i18n. Rules and the rules test only.
- **Does not attempt field-level constraints on `publicGames`/`publicTasks`.** Rules cannot express
  them for Admin-SDK writes; see the refutation above.
- **Does not narrow `create`/`update` on game documents** beyond the tombstone guard. Direct owner
  writes stay allowed exactly as before.
- **Does not clean up documents already orphaned** by a past client-side delete (none are known to
  exist; a sweep would be its own change).

## Capabilities

### New Capabilities
- `firestore-rules-coverage`: the security rules enforce, and the rules test suite proves, that the
  game trash is a server-only lifecycle — a game document cannot be destroyed or have any part of
  its deletion record altered by a client — and that the surfaces added alongside it (public gallery
  ranking, public task areas, cross-tenant trash, staff token scope) are covered by explicit
  assertions rather than assumed.

## Impact

- **Surfaces touched:** `firestore.rules` (game document `delete` verb + `tombstoneUnchanged()`),
  `scripts/test-rules.mjs` (new assertions). Nothing else.
- **Risk:** denying `delete` is strictly narrowing. The only caller that could regress is a client
  that deletes game documents directly; a repo-wide search finds none (`deleteDoc` is not imported
  in either app), and the `deleteGame` callable path is unaffected because the Admin SDK bypasses
  rules entirely.
- **Verification status — READ THIS BEFORE MERGING.** `npm run test:rules` needs the Firestore
  emulator, and a live playtest stack owned this machine's emulator while this change was authored.
  The new assertions are **written but UNRUN**; the rules change is **statically reviewed only**.
  The gating run of `node scripts/test-rules.mjs` against a free emulator is a task in this change
  and has NOT been performed.

## Context

`firestore.rules` is the enforcement point for the platform's core invariant: run / team / score /
leaderboard state is server-write-only, and each creator's tenant is isolated from every other.
`scripts/test-rules.mjs` asserts that invariant directly against the real rules file in the
emulator, and is the launch gate for it.

Tonight's batch changed the shape of the data model under those rules:

- **`recoverable-game-deletion`** turned deletion into a tombstone (`deletedAt`/`deletedBy`) with a
  30-day grace period plus `listDeletedGames` / `restoreGame` / `purgeGameNow`. `firestore.rules:46-50`
  split the game document's blanket `allow write` into `create` / `update` / `delete`, guarding the
  first two with `hasTombstone()` / `tombstoneUnchanged()`.
- **`gallery-popularity-ranking`** added `publicLikes` (`allow read, write: if false`) and
  `likeCount` / `popularity` on the public gallery documents.
- **`task-library-map-view`** replaced the exact `coordinates` on `publicTasks` with a coarse
  `approxLocation`, applied at the write in `publishGame`, with
  `backfillPublicTaskCoordinatesNow` to repair legacy documents.
- **`game-file-export-import`** added export/import, whose shared allow-list already strips
  `deletedAt` / `deletedBy` (`packages/shared/src/gameFile.ts:137`), so an imported file cannot
  smuggle a tombstone.

Verified in this working tree while auditing:

- The only client-side Firestore writes in either app are `setDoc(doc(db,'users',uid), …)` in
  `apps/creator-web/src/components/AuthGate.tsx:138` and `.../SettingsPage.tsx:166`. Neither app
  imports `deleteDoc`. Every game mutation goes through a callable.
- `removeGalleryIndex()` (`functions/src/games/index.ts:357`) — the only thing that removes
  `publicGames/{gameId}` and its `publicTasks` rows — is called from `deleteGame`, `purgeGameTree`
  and the unpublish branch of `publishGame`. It is reachable ONLY through callables.
- `purgeGameNow` → `loadOwnedTrashedGame` (`functions/src/games/lifecycle.ts:47`) refuses a game
  without a tombstone with `failed-precondition`, and every owner-scoped game callable loads the
  game document first. A game whose document no longer exists is therefore unreachable *and*
  unpurgeable by any server path.
- `publishGame` writes each public task with `batch.set()` (full document overwrite, not merge) and
  omits the deprecated `coordinates` key entirely (`functions/src/games/index.ts:738-760`), so a
  re-publish erases a legacy exact coordinate.
- `deletedBy` is not read by any authorization or lifecycle decision — `restoreGame` keys off
  `deletedAt` only, and the authoritative record of who deleted what is `auditLogs`.
- Admin privilege is a custom claim (`context.auth.token.admin`), never a Firestore field, so the
  owner-writable `users/{uid}` document confers no privilege.

Hard constraint on this change: **a live playtest stack owns this machine's emulator.** No emulator,
Vite, tunnel or backup process may be started or stopped, so `npm run test:rules` cannot be run. All
verification here is static; the emulator run is an explicit, un-ticked task.

## Goals / Non-Goals

**Goals:**
- Make the trash lifecycle server-only in fact, not only in the fields it stamps: a client can
  neither destroy a game document nor alter any part of its deletion record.
- Keep the tombstone guard *total* — every input shape produces a definite allow or deny, never a
  rules evaluation error whose deny is incidental.
- Give tonight's new surfaces explicit rules assertions instead of assumed coverage.

**Non-Goals:**
- Field-level constraints on `publicGames` / `publicTasks`. Rules cannot express them here (below).
- Any change to callables, shared types, UI or i18n.
- Narrowing `create` / `update` on game documents beyond the tombstone.
- Cleaning up documents orphaned by a hypothetical past client-side delete.

## Decisions

### D1 — `allow delete: if false` on the game document

Destroying a game is not a document operation, it is a *transaction across five systems*: the game
subtree, the `publicGames`/`publicTasks` gallery index, the `accessCodes` pointers, Storage photos
and game media, and the audit trail. Only `purgeGameTree` does all five. A raw client delete does
exactly one of them and leaves the other four behind — the public gallery row keeps serving the
game to the world with no owner document left to unpublish it, the access codes dangle, and the run
subtree becomes unreachable *and* unpurgeable (every callable loads the game document first;
`purgeGameNow` additionally requires a tombstone that no longer exists anywhere).

So the verb is denied outright rather than conditioned. There is no "safe" client delete to carve
out: even deleting an *already tombstoned* game is wrong, because that is `purgeGameNow`'s job and
it has the same four systems to clean.

*Alternative considered and rejected:* `allow delete: if isOwner(uid) && !hasTombstone(resource.data)`
— i.e. allow discarding a never-deleted game. Rejected: it keeps every consequence above (gallery
row, codes, orphan subtree) and preserves the bypass of the audit record. There is no client that
wants this.

*Blast radius:* strictly narrowing, and no code path uses it (verified above). The `deleteGame`
callable is unaffected — the Admin SDK does not evaluate rules.

### D2 — Compare EVERY tombstone field, using `get(key, default)`

```
function tombstoneUnchanged() {
  return hasTombstone(request.resource.data) == hasTombstone(resource.data)
      && (!hasTombstone(resource.data)
          || (request.resource.data.get('deletedAt', null) == resource.data.get('deletedAt', null)
              && request.resource.data.get('deletedBy', null) == resource.data.get('deletedBy', null)));
}
```

Two properties matter:

1. **Both fields.** `hasTombstone()` is `hasAny([...])`, so with only `deletedAt` compared, a
   trashed game's `deletedBy` could be changed or dropped while the guard still passed. The spec
   says "introduces, **changes**, or removes the tombstone fields".
2. **Totality via `get(key, default)`.** Direct member access on an absent map key raises an
   evaluation error; the request is then denied, but as a side effect rather than a decision. A
   document carrying only one of the two fields (a legacy or partially-written tombstone) would make
   the rule error instead of deciding. `get(field, null)` makes absence a first-class value, so
   "absent stays absent" is an explicit allow and "absent becomes present" (or vice versa) is an
   explicit deny.

Note the guard is deliberately *not* "a trashed game is read-only". An owner may still edit ordinary
fields of a game sitting in the trash — the assertion for that is a positive test, so the guard
cannot silently become over-broad.

### D3 — Rules cannot enforce `publicTasks` coordinate privacy; say so instead of pretending

Two independent reasons, both structural:

1. Firestore rules gate *documents*, not *fields*, on read. `allow read: if true` returns whatever
   the document holds; there is no expression that hides `coordinates` from a reader.
2. Every write to `publicTasks` is Admin SDK. **Rules are never evaluated for it.** A
   `request.resource.data` constraint on that collection would be decorative — it could not fail,
   because it is never consulted.

Enforcement therefore lives entirely at the write path, and it is sound there: `publicTaskLocation()`
excludes hidden-location / locationless / unplaced tasks, `batch.set()` overwrites rather than
merges (so the deprecated key is erased on re-publish), `searchTaskLibrary` strips `coordinates`
from responses, and `backfillPublicTaskCoordinatesNow` repairs documents that are never re-published.
The residual exposure — a legacy document, never re-published, in an environment where the backfill
has not been run — is a **deployment** task, not a rules gap. This change records the reasoning so a
future audit does not re-open it as a rules finding, and the rules test asserts only what rules can
actually promise: the collection is publicly readable and client-unwritable.

### D4 — Test-first, in the existing harness style

`scripts/test-rules.mjs` uses `check(label, assertSucceeds|assertFails(op))` against contexts minted
by `initializeTestEnvironment`, with fixtures seeded through `withSecurityRulesDisabled`. New
assertions follow that shape exactly and reuse the existing `TRASHED-GAME` fixture. Three imports are
added (`deleteDoc`, `updateDoc`, `deleteField`) — `deleteField()` matters because clearing a
tombstone through a field delete is a *different* request shape from overwriting the document
without it, and only the first is what a real client would send.

### D5 — Prefer the stricter rule when it cannot be executed

The emulator is unavailable, so no assertion here is observed to pass. Both rule edits are narrowing
(a previously-allowed delete becomes denied; a previously-allowed field mutation becomes denied), so
a mistake in them fails **closed**: a legitimate operation is refused loudly rather than an illegal
one silently permitted. No rule is loosened anywhere in this change, and no test is written to a
weaker rule to make it hypothetically pass.

## Test Strategy

Lane: **emulator-bound rules lane** (`scripts/test-rules.mjs`, run by `npm run test:rules` and by
`verify:emulator`). No pure-logic lane applies — the subject under test is the rules file itself.

RED first: every assertion below is added before the rules edits, and the game-delete and
`deletedBy` cases must FAIL against the current rules (they are currently *allowed* operations
wrapped in `assertFails`).

**Trash lifecycle is server-only**
- owner CANNOT hard-delete their own game document → `assertFails(deleteDoc(...))` *(RED today)*
- owner CANNOT hard-delete a game that is already in the trash → `assertFails` *(RED today)*
- owner CANNOT change `deletedBy` on a trashed game → `assertFails(updateDoc(...))` *(RED today)*
- owner CANNOT remove `deletedBy` while leaving `deletedAt` → `assertFails(deleteField())` *(RED today)*
- owner CANNOT clear `deletedAt` via `deleteField()` on a trashed game → `assertFails`
- owner CANNOT change `deletedAt` to a later value (restart the grace-period clock) → `assertFails`
- owner CAN still edit an ordinary field of a trashed game → `assertSucceeds` (guard not over-broad)
- owner CANNOT delete a team document (the `delete` verb is covered by `allow write: if false`
  everywhere beneath a run, asserted once as a class)

**Trash is private to its tenant**
- non-owner CANNOT read another creator's trashed game
- non-owner CANNOT list another creator's games collection (the trash listing surface)
- owner CAN list their own games collection

**Public gallery surfaces**
- anon CAN read a `publicTasks` document (the library is world-readable by design)
- anon CANNOT write `publicTasks`, including `approxLocation` specifically
- a non-owner CANNOT write another creator's `publicGames` row
  (popularity / likeCount / publicLikes cases already exist and stay)

**Staff token scope**
- staff minted for a DIFFERENT owner CANNOT read this run's team document
  (the different-run case already exists and stays)

Invariant across the suite: no assertion is changed from `assertFails` to `assertSucceeds` by this
change. The only new `assertSucceeds` cases are ones that pass under both the old and the new rules.

**What will remain unverified when this change is implemented:** everything above. The emulator is
owned by a live playtest stack, so `node scripts/test-rules.mjs` is NOT run. Static checking is
limited to `node --check scripts/test-rules.mjs` (syntax only — it proves nothing about rule
semantics) and reading the rules file. Task 4.1 is the gating run and must be performed by whoever
next has a free emulator, BEFORE this change is archived.

## Risks / Trade-offs

- **A future client that wants to delete a game document directly will now be denied.** Accepted and
  intended — it should call `deleteGame`. The denial is loud (`permission-denied`), not silent.
- **`get(key, default)` semantics.** `MapValue.get` with a default is standard in rules v2; if it
  were unavailable the rules file would fail to compile, which the emulator run in task 4.1 would
  surface immediately as a total failure rather than a subtle one.
- **Unrun tests can encode a wrong expectation.** Mitigated by every new negative assertion being an
  operation that is *currently allowed* — so a stale expectation shows up as a RED that never turns
  GREEN, not as a false pass. Mitigated further by D5: both edits fail closed.

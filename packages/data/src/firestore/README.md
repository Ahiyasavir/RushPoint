# `@rushpoint/data/firestore` — the Firestore implementation

Phase 1 of the storage migration. This is the **behaviour-neutral** step: it does
what `functions/src` does today, so the interface in `../repository.ts` can be
proven right *before* any Postgres work starts.

```
context.ts      construction + the structural driver types + error mapping
transaction.ts  runInTransaction over db.runTransaction, plus withLockRetry
paths.ts        thin helpers over FIRESTORE_PATHS — nothing hardcoded
patch.ts        the three-valued Patch semantics (absent / value / DELETE)
repository.ts   the composed FirestoreRepository
index.ts        the public entry point
```

## Construction

```ts
import * as admin from 'firebase-admin';
import { db } from './firebase';                       // functions/src/firebase.ts
import { createFirestoreRepository } from '@rushpoint/data/firestore';

export const repo = createFirestoreRepository({
  db,
  deleteSentinel: () => admin.firestore.FieldValue.delete(),
});
```

The package **never imports `firebase-admin`**. `functions/src/firebase.ts` calls
`admin.initializeApp()` at module scope, so importing the SDK from a library
would decide *when* and *with which credentials* an app initialises — never a
library's call. It also keeps `@rushpoint/data` dependency-free, which is what
lets `tsc -p tsconfig.check.json` run in a fresh checkout with no `npm install`.
The driver is therefore described **structurally** in `context.ts`; the real
`admin.firestore.Firestore` satisfies `FsDatabase` by shape, with no cast.

## What is implemented

| Aggregate | Status |
| --- | --- |
| Users (`users/{uid}`) | **implemented** |
| Wallets + transactions | **implemented** |
| Games + discovery POIs | **implemented** |
| Runs | **implemented** |
| Access codes | **implemented** |
| Audit logs | **implemented** |
| Transaction runner (`runInTransaction` / `withTx`) | **implemented** |
| `Patch` / `DELETE` translation | **implemented** |
| Public gallery projection | stub |
| Teams (+ nested stage/task records) | stub |
| Live ops · staff · stations · feedback · run objects · cross-run aggregates | stub |
| Every operation in `atomic.ts` (except `appendAuditLog`) | stub |
| Every sweep in `SweepRepository` | stub |

**Every stub throws** `DataError('failed-precondition', 'FirestoreRepository.<name>() is not implemented')`.
None returns `null`, `[]`, `0` or `undefined`. That is not pedantry: an empty
team list reads as "nobody joined", a zero occupancy count reads as "this station
is free", and a `null` run reads as "already deleted". A silent empty answer is
not stale data, it is *fabricated* data, and the caller cannot tell.

## The `Patch` / `DELETE` semantics (`patch.ts`)

The single most important correctness detail here.

| in the patch object | means | this implementation |
| --- | --- | --- |
| key absent | leave the stored value alone | omitted from `.update()` |
| value `undefined` | same as absent | omitted from `.update()` |
| value `null` | store a **real null** | `null` is written |
| value `DELETE` | remove the field | `deleteSentinel()` → `FieldValue.delete()` |

`Game.safeZone?: SafeZone | null` is the canonical case: `undefined` = "the
Builder did not send this field", `null` = "the creator removed the boundary".
Collapsing them silently un-clears safe zones.

Why `DELETE` has to be a `Symbol` rather than a convention around `undefined`:
`functions/src/firebase.ts` sets `ignoreUndefinedProperties: true`, so
`update({ safeZone: undefined })` is a **silent no-op** on this backend — the
field never reaches the wire. Absent and present-but-undefined are already
indistinguishable, so `undefined` *cannot* be given a third meaning. A symbol
compared by identity survives a spread, a JSON round trip and `Object.assign`.

An **empty** patch (every key absent) writes nothing and skips the round trip
entirely — an empty `.update({})` would still throw `NOT_FOUND` against a missing
document, turning a semantic no-op into a spurious error.

`applyPatchInMemory` carries the same three values into a nested
read-modify-rewrite (`DELETE` → `delete obj[k]`), for the `RunTeam.stages[]`
work that Phase 2 will need. It returns a new object and never mutates its input,
so a re-executed transaction body cannot observe a half-applied patch from a
discarded attempt.

## Rules a Postgres implementation must match

1. **Never invent a timestamp, never mint an id.** Both are caller-supplied. The
   two `put`-style methods that need an id (`appendTransaction`,
   `appendAuditLog`) throw `failed-precondition` when it is missing rather than
   generating one.
2. **`patch` = "modify a document that exists".** A missing document surfaces as
   `DataError('not-found')`, never as a silent create. This implementation uses
   `.update()`, not `.set({merge:true})`, for exactly that reason.
3. **No dotted keys, ever.** `assertNoFieldPaths` rejects any patch key
   containing `` . ` [ ] / * ~ ``. `.set({merge:true})` with a dotted key writes a
   *literal top-level field named `"a.b"`*; `.update()` with a dotted key into an
   array element coerces the array into a map. Both have shipped as bugs in this
   repo. Task ids and tag names are user-influenced strings, so a dotted key can
   arrive from data.
4. **Ids may not reshape a path.** `assertId` rejects `''` and anything
   containing `/`.
5. **Patches are shallow.** A nested object value replaces the stored object
   wholesale. `Game.stages` and `Run.taskStatusOverrides` are whole-value
   replaces.
6. **Only `DataError` escapes.** Driver errors are mapped in one place
   (`toDataError`): `NOT_FOUND` → `not-found`, `ALREADY_EXISTS` →
   `already-exists`, the contention family → `contended`, everything
   unclassified → `unavailable` (retriable — a caller retrying a safe operation
   is cheaper than treating a transient gRPC hiccup as permanent).
7. **A page is delimited by `nextCursor`, not by `items.length`.** See below.
8. **Sweeps commit in `chunk(refs, MAX_BATCH_OPS)` groups** (450). A Firestore
   WriteBatch is capped at 500 ops; a run's `teamLocations` runs into the
   thousands. `chunk` and `MAX_BATCH_OPS` are exported here, mirroring
   `functions/src/batchUtil.ts`. A sweep is never run inside a transaction.

## The transaction runner (`transaction.ts`)

The interface publishes the **weaker** contract — "the body MAY execute more than
once" — which Firestore satisfies natively: `runTransaction` is optimistic and
silently re-invokes the body on a conflict. Nothing is emulated.

`withLockRetry` is the **second** retry layer, mirrored verbatim from
`functions/src/routing/assignNextTask.ts`: 8 attempts, backoff
`75 * (i + 1) + random() * 300` ms, and the same contention predicate (gRPC 10
ABORTED / 4 / 13 / 14, plus a message regex for SDK errors carrying no numeric
code). It exists because the SDK's own budget is not enough for the hottest path
— every assign and release contends on the one run document, and at ~20
synchronised teams the lock queue returns `10 ABORTED: lock timeout`. **This
tuning is empirical; do not re-tune it during a migration.**

One deliberate difference: on exhaustion today's code throws
`HttpsError('unavailable')`. Here it is `DataError('contended')` (whose
`.retriable` is `true`), because mapping onto a callable error code is the
caller's job. Same wire behaviour, one less layer that knows about HTTP.

A non-contended error — including a `DataError` thrown by the body — is rethrown
**unchanged and immediately**, never retried. That identity guard is what lets an
invariant refusal escape a transaction intact, and it is covered today by
`functions/src/routing/withLockRetry.test.ts`.

`Tx` is opaque and nominally branded, so handles are kept in a module-private
`WeakMap` rather than cast. A foreign object passed to `withTx` is rejected with
`failed-precondition`, and a handle is invalidated when its attempt ends, so a
body cannot squirrel one away and write into a transaction that never committed.

`withTx(tx)` returns **the same class** with a different `Io`, so "the signature
is identical inside and outside a transaction" is true by construction rather
than by discipline.

## Paths (`paths.ts`)

`FIRESTORE_PATHS` names every *document* this implementation needs but not every
*collection* (there is no `gamesCol`, no `runsCol`, no `user()`). Writing
`users/${uid}/games` here would create a second owner of the layout — exactly
what the repo rule forbids. So **every collection path is derived** from the
document path inside it, by dropping trailing segments (`up()`). There is one
string literal in the whole file: the `/` separator.

## Behaviour worth knowing (preserved, not fixed)

- **`listGames` / `listDeletedGames` filter tombstones IN MEMORY.** Firestore's
  `where('deletedAt','==',null)` does **not** match documents that lack the
  field, and absence is the normal state for every game created before soft
  delete existed — a server-side filter would hide all of them until a backfill.
  `functions/src/games/index.ts` does the same, with the same comment.
  **Consequence:** a page may hold fewer than `limit` items (even zero) while
  more pages remain. `nextCursor` is the only end-of-data signal. The cursor is
  taken from the last **raw** document, not the last surviving one — resuming
  from a filtered-out document would skip everything between it and the next
  survivor.
- **`getWallet` returns `null` for a missing wallet.** Today's `getWallet`
  *callable* creates a fresh one; that is policy (what an empty wallet looks
  like) and stays in the callable layer.
- **`listLiveRunsForOwner` does not exclude runs of tombstoned games.** A
  collection-group query cannot reach the parent game to filter on it; today's
  callable loads each game document afterwards to drop them. That enrichment
  stays in the caller.
- **`deleteGame` / `deleteRun` / `deleteProfile` delete the DOCUMENT only.**
  Firestore sub-collections outlive their parent document. Deleting a game
  touches five systems (subtree · `publicGames`/`publicTasks` · access codes ·
  Storage · audit) and `purgeGameTree` orchestrates all five; these methods are
  the last step, not the whole thing.
- **`appendAuditLog` stores the entry exactly as handed over.**
  `writeAuditLog` (`functions/src/obs/audit.ts`) mints the id with `.add()`,
  stamps `timestamp: new Date().toISOString()` itself, and normalises
  `teamName`/`previousValue`/`newValue` to `null` and `reason` to `''`. Rules 1
  and 2 forbid the clock and the id here; the normalisation is presentation
  policy and belongs with the caller that owns `AuditEntry`. Best-effort
  behaviour also stays in the caller (`auditBestEffort`) — swallowing the error
  here would also swallow a misconfiguration.
- **`listFinishedRunsBefore` is query A of the retention sweep only.** The
  sweep's query B (abandoned/stale runs by `createdAt`) is a different named
  shape the interface does not have; a caller driving the full prune composes
  both. Adding B silently would widen what a Postgres implementation must
  promise.

## New index requirements

These query shapes do not exist in `functions/src` today and need composite
indexes before use:

- `auditLogs` (`runId`, `timestamp desc`) — `listAuditLogsForRun`
- `auditLogs` (`ownerUid`, `timestamp desc`) — `listAuditLogsForOwner`
- `accessCodes` (`ownerUid`, `gameId`, `runId`) — `listAccessCodesForRun`
  (the `ownerUid`+`gameId` pair already exists for `gameAccessCodes`)

The `runs` collection-group indexes used by `listLiveRunsForOwner` and
`listFinishedRunsBefore` already exist.

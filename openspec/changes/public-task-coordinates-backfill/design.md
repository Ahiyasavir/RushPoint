## Context

`task-library-map-view` split the public-task location problem in half and solved one half:

| Half | Status |
|---|---|
| **Write path** — `publishGame` must stop copying `task.coordinates` into `publicTasks` | Done there. `publicTaskLocation(task)` decides; `hideLocation` / `locationless` / unplaced ⇒ no key written. |
| **Already-stored documents** — every task published before that fix | **Untouched.** Explicitly deferred and recorded as residual risk. |

The deferred half is this change. Three facts fix its shape, all verified by reading the code rather
than assumed:

| Question | Answer, verified |
|---|---|
| Does a `publicTasks` document say whether its task hides its location? | **No.** The publish projection (`functions/src/games/index.ts`) never denormalised `hideLocation` or `locationless`. The stored document carries title, type, difficulty, points, tags — and, on legacy documents, `coordinates`. |
| Can a legacy document be identified from its own fields? | **Yes** — by the presence of the deprecated `coordinates` key. The current `publishGame` never writes it, so its presence *is* the marker of a pre-fix write. |
| Who can read the collection? | Anyone. `firestore.rules` — `allow read: if true`, no auth. |

So the sweep can find the documents it must repair on its own, but it cannot decide **what to write
instead** without going back to the source of truth.

## Goals / Non-Goals

**Goals**
- Bring every stored `publicTasks` document under the location contract `publishGame` now enforces.
- Keep the *decision* pure, shared and unit-tested; keep the I/O in `functions/` and thin.
- Make the job safe to run against real data: admin-gated, dry-runnable, resumable, idempotent.

**Non-Goals**
- No change to the contract itself, to `publishGame`, or to any client surface.
- No scheduled trigger. This is an operator's tool with a finite job.
- No new index, no rules change, no env var.

## Decisions

### D1 — The repair rule reads the **authored task**, not the public document

`repairPublicTask(doc, sourceTask)` takes two arguments because one is not enough. A `publicTasks`
document carries no `hideLocation` and no `locationless` flag, so from the document alone these two
cases are **indistinguishable**:

- an ordinary task whose exact point should become a ~1 km area, and
- a hidden-location task whose exact point must become **nothing**.

Coarsening both would be the wrong answer for exactly the tasks the original leak hurt most — the
ones whose entire design contract is that the location is the puzzle. Publishing nothing for both
would silently blank the mission library map for every legacy task. So the sweep resolves each
document's owning game (`users/{ownerUid}/games/{sourceGameId}`), finds the authored task, and hands
it to the rule, which delegates the actual decision to the **same** shared
`publicTaskLocation(task)` the write path uses. One rule, two call sites, no drift.

### D2 — **Fail closed** when the source cannot be found

If the owning game is gone, unpublished, or the task has been deleted from it, `sourceTask` is
`null` and the rule returns `{}` — strip the exact point, publish no area:

```ts
if (!sourceTask) return {};   // cannot prove it was ever publishable ⇒ publish nothing
```

The asymmetry is the whole argument. A wrongly-cleared location costs a marker on a browse map and
is repaired by the owner re-publishing. A wrongly-**kept** location is an exact GPS point in an
unauthenticated collection, possibly for a task whose location was meant to be secret, and it cannot
be un-leaked. The sweep also counts these separately (`orphaned`) so the operator can see how much
of a run took the pessimistic branch rather than having it hidden inside `repaired`.

### D3 — Scan the collection; do **not** try to query for the field

The natural instinct is `where('coordinates', '!=', null)` or the `orderBy('coordinates')` trick
(documents missing an ordered field are excluded from the result). Both were rejected:

- Firestore has **no field-exists filter**. `!=` on a missing field does not match, which is the
  right semantics by accident, but it is still an inequality that needs the field indexed.
- The `orderBy` approximation would need a **dedicated single-field index on `publicTasks.coordinates`**
  — an index we would create, ship, pay to maintain, and then have to remember to remove, for a job
  that runs a handful of times *ever* and whose whole purpose is to make the field stop existing.
- A scan also catches documents whose `coordinates` value is **malformed** (a string, a partial
  object, an out-of-range number). Those are still a stored field in a public document, and an
  index-backed query on a broken value is exactly where such a document would slip through.

So: `db.collection('publicTasks').orderBy('__name__').limit(n)` — order by document id, which is
always indexed, filter in memory. The cost is one read per public task, once. The reads are bounded
per call by `limit` and each page is committed in a single batch.

Owning games are read **once per game per page** and cached in a `Map`, so a game with 30 published
tasks costs one game read, not thirty.

### D4 — Presence of `coordinates` is the entire repair test

```ts
if (doc.coordinates === undefined || doc.coordinates === null) return null;   // conformant, skip
```

`null` from the rule means "already conformant — write nothing". This is what makes the sweep
idempotent, and idempotence is what makes it safe to run again after a timeout, a partial page, or
an operator losing track of the cursor. A repaired document no longer has the key, so the second
pass skips it and reports `repaired: 0`. The e2e scenario asserts exactly that.

Note the value is never parsed to decide whether to repair. An unparseable legacy value is still a
stored field in a world-readable document, so it is still repaired (and, because the authored task
is the authority, still repaired to the *correct* replacement).

### D5 — Delete the field, do not null it

The write is `batch.update(ref, { coordinates: FieldValue.delete(), approxLocation: area ?? delete })`.
Writing `null` would leave `coordinates` as a **present** field, which D4 reads as "still legacy" —
the sweep would repair the same documents on every run and never converge. Deleting is also what
makes the stored document byte-shaped like one the current `publishGame` produces.

`approxLocation` is written **or deleted** in the same update, never left alone. That is what clears
a stale area from a task that has since become `hideLocation`: the doc may carry both a legacy point
and an old area, and both must go.

`.update()` with a `FieldValue.delete()` sentinel is the correct tool here — the codebase's
`.set({merge}) + dotted key` footgun does not apply (no dotted keys, no arrays are touched).

### D6 — The public document id is `${gameId}_${taskId}`, recovered by prefix

To find the authored task, the sweep needs the task id back out of the composite document id. It
strips the `${sourceGameId}_` **prefix** rather than splitting on `_`, because a task id may itself
contain an underscore and `split('_')[1]` would silently resolve to the wrong task — or to nothing,
which under D2 fails closed and blanks a location that did not need blanking.

### D7 — Operational shape: admin-only, paged, dry-runnable

`backfillPublicTaskCoordinatesNow` lives in `functions/src/maintenance/index.ts` beside the other
platform-maintenance callables (`pruneExpiredRunDataNow`, `purgeDeletedGamesNow`, `pruneRunNow`) and
uses the same `assertAdmin` gate — which has **no emulator bypass**; the e2e suite mints a real
`admin` custom-token claim, so the test hits the same gate production does.

- `limit` (default 500, clamped to 1..1000) + `startAfter` → the response's `cursor` and `done` flag
  let an operator walk a large library in bounded chunks instead of one timeout-prone pass.
- `dryRun: true` performs every read and every decision and commits nothing, so the operator sees
  `scanned` / `repaired` / `cleared` / `orphaned` before authorising a write.
- It is deliberately **not** attached to the daily `pruneExpiredRunData` schedule. Unlike retention
  pruning and trash purging, this job has a finite amount of work and then nothing to do forever;
  a daily full-collection scan to find zero documents is pure cost.

## Files to touch

| File | Change |
|---|---|
| `packages/shared/src/publicTaskBackfill.ts` | **New.** `repairPublicTask` + `BackfillSourceTask` / `BackfillPublicTaskDoc` / `PublicTaskRepair` types. Pure. |
| `packages/shared/src/publicTaskBackfill.test.ts` | **New.** The RED tests. |
| `packages/shared/src/index.ts` | Re-export the new module. |
| `functions/src/maintenance/publicTaskBackfill.ts` | **New.** `backfillPublicTaskCoordinates` — the paged sweep (all the I/O). |
| `functions/src/maintenance/index.ts` | **New callable** `backfillPublicTaskCoordinatesNow`, `assertAdmin`-gated. |
| `functions/src/index.ts` | Re-export the callable. |
| `scripts/e2e-verify.mjs` | New scenario + a row in the authz denial matrix. |

Firestore paths come from `FIRESTORE_PATHS.game(...)`. `publicTasks` is addressed as a top-level
collection scan (there is no `FIRESTORE_PATHS` helper for "the whole collection").

## Test strategy

**Pure logic — `packages/shared/src/publicTaskBackfill.test.ts` (vitest, in the existing `npm test`
lane, no emulator). Written first, run, confirmed RED.** The decision rule is separated from the
I/O precisely so that every branch is reachable without a database:

- *Which documents need fixing*: a doc with no `coordinates` ⇒ `null` (skip — the idempotence
  property); a doc with `coordinates` ⇒ not null; an **unparseable** `coordinates` value still
  counts as present and is still repaired.
- *What replaces the point*: an ordinary placed task ⇒ the coarsened cell centre, and asserted
  **not equal** to the authored point so a pass-through implementation fails; `hideLocation` ⇒ `{}`
  (the headline test); `locationless`, `(0, 0)`, and absent coordinates ⇒ `{}`.
- *Fail closed*: `sourceTask` `null` **and** `undefined` ⇒ `{}`.
- *Stale area cleared*: a doc carrying both a legacy point and an `approxLocation`, whose task is now
  `hideLocation` ⇒ `{}` with no `approxLocation` key.

**Callable behaviour — a new scenario in `scripts/e2e-verify.mjs` (`npm run e2e`).** A new callable
means the suite's coverage guard fails until it is invoked, so this is an obligation, not a bonus.
The scenario cannot manufacture a genuine pre-fix publish (the current code never writes
`coordinates`), so it publishes a real game containing one ordinary and one `hideLocation` task via
the real `publishGame`, then **injects** the deprecated exact field onto those documents with the
Admin SDK — the same technique `pruneRunNow`'s own setup uses for writes no client could make. It
then asserts:

1. `dryRun` reports work to do and leaves the legacy field untouched.
2. The real sweep deletes `coordinates` from **both** documents.
3. The ordinary task gains an `approxLocation` that is **not** the authored point and is within
   ~1 km of it.
4. **The headline:** the `hideLocation` task ends up with **no** `approxLocation` and **no**
   `coordinates` — and is still listed, title intact.
5. A second sweep reports `repaired: 0` (idempotence).

Plus a row in the **authz denial matrix**: a plain run owner calling
`backfillPublicTaskCoordinatesNow` is denied.

**UI.** None. No component, no string, no dictionary key is touched, so `npm run i18n:check` has
nothing to say about this change — it is still run as part of the gate set, but it is not the
verification of anything here.

## Residual risk

- **A legacy document whose owning game is gone loses its map pin.** Deliberate (D2). Re-publishing
  restores it. The `orphaned` counter makes the size of this visible per page rather than silent.
- **The sweep must actually be run in production.** Shipping the callable changes nothing on its
  own; this change is only finished when an operator has walked the cursor to `done: true` against
  the real project. Until then the exposure is exactly what it was.
- **Documents with no `ownerUid`/`sourceGameId`** cannot be resolved to a game at all and take the
  fail-closed branch. That is the correct outcome, but it means such documents can never be given an
  area by this job — only by their owner re-publishing.

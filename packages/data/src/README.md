# `@rushpoint/data` — implementing the repository

This package is **types only**. It contains no queries, no SQL, no Firebase, and
no runtime logic beyond two tiny helpers (`ok` / `refused`) and one symbol
(`DELETE`). Its job is to describe RushPoint's entire data access surface
precisely enough that two very different backends can implement it and behave
identically.

```
src/types.ts        domain types (re-exported from @rushpoint/shared) + Patch/DELETE + scopes + errors
src/transaction.ts  the unit-of-work contract — READ THIS FIRST
src/repository.ts   generic CRUD, named query reads, and sweeps, by aggregate
src/atomic.ts       the invariant-bearing operations
```

## Reading order

1. `transaction.ts` — the five rules. Everything else assumes them.
2. `atomic.ts` — the operations that carry the app's correctness.
3. `repository.ts` — the boring majority.

---

## The rules an implementation MUST honour

### 1. Never invent a timestamp

There is no `serverTimestamp()` anywhere in RushPoint and there must not be one
here. Every instant is a caller-supplied ISO-8601 string parameter. Store
exactly what you were handed. If you find yourself calling `new Date()` inside
an implementation, the method signature is wrong — add the parameter.

Two reasons, both load-bearing:

- A Firestore transaction body may re-execute. A clock read inside it produces a
  different value each attempt.
- Every scoring and ranking decision in this app is a pure function of stored
  values. A server-generated timestamp makes those functions untestable.

### 2. Never mint an id

Same reason. Ids come from the caller. A retried transaction that minted its own
id would orphan the one the first attempt created.

### 3. ABSENT ≠ NULL ≠ DELETE

`Patch<T>` is three-valued and the distinction is real, not pedantic:

| in the patch object | means | Firestore | Postgres |
| --- | --- | --- | --- |
| field not present | leave the stored value alone | omit from the update | omit from the `SET` list |
| field present, value `null` | store a real null | write `null` | `SET col = NULL` |
| field present, value `DELETE` | remove the field | `FieldValue.delete()` | `SET col = NULL` |

`Game.safeZone?: SafeZone | null` is the canonical case: `undefined` means "the
Builder did not send this field", `null` means "the creator removed the
boundary". Collapsing them silently un-clears safe zones.

Firestore-specific trap: the Admin SDK is configured with
`ignoreUndefinedProperties: true`, so writing `{ safeZone: undefined }` is a
**silent no-op**, not a clear. That setting is exactly why `DELETE` must be an
explicit token and never a convention around `undefined`.

Postgres note: a SQL implementation genuinely cannot distinguish "field absent"
from "column NULL" at rest, and it does not have to. The distinction only has to
survive the *patch*, not the *row*. Every caller that needs "cleared" vs "never
set" already carries a companion flag in the domain type.

### 4. Patches are shallow, and there are no dotted paths

A nested object value REPLACES the stored object wholesale. There is no merge
syntax and no dotted key on this interface, because:

- `.set({merge:true})` with a dotted key writes a **literal top-level field
  named `"a.b"`**, not a nested path. This has shipped as a bug in this repo.
- `.update()` with a dotted key into an **array element** coerces the array to a
  map and breaks the run. This has also shipped as a bug.
- Task ids and tag names are opaque user-influenced strings and are not safe as
  field paths at all.

When you need to change one element of a nested collection, there is a named
method (`patchTaskRecord`, `patchStageRecord`, `applyFeedReaction`, …). Use it.

### 5. `RunTeam.stages[]` is addressed by key, never by index

`RunTeam.stages[] -> RunStageRecord.tasks[] -> RunTaskRecord` is one document
today and will be two tables later. Every write is addressed by
`(stageId, taskId)`. The Firestore implementation does the nested
read-modify-rewrite **inside** the repository; the SQL implementation is a
single-row `UPDATE`. Nothing above this layer may index `stages[i]` in order to
write.

Reading the whole team and computing over `stages` in memory stays fine — that
is what routing and scoring do, and Phase 1 does not change it.

### 6. `Game.stages[]` is an opaque blob

Phase 1 does not decompose the template. Routing loads the whole game and
filters in memory; scoring reads it the same way. `patchGame({ stages })`
replaces the array. There is deliberately no `getTask`, `updateTask` or
`listTasks` on the game side, and adding one now would stop Phase 1 being
behaviour-neutral. In Postgres, `stages` is JSONB.

### 7. There is no `taskCounts`

Station occupancy is **derived**: `count(teams where activeTaskId = :taskId)`.
The stored counter is gone, along with the reconciler it needed and the
slot-leak bug class it produced. `claimTaskSlot` expresses "count, decide and
claim" as ONE atomic step — never read-then-write.

- Firestore: use the existing `activeTaskId` index.
- Postgres: partial index on `run_team (run_id, active_task_id)
  WHERE active_task_id IS NOT NULL`.

Do not add a counter back "for performance" without measuring. The counter was
the single hottest write in the system: every assign and every release locked
the one run document, which is why `withLockRetry` exists with 8 attempts and
jittered backoff.

### 8. A refusal is a result; an error is an error

`Outcome<T, Reason>` carries the normal "no" answers: station full, already
paid, duplicate completion, run at capacity, token already used. Throw only
`DataError`, and only for the five codes in `types.ts`. Never throw an
`HttpsError`, a gRPC error or a Postgres error out of an implementation —
mapping a `DataError` onto a callable error code is the caller's job, which is
what lets the same repository back a callable, a script and a test.

### 9. Best-effort methods must not be able to fail their caller

`bumpPublicSignals`, `bumpTagStats` and `appendAuditLog` are called from paths
where a failure must not fail the user's action. They return results rather than
throwing for a missing target. Do not "improve" them into throwing methods; the
caller would need a `try/catch` that also swallows real errors.

### 10. Sweeps are bounded and resumable, never transactional

Every method on `SweepRepository` takes a `SweepBudget` and returns a
`SweepResult` with a cursor. Honour `maxDocs`.

- Firestore: a `WriteBatch` is capped at 500 operations. Commit in chunks of
  450 (`MAX_BATCH_OPS`). Never hand-roll a batch loop.
- Postgres: `DELETE ... WHERE ... LIMIT` in a loop, one statement per chunk.

A sweep must never be called inside `runInTransaction`.

---

## Implementing a transaction

```ts
const nowIso = new Date().toISOString();      // OUTSIDE — rule 1
const alertId = newId();                      // OUTSIDE — rule 2

const outcome = await repo.runInTransaction(async (tx) => {
  const r = repo.withTx(tx);

  const run = await r.getRun(scope);          // read...
  if (!run) throw new DataError('not-found', 'run');
  if (run.status === 'finished') return { skipped: true };

  await r.patchRun(scope, { status: 'finished', finishedAt: nowIso });
  await r.putAlert(scope, { id: alertId, /* … */ });

  return { skipped: false, accessCode: run.accessCode };   // the ONLY way out
}, { label: 'finalizeRun', maxAttempts: 8 });

if (!outcome.skipped) await notifyEveryone(outcome.accessCode);  // AFTER commit
```

What makes that body legal:

- no clock, no id generation, no randomness inside it;
- nothing outside `tx` is mutated or called;
- every document written was first read through the same `tx`;
- the post-commit side effect is driven by the return value, not performed
  inline.

### The Firestore implementation

`runInTransaction` maps onto `db.runTransaction`, with `maxAttempts` and the
existing jittered backoff. `withTx(tx)` returns the same method surface with
every read routed through `tx.get` and every write through `tx.set/update`.

Watch for two Firestore-specific constraints the contract already accommodates:

- **All reads must precede all writes** in a transaction. Because bodies are
  required to read before they write anyway (rule 4 of `transaction.ts`), a
  conforming body already satisfies this. An implementation may buffer writes
  until the body returns.
- **No read-your-writes.** `tx.get` after `tx.set` on the same document returns
  the pre-transaction value. The contract forbids relying on either behaviour;
  you may throw `failed-precondition` if a body does it.

### The Postgres implementation

`runInTransaction` maps onto `BEGIN … COMMIT`. Bodies run once, which is a
special case of "one or more times", so a conforming body is already correct.

Use `SELECT … FOR UPDATE` on the documents the body reads, so "read before
write" gives you the row locks the Firestore version gets from conflict
checking. Map a serialization failure onto `DataError('contended')` and let
`maxAttempts` retry it — this is safe precisely because bodies are idempotent.

Most atomic methods collapse into one statement:

```sql
-- consumeStaffInvite
UPDATE staff_invite SET used_at = $now, used_by = $uid
 WHERE run_id = $run AND id = $invite AND used_at IS NULL
 RETURNING *;

-- claimTaskSlot's cap check, per candidate
SELECT count(*) FROM run_team
 WHERE run_id = $run AND active_task_id = $task;
```

---

## Testing an implementation

The contract is designed to be testable without either backend:

- Every "decide" is a **pure function parameter** — `SlotChooser`,
  `computeCost`, `clamp`, `merge`, `recompute`, `carryForward`, `withinZone`,
  `step`, `repair`. Test the policy without a database.
- Every timestamp is a parameter. Test time-dependent behaviour without a clock.
- Every refusal is a return value. Assert on `reason`, not on a thrown message.

The properties worth testing against BOTH implementations:

1. `claimTaskSlot` never exceeds `capacity` under N concurrent callers.
2. `completeTeamTask` on an already-terminal record writes nothing and returns
   `completed: false`.
3. `chargeHint` charges exactly once across concurrent calls.
4. `joinRunWithCapacity` admits exactly `participantCap` teams, no more.
5. `claimOnceFlag` returns `claimed: true` to exactly one of N callers.
6. `creditWallet` with a repeated `idempotencyKey` credits once and reports
   `duplicate: true`.
7. A `Patch` with `DELETE` clears; a `Patch` omitting the field does not.
8. `releaseTaskSlot` is idempotent and never touches another team.

---

## Adding an operation

Adding a read means adding a **named method**. There is no query builder, on
purpose: a named shape is one index in Firestore and one index in Postgres, and
a DSL lets a caller invent a shape neither backend can serve — which surfaces in
production as a missing-index error.

Adding a mutation: ask whether it has an invariant that a caller could break by
decomposing it into read-then-write. If yes, it belongs in `atomic.ts` with a
name that states the invariant and a doc comment that states what happens when
two callers race. If no, it is a `patch*` on the aggregate.

## Known gaps this interface deliberately closes

Two behaviours differ from today's Firestore code, both strengthenings:

- **`replacePublicTasksForGame`** deletes published rows for tasks the creator
  removed. `publishGame` currently upserts the current set and leaves stale
  world-readable rows behind forever.
- **`launchRunBilled`** treats the access code as a uniqueness constraint rather
  than a pre-check followed by a blind write.

Anything else that differs from today's behaviour is a bug in this interface.
Phase 1 is behaviour-neutral.

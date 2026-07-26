# `teams.ts` — the hot path, row-shaped over a nested array

Implements `TeamRepository` (`../repository.ts` §6): the team aggregate and its
nested stage/task records. This is the hottest and most correctness-critical part
of the migration, and the only aggregate whose **storage shape actually changes**.

```
TODAY      …/runs/{runId}/teams/{teamId} is ONE document.
           RunTeam.stages[] -> RunStageRecord.tasks[] -> RunTaskRecord
           is a nested array inside it, rewritten WHOLE on every write.

LATER      run_team + run_team_stages + run_task_records rows, keyed by
           (run_id, team_id, stage_id, task_id). One task update = one
           single-row UPDATE.
```

The interface is written in the **second** shape — every nested write is
addressed by `(stageId, taskId)`, never by array index. This file is where the
two shapes meet: it presents the row-shaped API and performs the nested
read-modify-rewrite internally.

## Construction / wiring

Same injected context as `repository.ts`: a `FirestoreContext` (the
already-initialised `db` plus the `deleteSentinel` factory) and an I/O seam. No
`firebase-admin` import, per `context.ts`.

```ts
new FirestoreTeamRepository(ctx, io)          // io: the same object repository.ts calls `Io`
createFirestoreTeamRepository({ db, deleteSentinel })   // standalone
```

`TeamIo` is **structurally identical** to `repository.ts`'s private `Io`, so the
composed repository can pass its own `io` with no cast and no adapter. It is
re-declared rather than imported only because `Io` is not exported. **If `Io` is
ever exported, delete `TeamIo` and import it** — the two must never drift, since
"the signature is identical inside and outside a transaction" depends on it.

Not yet referenced by `repository.ts` (its team methods still `notImplemented`);
wiring is a separate, deliberate step.

## Methods

| Method | Notes |
| --- | --- |
| `getTeam` / `putTeam` / `patchTeam` / `deleteTeam` | `putTeam` locates itself from the team's own `ownerUid`/`gameId`/`runId`/`id`. `deleteTeam` is the document only. |
| `listTeams` | Paged, ordered by `id` asc. |
| `listAllTeams` | Unpaged; bounded by `Run.maxParticipants` (enforced transactionally in `joinRun`). |
| `listTeamsAtTask` / `countTeamsAtTask` / `countTeamsAtTasks` | Station occupancy, derived from the `activeTaskId` mirror. |
| `getStageRecord` / `patchStageRecord` | By `stageId`. |
| `getTaskRecord` / `patchTaskRecord` | By `(stageId, taskId)`. |
| `replaceTeamStages` | Whole-tree rebuild — run build, `startTeams`, `skipStage`. |
| `rewriteStages` *(not on the interface)* | The internal seam every nested write goes through; the eventual `atomic.ts` team operations build on it. |

## The translation, in one place

`rewriteStages(scope, what, mutate)` is the only nested write path:

1. **Whole-array rewrite, never a dotted path.** The write is
   `.update({ stages })`. `.update({'stages.0.tasks.0': x})` coerces the array
   into a map and destroys a run in progress — a footgun this repo has shipped
   (CLAUDE.md, `patch.ts`, README rule 3). Keeping the rewrite *inside* the
   repository is what stops it ever reaching a call site again.
2. **The deep clone happens per attempt**, inside the callback — byte-for-byte
   the `stages.map((s) => ({...s, tasks: s.tasks.map((t) => ({...t}))}))` that
   opens `completeTaskForTeam`, `skipStage` and `skipTaskForTeam`. A Firestore
   transaction body may re-execute; mutating the snapshot's own object would let
   attempt N+1 compute from attempt N's half-applied state.
3. **Patch semantics are `patch.ts`'s**, via `applyPatchInMemory` — absent /
   value (incl. a real `null`) / `DELETE`. Not reimplemented here; that is how
   nested and top-level patches would drift.
4. **Side-effect data leaves by return value, never by closure.** See below.

## The `skippedHeldTaskIds` reset idiom — preserved, and why it dies quietly

`completeTaskForTeam`, `skipStage` and `skipTaskForTeam` all do this:

```ts
let skippedHeldTaskIds: string[] = [];
await db.runTransaction(async (tx) => {
  skippedHeldTaskIds = [];            // ← FIRST statement in the body
  … push ids of tasks auto-skipped while still 'assigned' …
});
for (const id of skippedHeldTaskIds) await releaseTask(id, …);
```

**Why the reset exists:** the body re-executes on contention and re-derives the
same ids. Without the reset at the *top* of the body, attempt 2 appends to
attempt 1's list and the post-commit loop releases every station slot **twice** —
the double-release / slot-leak class this repo has shipped before (a counter
drained below real occupancy hands a full station out again).

**Why it becomes unnecessary — but harmless — under SQL:** a Postgres transaction
body runs exactly once, so there is no second append to guard against. The reset
becomes inert, not wrong.

Rather than rely on that, `rewriteStages` removes the hazard **structurally**:
the mutator *returns* its side-effect data and `rewriteStages` returns it onward,
so there is no outer accumulator to reset and no way to write the accumulating
version. This also matches the transaction contract, where the return value is
the only channel out of a body that may re-run.

## Ordering inside a transaction

Every nested-record method is a **read followed by a write**, so inside a
`runInTransaction` body it must be called **before any other write in that body**
(Firestore requires all reads to precede all writes). This is not a quirk of this
class — it is precisely why the `atomic.ts` operations exist: they bundle read,
decision and write into one step so a caller cannot interleave them wrongly.

`replaceTeamStages` is the exception: a blind overwrite, no read, legal anywhere.

## Preserved oddities

- **Records are found by KEY, never by `taskIndex`.** `RunTaskRecord.taskIndex`
  is stored and is an index into `Stage.tasks`, but nothing uses it for lookup —
  `team.stages` is sorted by `order` while `game.stages` keeps the Builder's
  array order, so the index spaces diverge and a positional lookup scores the
  wrong task. Today's code comments this at both sites it matters.
- **Two disagreeing records of "this team is on that task."** The `activeTaskId`
  mirror on the team document, and the task record's `status === 'assigned'`.
  They can diverge: `skipTaskForTeam` explicitly handles a stale mirror pointing
  at nothing, and `completeTaskForTeam` accepts *either* as proof of a held slot
  (`team.activeTaskId === taskId || taskRec.status === 'assigned'`). The
  occupancy reads here consult only the **mirror**, exactly as the one such query
  in `functions/src/index.ts` does, because a nested array element is not
  queryable in Firestore. Consequence: occupancy can under-count a team whose
  mirror was cleared while its record still says `assigned`. In the row model the
  same question becomes a `WHERE` over `run_task_records` and the two sources
  collapse into one — **that is a behaviour change and must be made deliberately,
  not as a side effect of the port.**
- **`listAllTeams` is unpaged**, matching `listRunTeams` / `startTeams` /
  `finalizeRun` / `refreshLeaderboard`. Safe by construction, not by hope:
  `Run.maxParticipants` is a hard ceiling fixed at launch.

## Decisions worth reviewing (flagged rather than guessed silently)

1. **`updatedAt` is NOT stamped by any record patch.** Every write path in
   `functions/src/runs/index.ts` writes `updatedAt: now` alongside `stages`, but
   no signature here takes a `now`, and rule 1 forbids inventing a timestamp. A
   caller that needs the field fresh must add `patchTeam(scope, { updatedAt })`
   in the same transaction, or use the atomic completion operation once it
   exists (which takes `now` and should own the stamp). **This is the divergence
   most likely to surface as "the console shows a stale team".**
2. **`patchTaskRecord` / `patchStageRecord` throw `not-found` for a missing
   record; today's grading path silently no-ops** (`if (stageIdx < 0) return
   {completed:false}`). That no-op is a *policy* the callable makes about a
   duplicate or racing submission, with the whole team state in hand. At this
   layer "the record you named does not exist" is a fact, and swallowing it would
   make a mis-keyed write look successful. The callable keeps its no-op by asking
   first (`getTaskRecord`) or by using the atomic operation.
3. **`get*` does not distinguish a missing team from a missing record** — both
   return `null`, which is the `get` idiom on this interface. The write paths
   take the opposite stance and refuse a missing team with `not-found` (rule 2).
   Call `getTeam` when the difference matters.
4. **`listTeams` orders by `id` ascending.** `RunTeam` has **no creation
   timestamp** — `joinRun` writes only `updatedAt`, which every completion
   rewrites, so ordering by it would move a team between pages mid-race and a
   keyset cursor would skip or repeat rows. `id` is immutable, stored, and equals
   the document id (`teamId == the participant's uid`), so this is byte-for-byte
   Firestore's implicit `__name__` order — the order today's unordered reads
   already see. If a `createdAt`/`joinedAt` is ever added, revisit.
5. **`countTeamsAtTask` uses the `count()` aggregate only OUTSIDE a
   transaction.** Inside one it counts materialised documents, because an
   aggregate issued through the query handle is **not part of the transaction's
   read set** — a count that reads outside the transaction it is deciding inside
   of is exactly how a station cap gets overshot. Team documents are large, so
   this is a real cost, paid on purpose.
6. **`countTeamsAtTasks` seeds every requested id with 0.** An absent key is
   indistinguishable from "unknown", and a caller reading `undefined` as *free*
   hands out a full station. The 0 is a derived answer, not a stub.
7. **Stricter than today at runtime:** `patchTeam` refuses a `stages` key;
   `patchTaskRecord` refuses `taskId`/`taskIndex`; `patchStageRecord` refuses
   `stageId`/`order`/`tasks`. All are already excluded at the type level, but a
   patch can arrive from a JSON round trip where the type is gone. In the row
   model these are (part of) the primary key, and `tasks` on a stage patch would
   be the whole-array write path the row model exists to remove.
8. **A team document with no `stages` array raises
   `DataError('failed-precondition')`** naming the team, where today it would be
   a raw `TypeError` from `.map` deep inside a transaction body. Same failure,
   made diagnosable, and rule 8 requires only `DataError` to escape.
9. **`in` queries chunk at 10 values.** The documented limit was 10 for years and
   is 30 on current backends; 10 runs against every deployment this project has
   targeted, including the pinned emulator. Raise it deliberately, with a
   version note.
10. **A no-op patch skips the READ as well as the write.** Inside a transaction
    an unnecessary read still joins the read set and widens the retry window — on
    the hottest document in the system that is a cost, not a micro-optimisation.

## Cursor encoding

`encodeCursor`/`decodeCursor` are duplicated from `repository.ts` (they are
module-private there). The encoding **must stay identical** across the whole
Firestore implementation, or a cursor from one paged read replayed through
another would be silently misparsed. Plain JSON rather than base64 for the same
reason as `repository.ts`: `btoa` needs `lib.dom`, `Buffer` needs `@types/node`,
and this package's real build config has neither.

## Index requirements

- `teams` (`activeTaskId`) — `listTeamsAtTask` / `countTeamsAtTask*`. A
  single-field index, so Firestore provides it automatically; the equality query
  already exists in `functions/src/index.ts`.
- `listTeams`' `orderBy('id')` is likewise single-field and automatic.

No composite index is introduced by this file.

## Gate

```
tsc --noEmit -p packages/data/tsconfig.check.json   → exit 0
```

`tsconfig.check.json` has `"include": ["src"]`, so this file is in the checked
set (verified with `--listFiles`, and by confirming an injected type error in
this file does fail the run).

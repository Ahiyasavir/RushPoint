// ─── The atomic operations, in SQL ───────────────────────────────────────────
//
// Each function here takes a queryable that is ALREADY INSIDE a transaction. The
// repository opens that transaction (`runInTransaction`), so an atom is atomic
// on its own — rule 1 of atomic.ts — and the same function body serves the
// "joined an enclosing transaction" case unchanged.
//
// A refusal is a RESULT (`refused('no-slot')`), never an exception. A thrown
// `DataError` means something is WRONG: the team does not exist, the task record
// the caller named is not in the tree. See atomic.ts rule 5 and README §8.

import { DataError, type RunScope, type StaffInvite, type TeamScope } from '../types';
import { ok, refused } from '../transaction';
import type { ClaimActiveTaskResult, ClaimTaskSlotResult, TaskSlotCandidate, SlotChooser } from '../atomic';
import type { SqlQueryable } from './client';
import { encodeArrayLiteral, rowToDomain } from './mapping';
import { toUuid } from './ids';
import { INVITE_COLUMNS } from './schema';


// ═══════════════════════════════════════════════════════════════════════════
// The once-flag latch — a GAP IN THE SHIPPED SCHEMA, named rather than hidden
// ═══════════════════════════════════════════════════════════════════════════
//
// `claimOnceFlag` is the false→true latch behind `Run.benchmarkContributed`,
// `Run.summaryEmailSent` and `RunTeam.profileRecorded`. atomic.ts is explicit
// that it is ONE method rather than three "because the invariant is identical
// and THE FLAG NAME IS DATA".
//
// `0001_core_schema.sql` has no column for any of the three, and no generic
// place to put a fourth. The obvious SQL shape the brief suggests —
// `UPDATE … SET flag = true WHERE id = $1 AND flag IS NOT TRUE RETURNING *` —
// therefore has nothing to target, and a flag name that is DATA cannot be a
// column name anyway without building SQL out of a string, which nothing in this
// implementation does.
//
// So the latch is a ROW, and the latch's atomicity is the PRIMARY KEY:
//
//     insert into data_once_flags (…) values (…) on conflict do nothing
//     returning 1;
//
// Exactly one caller inserts; everyone else conflicts and gets zero rows back.
// That is strictly stronger than a conditional UPDATE (there is no read at all,
// so there is no read-modify-write window even in READ COMMITTED), and it
// generalises to a flag name that is data.
//
// THIS TABLE IS NOT IN A MIGRATION. It belongs in one — the DDL is published
// below so a `0004_once_flags.sql` can be written by whoever owns
// `supabase/migrations/`. This implementation NEVER creates it: a repository
// that silently DDLs its own storage is how a schema stops being reviewable.
// If it is absent, the query fails and the error names it.

export const ONCE_FLAGS_TABLE = 'data_once_flags';

/**
 * The DDL this implementation requires and does not create.
 *
 * `team_id` is NOT NULL with a sentinel rather than nullable, because a NULL in
 * a primary key would make two run-scoped claims of the same flag distinct rows
 * — the exact opposite of a latch.
 */
export const ONCE_FLAGS_DDL = `
create table if not exists ${ONCE_FLAGS_TABLE} (
  run_id     text not null references runs (id) on delete cascade,
  -- All-zero uuid = "this latch is on the RUN, not on a team".
  team_id    uuid not null default '00000000-0000-0000-0000-000000000000',
  flag       text not null,
  claimed_at timestamptz not null,
  primary key (run_id, team_id, flag)
);
alter table ${ONCE_FLAGS_TABLE} enable row level security;
`;

const RUN_SCOPED_TEAM = '00000000-0000-0000-0000-000000000000';


// ═══════════════════════════════════════════════════════════════════════════
// A1. Station slots
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The advisory-lock key for one (run, task) station.
 *
 * `hashtextextended` is a core function (PG 11+) and is IMMUTABLE, so the same
 * (run, task) always maps to the same bigint on every connection and every node
 * — which is the entire requirement for an advisory lock to serialise anything.
 * The NUL separator is what stops `('run-1','a-b')` and `('run-1a','b')` from
 * colliding by concatenation.
 */
const STATION_LOCK_SQL =
  `select pg_advisory_xact_lock(hashtextextended($1::text || E'\\x01' || $2::text, 0))`;

/**
 * Count occupancy, let `choose` pick, and claim — one atomic step.
 *
 * ── THE LOCKING DECISION, and why it is not `SELECT … FOR UPDATE` on the run ──
 *
 * There is no stored counter to increment (README §7: `Run.taskCounts` is GONE,
 * along with the reconciler it needed and the slot-leak bug class it produced).
 * Occupancy is DERIVED:
 *
 *     select count(*) from run_task_records
 *      where run_id = $1 and task_id = $2 and status = 'assigned'
 *
 * A derived count means "count, decide, claim" has a read-modify-write window
 * that MVCC will not close for us: under READ COMMITTED two concurrent claimers
 * both see occupancy 1 against a capacity of 2… and against a capacity of 1 they
 * both see 0. SERIALIZABLE would catch it, but only by aborting one transaction
 * with 40001, which turns a routine assignment into a retry storm on the hottest
 * path in the system. So the mutual exclusion has to be explicit.
 *
 * TWO CANDIDATE LOCKS:
 *
 *   (a) `select … from runs where id = $1 for update`
 *       Correct, and one line. But it takes a lock on the RUN row, so EVERY
 *       assignment anywhere in the run serialises behind every other one —
 *       including two teams claiming two completely different stations. That is
 *       precisely the failure mode the stored counter had: `Run.taskCounts`
 *       lived on the run document, every assign and every release locked that
 *       one document, and `withLockRetry` exists with 8 attempts and jittered
 *       backoff because at ~20 synchronised teams the queue got deep enough for
 *       Firestore to give up with a lock timeout. Re-introducing a run-wide lock
 *       would carry that contention across the migration having deleted the data
 *       structure that caused it.
 *
 *   (b) `pg_advisory_xact_lock` keyed on (run_id, task_id)   ← CHOSEN
 *       Contention scopes to the contested STATION. Two teams racing the same
 *       last slot serialise; twenty teams spreading across twenty stations do
 *       not interact at all. The lock is transaction-scoped, so it is released
 *       by COMMIT or ROLLBACK with no unlock path to forget — the advisory-lock
 *       equivalent of the slot leak is structurally impossible.
 *
 * WHAT (b) COSTS, stated honestly:
 *   * Hash collisions. Two different (run, task) pairs can map to one bigint.
 *     The consequence is EXTRA SERIALISATION between two unrelated stations —
 *     never a cap breach, never a lost claim. A collision cannot corrupt
 *     anything because the lock is not the invariant; the count inside it is.
 *   * It only protects code that TAKES it. Any other writer of
 *     `run_task_records.status = 'assigned'` must take the same lock or the
 *     guarantee is void. Today that is this function and `claimActiveTask`
 *     (which is uncontested by construction — it is the single-candidate path —
 *     and so takes the lock for its one task).
 *
 * MULTIPLE CANDIDATES ⇒ MULTIPLE LOCKS ⇒ DEADLOCK RISK. Locks are taken in
 * SORTED task-id order, so any two transactions acquiring an overlapping set do
 * so in the same order and no cycle can form. This is the one non-obvious line
 * in the function and it is the reason the sort is not "for tidiness".
 */
export async function claimTaskSlot(
  q: SqlQueryable,
  scope: TeamScope,
  args: { stageId: string; candidates: TaskSlotCandidate[]; choose: SlotChooser; now: string },
): Promise<ClaimTaskSlotResult> {
  const teamUuid = toUuid(scope.teamId);

  // ── 1. Lock every contested station, in a globally consistent order. ──────
  const taskIds = args.candidates.map((c) => c.taskId).slice().sort();
  for (const taskId of taskIds) {
    await q.query(STATION_LOCK_SQL, [scope.runId, taskId]);
  }

  // ── 2. The team must exist. A missing aggregate is an ERROR, not a refusal. ─
  //      `for update` also takes the row lock this claim's write needs: the
  //      lock order in this file is ALWAYS advisory-station → team-row, so two
  //      claims can never deadlock against each other.
  const team = await q.query<{ n: number }>(
    `select 1 as n from run_teams where run_id = $1::text and id = $2::uuid for update`,
    [scope.runId, teamUuid],
  );
  if (team.rows.length === 0) throw new DataError('not-found', 'team', { ...scope });

  // ── 3. "the claim is rejected if [the active stage] moved" — a REFUSAL. ────
  const stage = await q.query<{ status: string }>(
    `select status from run_team_stages
      where run_id = $1::text and team_id = $2::uuid and stage_id = $3::text`,
    [scope.runId, teamUuid, args.stageId],
  );
  if (stage.rows.length === 0 || stage.rows[0].status !== 'active') return refused('no-slot');

  // ── 4. Derived occupancy. An entry for EVERY candidate, uncapped included. ─
  const counts = await q.query<{ task_id: string; n: number }>(
    `select task_id, count(*)::int as n
       from run_task_records
      where run_id = $1::text and task_id = any($2::text[]) and status = 'assigned'
      group by task_id`,
    [scope.runId, encodeArrayLiteral(taskIds, 'claimTaskSlot.candidates')],
  );
  const occupancy = new Map<string, number>();
  for (const c of args.candidates) occupancy.set(c.taskId, 0);
  for (const row of counts.rows) occupancy.set(row.task_id, Number(row.n));

  // ── 5. The caller's PURE chooser decides; this function enforces the cap. ──
  const chosenId = args.choose(occupancy);
  if (chosenId === null) return refused('no-slot');
  const candidate = args.candidates.find((c) => c.taskId === chosenId);
  if (!candidate) return refused('no-slot');
  const occupancyBefore = occupancy.get(chosenId) ?? 0;
  if (candidate.capacity !== null && occupancyBefore >= candidate.capacity) {
    return refused('no-slot');
  }

  // ── 6. Claim. `activeTaskId` and the task record move TOGETHER, because
  //      under the derived model they are the same fact and cannot be allowed
  //      to drift (that drift IS the slot leak).
  const claimed = await q.query(
    `update run_task_records
        set status = 'assigned', started_at = $4::timestamptz, updated_at = $4::timestamptz
      where run_id = $1::text and team_id = $2::uuid and task_id = $3::text
        and stage_id = $5::text`,
    [scope.runId, teamUuid, chosenId, args.now, args.stageId],
  );
  if ((claimed.rowCount ?? 0) === 0) {
    throw new DataError('not-found', 'task record', { taskId: chosenId, stageId: args.stageId });
  }
  await q.query(
    `update run_teams set active_task_id = $3::text, updated_at = $4::timestamptz
      where run_id = $1::text and id = $2::uuid`,
    [scope.runId, teamUuid, chosenId, args.now],
  );

  return ok({ taskId: chosenId, occupancyBefore });
}


/**
 * Release this team's hold on `taskId`.
 *
 * Idempotent and TEAM-LOCAL, both enforced by the WHERE clauses rather than by a
 * prior read:
 *   * the record returns to `unassigned` only `if status = 'assigned'`, so a
 *     record that already reached a terminal status is left alone;
 *   * `active_task_id` is cleared only `if active_task_id = $taskId`, so a team
 *     that has since been assigned elsewhere is not un-assigned;
 *   * both are scoped to THIS team, so releasing a slot you do not hold cannot
 *     free someone else's.
 *
 * There is no counter to over-decrement, so the "never go negative" guard the
 * old `releaseTask` needed has no analogue here — the bug class is gone, not
 * handled.
 */
export async function releaseTaskSlot(
  q: SqlQueryable,
  scope: TeamScope,
  args: { taskId: string; now: string },
): Promise<{ released: boolean }> {
  const teamUuid = toUuid(scope.teamId);
  // The team row lock is taken FIRST here and LAST in the claim paths, and the
  // two never want each other's other lock, so no cycle exists between them.
  const team = await q.query<{ n: number }>(
    `select 1 as n from run_teams where run_id = $1::text and id = $2::uuid for update`,
    [scope.runId, teamUuid],
  );
  if (team.rows.length === 0) throw new DataError('not-found', 'team', { ...scope });

  const rec = await q.query(
    `update run_task_records
        set status = 'unassigned', started_at = null, updated_at = $4::timestamptz
      where run_id = $1::text and team_id = $2::uuid and task_id = $3::text
        and status = 'assigned'`,
    [scope.runId, teamUuid, args.taskId, args.now],
  );
  const active = await q.query(
    `update run_teams set active_task_id = null, updated_at = $4::timestamptz
      where run_id = $1::text and id = $2::uuid and active_task_id = $3::text`,
    [scope.runId, teamUuid, args.taskId, args.now],
  );

  return { released: (rec.rowCount ?? 0) > 0 || (active.rowCount ?? 0) > 0 };
}


/**
 * Claim a SPECIFIC task without a capacity contest.
 *
 * INVARIANT: at most one `assigned` record per team per stage. Note this does
 * NOT consult capacity at all — that is `claimTaskSlot`'s job, and the two are
 * separate methods precisely because they carry different invariants.
 *
 * It still takes the station's advisory lock. Not for its own sake — its
 * invariant is per-team — but because it WRITES `status = 'assigned'`, and the
 * cap that `claimTaskSlot` enforces is only as good as the set of writers that
 * take the lock (see the note on what the advisory lock costs, above).
 */
export async function claimActiveTask(
  q: SqlQueryable,
  scope: TeamScope,
  args: { stageId: string; taskId: string; now: string },
): Promise<ClaimActiveTaskResult> {
  const teamUuid = toUuid(scope.teamId);
  await q.query(STATION_LOCK_SQL, [scope.runId, args.taskId]);

  // `for update` is what makes the "at most one assigned record per team per
  // stage" invariant hold under real concurrency. Two racing claims of
  // DIFFERENT tasks take DIFFERENT advisory locks, so the station lock does not
  // serialise them — and a `select … where status='assigned' … for update` that
  // matches ZERO rows locks nothing, so both would read "no incumbent". The
  // team row is the only thing both racers are guaranteed to touch.
  const team = await q.query<{ n: number }>(
    `select 1 as n from run_teams where run_id = $1::text and id = $2::uuid for update`,
    [scope.runId, teamUuid],
  );
  if (team.rows.length === 0) throw new DataError('not-found', 'team', { ...scope });

  const stage = await q.query<{ n: number }>(
    `select 1 as n from run_team_stages
      where run_id = $1::text and team_id = $2::uuid and stage_id = $3::text`,
    [scope.runId, teamUuid, args.stageId],
  );
  if (stage.rows.length === 0) {
    throw new DataError('not-found', 'stage record', { stageId: args.stageId });
  }

  // The incumbent wins. Reported as a refusal, never as a second assignment.
  const incumbent = await q.query<{ task_id: string }>(
    `select task_id from run_task_records
      where run_id = $1::text and team_id = $2::uuid and stage_id = $3::text
        and status = 'assigned'
      limit 1`,
    [scope.runId, teamUuid, args.stageId],
  );
  if (incumbent.rows.length > 0) return refused('already-assigned');

  const claimed = await q.query(
    `update run_task_records
        set status = 'assigned', started_at = $4::timestamptz, updated_at = $4::timestamptz
      where run_id = $1::text and team_id = $2::uuid and task_id = $3::text
        and stage_id = $5::text`,
    [scope.runId, teamUuid, args.taskId, args.now, args.stageId],
  );
  if ((claimed.rowCount ?? 0) === 0) {
    throw new DataError('not-found', 'task record', { taskId: args.taskId });
  }
  await q.query(
    `update run_teams set active_task_id = $3::text, updated_at = $4::timestamptz
      where run_id = $1::text and id = $2::uuid`,
    [scope.runId, teamUuid, args.taskId, args.now],
  );

  return ok({ taskId: args.taskId, startedAt: args.now });
}


// ═══════════════════════════════════════════════════════════════════════════
// A4. Consume-once tokens
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Redeem a staff PIN. Consumed AT MOST ONCE.
 *
 * `used_at is null` is both the guard and the effect, in ONE statement — a PIN
 * is short and shoulder-surfable, so the read-then-write here is a real race.
 * The second caller's UPDATE matches zero rows; the follow-up SELECT only
 * decides WHICH refusal to report, and cannot change the outcome.
 *
 * KNOWN LOSS: `byUid` is not recorded. `staff_invites` has `used_at` but no
 * `used_by` column (the redeeming identity lives on `staff_sessions.staff_uid`
 * instead, which is also what makes revocation immediate). Accepting the loss
 * here beats inventing a column this repository does not own.
 */
export async function consumeStaffInvite(
  q: SqlQueryable,
  scope: RunScope,
  args: { inviteId: string; byUid: string; now: string },
  selectList: string,
): Promise<{ ok: true; invite: StaffInvite } | { ok: false; reason: 'already-used' | 'not-found' }> {
  const inviteUuid = toUuid(args.inviteId);
  const claimed = await q.query(
    `update staff_invites set used_at = $3::timestamptz
      where id = $1::uuid and run_id = $2::text and used_at is null`,
    [inviteUuid, scope.runId, args.now],
  );

  const row = await q.query<Record<string, unknown>>(
    `select ${selectList} from staff_invites i
       join users u on u.uid = i.owner_uid
      where i.id = $1::uuid and i.run_id = $2::text`,
    [inviteUuid, scope.runId],
  );
  if (row.rows.length === 0) return refused('not-found');
  if ((claimed.rowCount ?? 0) === 0) return refused('already-used');
  return ok({ invite: rowToDomain<StaffInvite>(row.rows[0], INVITE_COLUMNS) });
}


// ═══════════════════════════════════════════════════════════════════════════
// A4. The generic do-this-exactly-once latch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `claimed: true` to exactly one caller, ever.
 *
 * The existence of the row IS the latch, so the atomicity is the primary key
 * and there is no read-modify-write window at any isolation level. See the long
 * note at the top of this file for why this is a table and not a column.
 *
 * NOTE THE DELIBERATE WEAKNESS (atomic.ts): this is claim-BEFORE-work. A process
 * that dies after claiming never does the work. That is the accepted tradeoff
 * for the non-idempotent consumers — a benchmark merge is a rolling average, and
 * folding it twice corrupts the aggregate, which is worse than skipping it once.
 *
 * The aggregate must EXIST: `claimOnceFlag` on a run or team that is not there
 * throws `DataError('not-found')` rather than latching a flag on nothing. The FK
 * on `run_id` would catch a missing run, but not a missing TEAM (the sentinel
 * team id has no FK), so the check is explicit for both.
 */
export async function claimOnceFlag(
  q: SqlQueryable,
  target: { kind: 'run'; scope: RunScope } | { kind: 'team'; scope: TeamScope },
  args: { flag: string; now: string },
): Promise<{ claimed: boolean }> {
  const runId = target.scope.runId;
  const teamUuid = target.kind === 'team' ? toUuid(target.scope.teamId) : RUN_SCOPED_TEAM;

  const exists = target.kind === 'run'
    ? await q.query<{ n: number }>(
      `select 1 as n from runs where id = $1::text and game_id = $2::text`,
      [runId, target.scope.gameId],
    )
    : await q.query<{ n: number }>(
      `select 1 as n from run_teams where run_id = $1::text and id = $2::uuid`,
      [runId, teamUuid],
    );
  if (exists.rows.length === 0) {
    throw new DataError('not-found', target.kind, { flag: args.flag, runId });
  }

  const inserted = await q.query<{ n: number }>(
    `insert into ${ONCE_FLAGS_TABLE} (run_id, team_id, flag, claimed_at)
     values ($1::text, $2::uuid, $3::text, $4::timestamptz)
     on conflict (run_id, team_id, flag) do nothing
     returning 1 as n`,
    [runId, teamUuid, args.flag, args.now],
  );
  return { claimed: inserted.rows.length > 0 };
}

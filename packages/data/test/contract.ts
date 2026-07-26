// ─── The repository CONTRACT suite ───────────────────────────────────────────
//
// ONE suite that EVERY implementation of `@rushpoint/data` must pass: the
// in-memory reference today, Firestore this phase, Postgres next phase. If two
// implementations pass the same suite, swapping one for the other is
// behaviour-neutral BY CONSTRUCTION rather than by hope — which is the entire
// argument for the migration being safe.
//
// IMPLEMENTATION-AGNOSTIC BY RULE. This file imports `../src` and nothing else.
// No firebase-admin, no pg, no emulator, no network, no filesystem, no clock,
// no randomness. It receives a FACTORY and exercises the interface. If you find
// yourself needing an engine-specific import here, the behaviour you are testing
// does not belong in the contract — put it in that engine's own suite and leave
// a NOT-IN-CONTRACT note below saying why.
//
// DETERMINISM. Every timestamp is a fixed literal from the `T` table. Nothing
// calls `Date.now()`, `Math.random()`, or `crypto`. "Concurrency" is expressed
// as `Promise.all` over calls that the implementation itself must serialise; on
// a single-threaded reference implementation that is an explicit interleaving at
// `await` points (see inMemory.ts), on a real backend it is real parallelism.
// The ASSERTIONS are identical either way, because they are about the final
// state, never about the order things happened in.
//
//
// ── NOT-IN-CONTRACT ──────────────────────────────────────────────────────────
// Behaviours deliberately NOT asserted here, each with the reason. A future
// reader should treat this list as the boundary of the guarantee, not as a
// backlog.
//
// 1. DELETE vs stored-null AT REST.
//    `Patch` is three-valued at the PATCH, but not necessarily at the ROW.
//    Firestore can hold "field absent" and "field present, null" as different
//    documents; Postgres has one NULL and cannot. README §3 states this
//    explicitly ("the distinction only has to survive the patch, not the row").
//    So the contract asserts the engine-neutral half — omission ≠ clearing, and
//    a real null is stored rather than treated as a delete — and gates the
//    Firestore-only half behind `options.absentDistinctFromNull`.
//
// 2. WHETHER A TRANSACTION BODY RE-EXECUTES.
//    Firestore re-invokes the body on conflict; Postgres runs it once and
//    surfaces a serialization failure. Requiring either would make the other
//    implementation non-conforming. The contract instead asserts the property
//    both must satisfy — a committed write is never derived from a stale
//    pre-conflict read — and PROBES which model the implementation uses,
//    reporting it as a note. See `probeTransactionReExecution`.
//
// 3. PHANTOM READS / documents created mid-transaction by another writer.
//    The reference implementation cannot model predicate locking (see
//    inMemory.ts). Asserting it here would make the fast lane lie. The emulator
//    e2e station-contention scenario is the lane that covers real parallelism.
//
// 4. AN ATOM CALLED INSIDE AN ENCLOSING `runInTransaction`.
//    `atomic.ts` says it joins the outer transaction. The reference
//    implementation always opens its own, so the contract would pass vacuously
//    for it and meaningfully only for Firestore — an asymmetry that hides bugs.
//    Add it here the day the reference implementation models composition.
//
// 5. PAGING, CURSORS, ORDERING, INDEX SHAPES, LATENCY, DURABILITY.
//    Engine-specific by definition. `Cursor` is opaque to callers on purpose.
//
// 6. READ-YOUR-WRITES INSIDE A TRANSACTION.
//    `transaction.ts` FORBIDS relying on it in either direction, and permits an
//    implementation to throw. A test would therefore be asserting one of two
//    legal behaviours.

import {
  DELETE,
  DataError,
  type AdminAlert,
  type Announcement,
  type ClaimTaskSlotResult,
  type Repository,
  type Run,
  type RunScope,
  type RunTeam,
  type StaffInvite,
  type TeamScope,
  type TransactionalRepository,
  type Tx,
} from '../src/index';

// ─── The surface the contract exercises ──────────────────────────────────────
//
// A narrowed `Pick` of `Repository`, not the whole ~150-method interface. Two
// reasons, both deliberate:
//   * a full `Repository` IS assignable to it (proved below), so any real
//     implementation can be handed to `runRepositoryContract` unchanged; and
//   * a reference implementation can be small enough to read in one sitting,
//     which is what makes it usable as documentation.
// Widen it as the migration lands more of the surface.

export type ContractTxRepository = Pick<
  TransactionalRepository,
  'getRun' | 'patchRun' | 'getTeam' | 'patchTeam'
>;

export type ContractRepository = Pick<
  Repository,
  | 'putRun' | 'getRun' | 'patchRun'
  | 'putTeam' | 'getTeam' | 'patchTeam' | 'getTaskRecord'
  | 'listTeamsAtTask' | 'countTeamsAtTask'
  | 'putStaffInvite'
  | 'claimTaskSlot' | 'releaseTaskSlot' | 'claimActiveTask'
  | 'claimOnceFlag' | 'consumeStaffInvite'
  // Live-ops aggregate family (widened for the live-ops-broadcast scenario).
  | 'putAnnouncement' | 'patchAnnouncement' | 'listAnnouncements' | 'listActiveAnnouncements'
  | 'putAlert' | 'getAlert' | 'patchAlert' | 'listAlerts' | 'countUnackedAlerts'
  | 'runInTransaction'
> & {
  withTx(tx: Tx): ContractTxRepository;
};

/** Compile-time proof that a full `Repository` satisfies the contract surface. */
export const _repositoryIsContractRepository = (r: Repository): ContractRepository => r;

export interface ContractOptions {
  /**
   * Firestore-only. True when the engine can distinguish "field absent" from
   * "field present, holding null" AT REST. Default false — see NOT-IN-CONTRACT 1.
   */
  absentDistinctFromNull?: boolean;
}

export interface ContractResult {
  label: string;
  passed: number;
  failed: number;
  /** One line per failed assertion, in order. */
  failures: string[];
  /** Observations that are reported, not asserted (e.g. the execution model). */
  notes: string[];
}


// ─── Fixed fixtures. No clock, no randomness, anywhere. ──────────────────────

const T = {
  seed:    '2026-01-01T00:00:00.000Z',
  claim:   '2026-01-01T01:00:00.000Z',
  release: '2026-01-01T02:00:00.000Z',
  reclaim: '2026-01-01T03:00:00.000Z',
  flag:    '2026-01-01T04:00:00.000Z',
  patch:   '2026-01-01T05:00:00.000Z',
  tx:      '2026-01-01T06:00:00.000Z',
  bcast1:  '2026-01-01T07:00:00.000Z',
  bcast2:  '2026-01-01T08:00:00.000Z',
  bcast3:  '2026-01-01T09:00:00.000Z',
  ack:     '2026-01-01T10:00:00.000Z',
} as const;

const OWNER = 'owner-1';
const GAME = 'game-1';
const RUN_ID = 'run-1';
const STAGE = 'stage-1';
const TASK_A = 'task-a';
const TASK_B = 'task-b';

// Live-ops ids are CANONICAL uuids on purpose: the Postgres schema addresses
// announcements/alerts by a `uuid` PK with no `legacy_firebase_uid` companion, so
// only a value that already IS a uuid round-trips its id across the engine
// (ids.ts). A non-uuid id would read back as its derived uuid on Postgres and its
// literal string in-memory — a difference the contract has no business surfacing.
const ANN_1 = '11111111-1111-4111-8111-111111111111';
const ANN_2 = '22222222-2222-4222-8222-222222222222';
const ANN_3 = '33333333-3333-4333-8333-333333333333';
const ANN_UNKNOWN = '99999999-9999-4999-8999-999999999999';
const ALERT_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALERT_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ALERT_UNKNOWN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
// A uuid team id, for the same round-trip reason (alerts.team_id is a uuid column).
const ALERT_TEAM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const RUN: RunScope = { ownerUid: OWNER, gameId: GAME, runId: RUN_ID };
const team = (teamId: string): TeamScope => ({ ...RUN, teamId });

function makeRun(): Run {
  return {
    id: RUN_ID,
    gameId: GAME,
    ownerUid: OWNER,
    status: 'live',
    accessCode: 'SEED01',
    billingType: 'free',
    maxParticipants: 50,
    participantCount: 0,
    createdAt: T.seed,
    updatedAt: T.seed,
  };
}

function makeTeam(id: string): RunTeam {
  return {
    id,
    runId: RUN_ID,
    gameId: GAME,
    ownerUid: OWNER,
    displayName: `Team ${id}`,
    registrationData: {},
    status: 'active',
    stages: [
      {
        stageId: STAGE,
        order: 0,
        status: 'active',
        tasks: [
          { taskId: TASK_A, taskIndex: 0, status: 'unassigned' },
          { taskId: TASK_B, taskIndex: 1, status: 'unassigned' },
        ],
      },
    ],
    score: 0,
    bonusPenalty: 0,
    launched: true,
    updatedAt: T.seed,
  };
}

function makeInvite(id: string, pin: string): StaffInvite {
  return {
    id,
    runId: RUN_ID,
    gameId: GAME,
    ownerUid: OWNER,
    pin,
    permissions: ['announce'],
    createdAt: T.seed,
  };
}

function makeAnnouncement(
  id: string,
  createdAt: string,
  extra: Partial<Announcement> = {},
): Announcement {
  return { id, message: `msg-${id}`, level: 'info', active: true, createdAt, ...extra };
}

function makeAlert(id: string, timestamp: string, extra: Partial<AdminAlert> = {}): AdminAlert {
  return {
    id, type: 'sos', teamId: ALERT_TEAM, message: `alert-${id}`,
    timestamp, acknowledged: false, ...extra,
  };
}

/** Always picks `taskId` if it is on the table. Pure — required by SlotChooser. */
const alwaysChoose = (taskId: string) => (occupancy: ReadonlyMap<string, number>) =>
  occupancy.has(taskId) ? taskId : null;


// ─── The suite ───────────────────────────────────────────────────────────────

/**
 * Run the full contract against one implementation.
 *
 * `makeRepo` is called ONCE PER SCENARIO and must return a repository with EMPTY
 * state — scenarios must not be able to leak into each other, or a passing suite
 * stops meaning anything. (For a real backend this is "a fresh namespace/schema",
 * not "the same database again".)
 *
 * Never throws for a failed assertion: it collects them, so one broken invariant
 * does not hide the other twenty. It DOES let an unexpected exception out of a
 * scenario, recorded as a failure, and continues with the next scenario.
 */
export async function runRepositoryContract(
  makeRepo: () => Promise<ContractRepository>,
  label: string,
  options: ContractOptions = {},
): Promise<ContractResult> {
  const result: ContractResult = { label, passed: 0, failed: 0, failures: [], notes: [] };
  const ok = (cond: boolean, msg: string) => {
    if (cond) result.passed++;
    else { result.failed++; result.failures.push(msg); }
  };
  const note = (msg: string) => { result.notes.push(msg); };

  // Every failure line is prefixed with its scenario name, so a caller (and the
  // non-vacuity check in scripts/test-data-contract.ts) can assert WHICH
  // invariant broke, not merely that something did.
  const scenarios: Array<[string, (repo: ContractRepository, assert: Assert) => Promise<void>]> = [
    ['claim-contention', claimContention],
    ['claim-release-cycle', claimReleaseCycle],
    ['claim-active-task', claimActiveTaskScenario],
    ['refusals-are-values', refusalsAreValues],
    ['claim-once-flag', claimOnceFlagScenario],
    ['patch-semantics', (r, a) => patchSemantics(r, a, options)],
    ['live-ops-broadcast', liveOpsBroadcast],
    ['transaction-atomicity', transactionAtomicity],
    ['transaction-re-execution', (r, a) => probeTransactionReExecution(r, a, note)],
  ];

  for (const [name, run] of scenarios) {
    const assert: Assert = (cond, msg) => ok(cond, `${name}: ${msg}`);
    let repo: ContractRepository;
    try {
      repo = await makeRepo();
    } catch (e) {
      assert(false, `makeRepo() threw: ${describe(e)}`);
      continue;
    }
    try {
      await run(repo, assert);
    } catch (e) {
      assert(false, `threw out of the scenario: ${describe(e)}`);
    }
  }

  return result;
}

type Assert = (cond: boolean, msg: string) => void;

function describe(e: unknown): string {
  if (e instanceof DataError) return `DataError(${e.code}) ${e.message}`;
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

async function seed(repo: ContractRepository, teamIds: string[]): Promise<void> {
  await repo.putRun(makeRun());
  for (const id of teamIds) await repo.putTeam(makeTeam(id));
}


// ── 1. claimTaskSlot under contention ───────────────────────────────────────
//
// THE invariant the migration is shaped around: occupancy is DERIVED from
// `activeTaskId`, so N racing claimers against a task capped at k must produce
// EXACTLY k winners. This is the same property today's e2e station-contention
// scenario hunts, and the reason `Run.taskCounts` is deleted rather than ported.

async function claimContention(repo: ContractRepository, ok: Assert): Promise<void> {
  const CAP = 2;
  const CLAIMERS = ['t1', 't2', 't3', 't4', 't5'];
  await seed(repo, CLAIMERS);

  const results = await Promise.all(
    CLAIMERS.map((id) =>
      repo.claimTaskSlot(team(id), {
        stageId: STAGE,
        candidates: [{ taskId: TASK_A, capacity: CAP }],
        choose: alwaysChoose(TASK_A),
        now: T.claim,
      }).then(
        (r) => r,
        (e): { thrown: unknown } => ({ thrown: e }),
      ),
    ),
  );

  const thrown = results.filter((r) => 'thrown' in r);
  ok(thrown.length === 0,
    `claimTaskSlot must refuse with a value, never throw (${thrown.length} threw: ${thrown.map((t) => describe((t as { thrown: unknown }).thrown)).join('; ')})`);

  const outcomes = results.filter((r): r is ClaimTaskSlotResult => !('thrown' in r));
  const winners = outcomes.filter((r) => r.ok === true);
  const losers = outcomes.filter((r) => r.ok === false);

  ok(winners.length === CAP,
    `exactly capacity(${CAP}) claimers win a contested slot, got ${winners.length}`);
  ok(losers.every((l) => l.ok === false && l.reason === 'no-slot'),
    'every loser is refused with reason "no-slot"');

  // The ground truth, not the return values: occupancy is what the next router
  // read will see, and it is the thing a cap breach actually corrupts.
  const occupancy = await repo.countTeamsAtTask(RUN, TASK_A);
  ok(occupancy === CAP,
    `derived occupancy equals capacity after the race, got ${occupancy}`);
  ok(occupancy <= CAP, `occupancy NEVER exceeds capacity (got ${occupancy} > ${CAP})`);

  // A winner is a claim: activeTaskId and the task record move together, because
  // under the derived model they are the same fact.
  const at = await repo.listTeamsAtTask(RUN, TASK_A);
  ok(at.length === CAP, `listTeamsAtTask agrees with countTeamsAtTask (${at.length})`);
  for (const t of at) {
    const rec = await repo.getTaskRecord(team(t.id), STAGE, TASK_A);
    ok(rec?.status === 'assigned',
      `winner ${t.id}'s task record is "assigned", got ${rec?.status}`);
    ok(rec?.startedAt === T.claim,
      `winner ${t.id}'s startedAt is the CALLER-supplied instant, got ${String(rec?.startedAt)}`);
  }

  // …and a loser is untouched. A refused claim that still moved the team is the
  // slot-leak bug wearing a different hat.
  const winnerIds = new Set(at.map((t) => t.id));
  for (const id of CLAIMERS.filter((c) => !winnerIds.has(c))) {
    const loser = await repo.getTeam(team(id));
    ok(!loser?.activeTaskId,
      `refused claimer ${id} holds no active task, got ${String(loser?.activeTaskId)}`);
    const rec = await repo.getTaskRecord(team(id), STAGE, TASK_A);
    ok(rec?.status === 'unassigned',
      `refused claimer ${id}'s record stays "unassigned", got ${rec?.status}`);
  }

  // One more claim against a full station: still a value, still 'no-slot'.
  await repo.putTeam(makeTeam('t6'));
  const late = await repo.claimTaskSlot(team('t6'), {
    stageId: STAGE,
    candidates: [{ taskId: TASK_A, capacity: CAP }],
    choose: alwaysChoose(TASK_A),
    now: T.claim,
  });
  ok(late.ok === false && late.reason === 'no-slot',
    'a claim against a full station is refused as a value, not thrown');
}


// ── 2. releaseTaskSlot frees the slot, is idempotent, and is team-local ──────

async function claimReleaseCycle(repo: ContractRepository, ok: Assert): Promise<void> {
  await seed(repo, ['a', 'b', 'c']);
  const cap1 = [{ taskId: TASK_A, capacity: 1 }];

  const first = await repo.claimTaskSlot(team('a'), {
    stageId: STAGE, candidates: cap1, choose: alwaysChoose(TASK_A), now: T.claim,
  });
  ok(first.ok === true, 'the first claimer of a capacity-1 station wins');

  const blocked = await repo.claimTaskSlot(team('b'), {
    stageId: STAGE, candidates: cap1, choose: alwaysChoose(TASK_A), now: T.claim,
  });
  ok(blocked.ok === false && blocked.reason === 'no-slot',
    'the second claimer is refused while the slot is held');

  const released = await repo.releaseTaskSlot(team('a'), { taskId: TASK_A, now: T.release });
  ok(released.released === true, 'releasing a held slot reports released:true');
  ok((await repo.countTeamsAtTask(RUN, TASK_A)) === 0,
    'releasing drops derived occupancy back to 0 — there is no counter to leak');

  const recA = await repo.getTaskRecord(team('a'), STAGE, TASK_A);
  ok(recA?.status === 'unassigned',
    `a released record returns to "unassigned", got ${recA?.status}`);

  const again = await repo.releaseTaskSlot(team('a'), { taskId: TASK_A, now: T.release });
  ok(again.released === false,
    'a second release is a no-op reporting released:false (a double tap is visible but harmless)');

  const retry = await repo.claimTaskSlot(team('b'), {
    stageId: STAGE, candidates: cap1, choose: alwaysChoose(TASK_A), now: T.reclaim,
  });
  ok(retry.ok === true, 'the freed slot is claimable again');
  ok((await repo.countTeamsAtTask(RUN, TASK_A)) === 1,
    'occupancy is 1 after the re-claim');

  // Releasing team C's (non-existent) hold must not disturb B.
  const strangerRelease = await repo.releaseTaskSlot(team('c'), { taskId: TASK_A, now: T.release });
  ok(strangerRelease.released === false, 'releasing a slot you do not hold changes nothing');
  ok((await repo.countTeamsAtTask(RUN, TASK_A)) === 1,
    'another team\'s release never frees YOUR slot');
  const recB = await repo.getTaskRecord(team('b'), STAGE, TASK_A);
  ok(recB?.status === 'assigned', `team b still holds its record, got ${recB?.status}`);
}


// ── 3. claimActiveTask: at most one assigned record per team per stage ──────

async function claimActiveTaskScenario(repo: ContractRepository, ok: Assert): Promise<void> {
  await seed(repo, ['a']);

  const first = await repo.claimActiveTask(team('a'), { stageId: STAGE, taskId: TASK_A, now: T.claim });
  ok(first.ok === true, 'claimActiveTask succeeds for a team holding nothing');
  ok(first.ok === true && first.taskId === TASK_A && first.startedAt === T.claim,
    'claimActiveTask echoes the task and the caller-supplied instant');

  const second = await repo.claimActiveTask(team('a'), { stageId: STAGE, taskId: TASK_B, now: T.reclaim });
  ok(second.ok === false && second.reason === 'already-assigned',
    'a second concurrent assignment is refused, not silently produced');

  const recB = await repo.getTaskRecord(team('a'), STAGE, TASK_B);
  ok(recB?.status === 'unassigned',
    `the refused task record is untouched, got ${recB?.status}`);

  // Racing two claims of DIFFERENT tasks must still leave exactly one assigned.
  await repo.putTeam(makeTeam('b'));
  const raced = await Promise.all([
    repo.claimActiveTask(team('b'), { stageId: STAGE, taskId: TASK_A, now: T.claim }),
    repo.claimActiveTask(team('b'), { stageId: STAGE, taskId: TASK_B, now: T.claim }),
  ]);
  ok(raced.filter((r) => r.ok === true).length === 1,
    'exactly one of two racing claimActiveTask calls wins');
  const teamB = await repo.getTeam(team('b'));
  const assigned = teamB?.stages.flatMap((s) => s.tasks).filter((t) => t.status === 'assigned') ?? [];
  ok(assigned.length === 1,
    `a team never ends up with two assigned records in a stage, got ${assigned.length}`);
}


// ── 4. Refusals are VALUES: at-capacity, already-claimed, not-found ─────────
//
// `README.md` §8: an `Outcome` refusal is a normal answer; a thrown `DataError`
// means something is WRONG. If a backend maps "already used" onto an exception,
// every call site grows a try/catch and the error mapping becomes load-bearing.

async function refusalsAreValues(repo: ContractRepository, ok: Assert): Promise<void> {
  await seed(repo, ['a']);
  await repo.putStaffInvite(RUN, makeInvite('inv-1', '4242'));

  const missing = await repo.consumeStaffInvite(RUN, {
    inviteId: 'no-such-invite', byUid: 'staff-1', now: T.claim,
  });
  ok(missing.ok === false && missing.reason === 'not-found',
    'consuming an unknown invite returns a not-found REFUSAL, not a thrown error');

  const consumed = await repo.consumeStaffInvite(RUN, {
    inviteId: 'inv-1', byUid: 'staff-1', now: T.claim,
  });
  ok(consumed.ok === true, 'consuming an unused invite succeeds');
  ok(consumed.ok === true && consumed.invite.usedAt === T.claim,
    'the consumed invite carries the caller-supplied instant');

  const replay = await repo.consumeStaffInvite(RUN, {
    inviteId: 'inv-1', byUid: 'staff-2', now: T.reclaim,
  });
  ok(replay.ok === false && replay.reason === 'already-used',
    'a consume-once token refuses the second caller with "already-used"');

  // Two callers racing the same PIN: exactly one consumes it.
  await repo.putStaffInvite(RUN, makeInvite('inv-2', '9999'));
  const raced = await Promise.all([
    repo.consumeStaffInvite(RUN, { inviteId: 'inv-2', byUid: 's1', now: T.claim }),
    repo.consumeStaffInvite(RUN, { inviteId: 'inv-2', byUid: 's2', now: T.claim }),
  ]);
  ok(raced.filter((r) => r.ok === true).length === 1,
    'exactly one of two racing consumers wins the invite');
  ok(raced.filter((r) => r.ok === false && r.reason === 'already-used').length === 1,
    'the racing loser is told "already-used"');

  // And the genuine error case still THROWS a DataError, so the two channels do
  // not blur into one another.
  let dataError: unknown = null;
  try {
    await repo.claimOnceFlag(
      { kind: 'team', scope: team('ghost') },
      { flag: 'profileRecorded', now: T.flag },
    );
  } catch (e) { dataError = e; }
  ok(dataError instanceof DataError && dataError.code === 'not-found',
    `addressing a missing aggregate throws DataError('not-found'), got ${describe(dataError)}`);
}


// ── 5. claimOnceFlag: the false→true latch, exactly once ────────────────────

async function claimOnceFlagScenario(repo: ContractRepository, ok: Assert): Promise<void> {
  await seed(repo, ['a']);

  const first = await repo.claimOnceFlag({ kind: 'run', scope: RUN }, { flag: 'benchmarkContributed', now: T.flag });
  ok(first.claimed === true, 'the first caller claims the flag');
  const second = await repo.claimOnceFlag({ kind: 'run', scope: RUN }, { flag: 'benchmarkContributed', now: T.flag });
  ok(second.claimed === false, 'the second caller is told it did NOT claim');

  // A different flag on the same aggregate is a different latch.
  const other = await repo.claimOnceFlag({ kind: 'run', scope: RUN }, { flag: 'summaryEmailSent', now: T.flag });
  ok(other.claimed === true, 'a different flag on the same document is independent');

  // N racing callers: exactly one true.
  const raced = await Promise.all(
    [0, 1, 2, 3, 4].map(() =>
      repo.claimOnceFlag({ kind: 'team', scope: team('a') }, { flag: 'profileRecorded', now: T.flag }),
    ),
  );
  ok(raced.filter((r) => r.claimed).length === 1,
    `exactly one of ${raced.length} racing callers claims the flag, got ${raced.filter((r) => r.claimed).length}`);
}


// ── 6. Patch<T> semantics — absent vs value vs DELETE ───────────────────────
//
// This is where a SQL implementation will silently differ, so all three states
// are asserted explicitly and the load-bearing one is asserted twice: CLEARING
// must never be confusable with NOT SENDING. `RunTeam.activeTaskId?: string|null`
// is the canonical shape (`Game.safeZone?: SafeZone|null` is the same shape on
// the template side).

async function patchSemantics(
  repo: ContractRepository,
  ok: Assert,
  options: ContractOptions,
): Promise<void> {
  await seed(repo, ['a']);
  const scope = team('a');

  // (i) present with a value → written.
  await repo.patchTeam(scope, { activeTaskId: TASK_A, smartStreak: 3, updatedAt: T.patch });
  let t = await repo.getTeam(scope);
  ok(t?.activeTaskId === TASK_A, `a value in the patch is written, got ${String(t?.activeTaskId)}`);
  ok(t?.smartStreak === 3, `a second value in the same patch is written, got ${String(t?.smartStreak)}`);
  ok(t?.displayName === 'Team a', 'fields outside the patch are untouched');

  // (ii) absent from the patch → untouched. THE state a naive `Partial<T>` and a
  // JSON round-trip both destroy.
  await repo.patchTeam(scope, { updatedAt: T.patch });
  t = await repo.getTeam(scope);
  ok(t?.activeTaskId === TASK_A,
    `omitting a field leaves the stored value alone, got ${String(t?.activeTaskId)}`);
  ok(t?.smartStreak === 3,
    `omitting a second field leaves it alone too, got ${String(t?.smartStreak)}`);

  // (iii) explicit null → a REAL stored null. Not a delete.
  await repo.patchTeam(scope, { activeTaskId: null, updatedAt: T.patch });
  t = await repo.getTeam(scope);
  ok(t?.activeTaskId === null,
    `null in a patch stores a real null, got ${String(t?.activeTaskId)}`);
  ok(t !== null && t.activeTaskId !== TASK_A, 'null did not leave the old value in place');

  // (iv) DELETE → cleared. And CLEARING IS DISTINGUISHABLE FROM NOT SENDING:
  // the same field, patched twice, ends in two different states.
  await repo.patchTeam(scope, { smartStreak: DELETE, updatedAt: T.patch });
  t = await repo.getTeam(scope);
  ok(t?.smartStreak === undefined || t?.smartStreak === null,
    `DELETE clears the field, got ${String(t?.smartStreak)}`);
  ok(t?.displayName === 'Team a', 'DELETE on one field does not disturb another');

  // The load-bearing pair, stated as one assertion: re-set the field, then patch
  // it twice — once omitting it, once deleting it — and the outcomes differ.
  await repo.patchTeam(scope, { smartStreak: 7, updatedAt: T.patch });
  await repo.patchTeam(scope, { updatedAt: T.patch });                 // omission
  const afterOmit = (await repo.getTeam(scope))?.smartStreak;
  await repo.patchTeam(scope, { smartStreak: DELETE, updatedAt: T.patch }); // clear
  const afterDelete = (await repo.getTeam(scope))?.smartStreak;
  ok(afterOmit === 7, `omission preserved the value (got ${String(afterOmit)})`);
  ok(afterDelete !== 7, `DELETE removed the value (got ${String(afterDelete)})`);
  ok(afterOmit !== afterDelete,
    'clearing a field is DISTINGUISHABLE from not sending it — the whole point of Patch<T>');

  // A patched-in `undefined` must behave as ABSENT, never as a clear. This is
  // the Firestore `ignoreUndefinedProperties` trap, expressed as a rule.
  await repo.patchTeam(scope, { activeTaskId: undefined, updatedAt: T.patch } as never);
  t = await repo.getTeam(scope);
  ok(t?.activeTaskId === null,
    `an undefined patch value means ABSENT, not clear (got ${String(t?.activeTaskId)})`);

  // Firestore-only half — see NOT-IN-CONTRACT 1.
  if (options.absentDistinctFromNull) {
    await repo.patchTeam(scope, { evacuatedFrom: null, updatedAt: T.patch });
    const withNull = await repo.getTeam(scope);
    ok(withNull !== null && 'evacuatedFrom' in withNull,
      'a stored null keeps the key present (engine reports absent ≠ null)');
    await repo.patchTeam(scope, { evacuatedFrom: DELETE, updatedAt: T.patch });
    const deleted = await repo.getTeam(scope);
    ok(deleted !== null && !('evacuatedFrom' in deleted),
      'DELETE removes the key entirely (engine reports absent ≠ null)');
  }
}


// ── 7. Live-ops broadcast family — announcements + alerts ───────────────────
//
// The aggregate every participant's phone listens to. Two engine-neutral
// guarantees are asserted, both documented in `firestore/liveOps.ts`:
//
//   * the PARTICIPANT window (`listActiveAnnouncements`) is filtered on `active`
//     and ordered NEWEST-FIRST — a deactivated banner leaves the window while the
//     operator HISTORY read (`listAnnouncements`, not active-filtered) still shows
//     it. The newest-first order here is a load-bearing product contract, not the
//     generic paging NOT-IN-CONTRACT 5 excludes; and
//   * acknowledging an alert is a repeatable UPDATE whose observable effect
//     (the unacked count) is idempotent.
//
// A refusal-vs-throw boundary is checked at both ends: patching a MISSING
// announcement THROWS not-found (patch means "modify a doc that exists", the same
// channel patchRun/patchTeam use), while reading a MISSING alert returns a VALUE
// (null). A run is seeded first because the Postgres schema enforces the
// announcements/alerts → runs foreign key the document stores never had.

async function liveOpsBroadcast(repo: ContractRepository, ok: Assert): Promise<void> {
  await repo.putRun(makeRun());

  // ── Announcements ──────────────────────────────────────────────────────────
  await repo.putAnnouncement(RUN, makeAnnouncement(ANN_1, T.bcast1));
  await repo.putAnnouncement(RUN, makeAnnouncement(ANN_2, T.bcast2));
  await repo.putAnnouncement(RUN, makeAnnouncement(ANN_3, T.bcast3, { level: 'warning' }));

  const active1 = await repo.listActiveAnnouncements(RUN);
  ok(active1.length === 3, `all three active announcements are listed, got ${active1.length}`);
  ok(active1.map((a) => a.id).join(',') === `${ANN_3},${ANN_2},${ANN_1}`,
    `the participant window is newest-first, got ${active1.map((a) => a.id).join(',')}`);
  ok(active1[0]?.level === 'warning', 'a pushed field round-trips through the window');

  // Deactivating one drops it from the PARTICIPANT window…
  await repo.patchAnnouncement(RUN, ANN_2, { active: false });
  const active2 = await repo.listActiveAnnouncements(RUN);
  ok(active2.length === 2 && !active2.some((a) => a.id === ANN_2),
    `a deactivated announcement leaves the active window, got ${active2.map((a) => a.id).join(',')}`);

  // …but the operator HISTORY read still sees it — that read is NOT active-filtered.
  const history = await repo.listAnnouncements(RUN, { limit: 10 });
  ok(history.items.length === 3,
    `the history read still shows the retired banner, got ${history.items.length}`);
  const retired = history.items.find((a) => a.id === ANN_2);
  ok(retired?.active === false,
    `the retired banner reads back active:false, got ${String(retired?.active)}`);
  ok(history.items.map((a) => a.id).join(',') === `${ANN_3},${ANN_2},${ANN_1}`,
    `the history read is newest-first too, got ${history.items.map((a) => a.id).join(',')}`);

  // Patching a MISSING announcement is a THROW, not a silent no-op.
  let missingThrew: unknown = null;
  try {
    await repo.patchAnnouncement(RUN, ANN_UNKNOWN, { active: false });
  } catch (e) { missingThrew = e; }
  ok(missingThrew instanceof DataError && missingThrew.code === 'not-found',
    `patching a missing announcement throws not-found, got ${describe(missingThrew)}`);

  // ── Alerts ─────────────────────────────────────────────────────────────────
  await repo.putAlert(RUN, makeAlert(ALERT_1, T.bcast1));
  await repo.putAlert(RUN, makeAlert(ALERT_2, T.bcast2, { type: 'technical' }));

  const fetched = await repo.getAlert(RUN, ALERT_1);
  ok(fetched?.id === ALERT_1 && fetched.acknowledged === false,
    `a stored alert reads back unacknowledged, got ${String(fetched?.acknowledged)}`);
  ok(fetched?.teamId === ALERT_TEAM,
    `the alert's teamId round-trips, got ${String(fetched?.teamId)}`);
  ok(fetched?.timestamp === T.bcast1,
    `the alert's caller-supplied instant round-trips, got ${String(fetched?.timestamp)}`);

  ok((await repo.countUnackedAlerts(RUN)) === 2, 'both fresh alerts count as unacknowledged');

  await repo.patchAlert(RUN, ALERT_1, { acknowledged: true, acknowledgedAt: T.ack });
  const acked = await repo.getAlert(RUN, ALERT_1);
  ok(acked?.acknowledged === true && acked.acknowledgedAt === T.ack,
    `acknowledging stamps the alert, got ${String(acked?.acknowledged)}/${String(acked?.acknowledgedAt)}`);
  ok((await repo.countUnackedAlerts(RUN)) === 1, 'acknowledging one drops the unacked count to 1');

  // Idempotent: a second acknowledge changes nothing observable.
  await repo.patchAlert(RUN, ALERT_1, { acknowledged: true, acknowledgedAt: T.ack });
  ok((await repo.countUnackedAlerts(RUN)) === 1,
    'a second acknowledge is idempotent — still exactly 1 unacked');

  const alerts = await repo.listAlerts(RUN, { limit: 10 });
  ok(alerts.items.length === 2, `both alerts are listed, got ${alerts.items.length}`);
  ok(alerts.items.map((a) => a.id).join(',') === `${ALERT_2},${ALERT_1}`,
    `alerts come back newest-first, got ${alerts.items.map((a) => a.id).join(',')}`);

  // A missing alert is a VALUE (null), never a throw — the other side of the
  // refusal/throw boundary the missing-announcement patch just exercised.
  ok((await repo.getAlert(RUN, ALERT_UNKNOWN)) === null,
    'getAlert for an unknown id returns null, not a throw');
}


// ── 8. Transactions: all-or-nothing, and the return value is the only exit ──

async function transactionAtomicity(repo: ContractRepository, ok: Assert): Promise<void> {
  await seed(repo, ['a']);
  const scope = team('a');

  const returned = await repo.runInTransaction(async (tx) => {
    const r = repo.withTx(tx);
    const run = await r.getRun(RUN);
    const t = await r.getTeam(scope);
    if (!run || !t) throw new DataError('not-found', 'seed');
    await r.patchRun(RUN, { accessCode: 'TXCODE', updatedAt: T.tx });
    await r.patchTeam(scope, { displayName: 'Renamed', updatedAt: T.tx });
    return { previousCode: run.accessCode, previousName: t.displayName };
  }, { label: 'contract:atomic-pair' });

  ok(returned.previousCode === 'SEED01' && returned.previousName === 'Team a',
    'the transaction returns the value computed by the committing attempt');
  ok((await repo.getRun(RUN))?.accessCode === 'TXCODE', 'the first write committed');
  ok((await repo.getTeam(scope))?.displayName === 'Renamed', 'the second write committed');

  // A throw rolls BOTH writes back and propagates unchanged.
  const marker = new Error('contract-rollback-marker');
  let caught: unknown = null;
  try {
    await repo.runInTransaction(async (tx) => {
      const r = repo.withTx(tx);
      await r.getRun(RUN);
      await r.getTeam(scope);
      await r.patchRun(RUN, { accessCode: 'ROLLED', updatedAt: T.tx });
      await r.patchTeam(scope, { displayName: 'Rolled', updatedAt: T.tx });
      throw marker;
    }, { label: 'contract:rollback' });
  } catch (e) { caught = e; }

  ok(caught === marker, 'whatever the body throws propagates unchanged');
  ok((await repo.getRun(RUN))?.accessCode === 'TXCODE',
    'a thrown body leaves the first write rolled back');
  ok((await repo.getTeam(scope))?.displayName === 'Renamed',
    'a thrown body leaves the second write rolled back — all or nothing');
}


// ── 9. Re-execution: proving the "no side effects outside tx" rule has teeth ─
//
// `transaction.ts` rule 1 says a body MAY run more than once, and rule 2 forbids
// mutating anything in the enclosing scope. Both are unenforceable by a type —
// so this scenario submits a body that BREAKS rule 2 on purpose (it increments an
// OUTER variable and writes a value derived from it) and asserts that the
// breakage is DETECTABLE in the committed state.
//
// It cannot assert that the body re-ran (see NOT-IN-CONTRACT 2 — Postgres runs
// it once, legally). What it CAN assert, on every engine, is the property that
// makes the rule matter:
//
//   * on a re-executing engine, the outer-derived write is provably NOT the
//     value a single logical commit should have produced — the violation is
//     caught rather than merely documented; and
//   * on ANY engine, a COMPLIANT body (writing only values derived from reads
//     taken inside the same tx) commits the fresh, post-conflict value.
//
// The forced conflict is produced by an out-of-band write from inside the first
// execution. That is itself a deliberate rule-2 violation — it is the harness's
// only way to create the race without a second thread, and it is confined to
// this scenario.

async function probeTransactionReExecution(
  repo: ContractRepository,
  ok: Assert,
  note: (msg: string) => void,
): Promise<void> {
  await seed(repo, ['a']);

  // ── A. The VIOLATING body. Writes a value derived from enclosing scope. ──
  let executions = 0;
  let outerCounter = 0;
  let outcome: { executions: number; outer: number; seen: string } | null = null;
  let thrown: unknown = null;

  try {
    outcome = await repo.runInTransaction(async (tx) => {
      executions++;
      outerCounter++;                       // ← RULE 2 VIOLATION, on purpose
      const r = repo.withTx(tx);
      const run = await r.getRun(RUN);
      if (!run) throw new DataError('not-found', 'run');
      if (executions === 1) {
        // Force a conflict on a document this body read.
        await repo.patchRun(RUN, { accessCode: 'CONFLICT', updatedAt: T.tx });
      }
      await r.patchRun(RUN, { staffPin: `derived-${outerCounter}` });
      return { executions, outer: outerCounter, seen: run.accessCode };
    }, { label: 'contract:reexec-probe', maxAttempts: 5 });
  } catch (e) { thrown = e; }

  const storedPin = (await repo.getRun(RUN))?.staffPin;

  if (thrown) {
    ok(thrown instanceof DataError && (thrown as DataError).code === 'contended',
      `a runner that gives up must do so with DataError('contended'), got ${describe(thrown)}`);
    note('execution model: gave up under conflict with DataError(contended) (a legal, single-attempt-ish model)');
  } else if (executions > 1) {
    note(`execution model: RE-EXECUTING (body ran ${executions}x for one commit) — Firestore-like`);
    ok(outcome !== null && outcome.executions === executions,
      'the value returned is the one produced by the attempt that COMMITTED');
    ok(outcome?.seen === 'CONFLICT',
      `the committing attempt read the POST-conflict value, got ${String(outcome?.seen)}`);
    // THE POINT: the outer-derived write is not what a single commit would have
    // written. The suite CATCHES the rule-2 violation instead of documenting it.
    ok(storedPin !== 'derived-1',
      `the outer-variable violation is DETECTED: a single logical commit would have stored "derived-1", the stored value is "${String(storedPin)}"`);
    ok(storedPin === `derived-${outerCounter}` && outerCounter > 1,
      `the committed write carries the mutated outer value (outer=${outerCounter}, stored=${String(storedPin)}) — which is exactly why rule 2 exists`);
  } else {
    note('execution model: SINGLE-EXECUTION (body ran once) — Postgres-like');
    ok(storedPin === 'derived-1',
      `a single-execution engine commits the first (and only) derived value, got ${String(storedPin)}`);
  }

  // ── B. The COMPLIANT body, same forced conflict. Engine-neutral assertion. ──
  await repo.patchRun(RUN, { accessCode: 'BASE', staffPin: 'unset', updatedAt: T.tx });
  let compliantRuns = 0;
  let compliantThrew: unknown = null;
  try {
    await repo.runInTransaction(async (tx) => {
      const attemptIsFirst = compliantRuns === 0;
      compliantRuns++;
      const r = repo.withTx(tx);
      const run = await r.getRun(RUN);
      if (!run) throw new DataError('not-found', 'run');
      if (attemptIsFirst) await repo.patchRun(RUN, { accessCode: 'MOVED', updatedAt: T.tx });
      // Derived ONLY from what this attempt read through tx — rule 1 obeyed.
      await r.patchRun(RUN, { staffPin: `from-${run.accessCode}` });
      return null;
    }, { label: 'contract:compliant-probe', maxAttempts: 5 });
  } catch (e) { compliantThrew = e; }

  const compliantPin = (await repo.getRun(RUN))?.staffPin;
  if (compliantThrew) {
    ok(compliantThrew instanceof DataError && (compliantThrew as DataError).code === 'contended',
      `a compliant body may only fail with DataError('contended'), got ${describe(compliantThrew)}`);
  } else {
    ok(compliantPin === 'from-MOVED' || compliantPin === 'from-BASE',
      `a compliant body commits a value derived from its own tx read, got ${String(compliantPin)}`);
    ok(compliantPin !== 'unset', 'the compliant body actually committed');
    // The real guarantee: a committed write is never based on a read the commit
    // invalidated. On a re-executing engine that means the FRESH value.
    if (compliantRuns > 1) {
      ok(compliantPin === 'from-MOVED',
        `after re-execution the committed write reflects the post-conflict read, got ${String(compliantPin)}`);
    }
  }
}

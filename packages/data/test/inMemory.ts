// ─── An in-memory reference implementation of the contract surface ───────────
//
// PURPOSE
//   1. Make `contract.ts` runnable TODAY — no emulator, no Postgres, no network.
//   2. Be executable documentation of the INTENDED semantics: when the Firestore
//      and the Postgres implementations disagree about what a method means, this
//      file is the tie-breaker, because it is small enough to read in full.
//
// It implements only the slice of `Repository` that the contract exercises (see
// `ContractRepository` in contract.ts). It is a REFERENCE, not a product: it has
// no persistence, no paging, and no query planning.
//
//
// ── WHAT IT MODELS FAITHFULLY ────────────────────────────────────────────────
//
// * OPTIMISTIC CONCURRENCY, Firestore-style. Every document carries a version.
//   A transaction records the version of everything it READ, and at commit time
//   refuses if any of them moved. On refusal the body is RE-EXECUTED, up to
//   `maxAttempts`, then `DataError('contended')`. This is the property the whole
//   transaction contract is built on, and it is modelled exactly.
// * NO READ-YOUR-WRITES. `getX` after `patchX` inside the same transaction
//   returns the PRE-transaction value, as Firestore does. The contract forbids
//   relying on either behaviour; this implementation picks the stricter one so a
//   body that relies on it fails here first.
// * ABSENT / NULL / DELETE as three distinct states. A patch key that is absent
//   is not written; a `null` value is stored as a real null; the `DELETE` token
//   removes the key entirely (`'k' in doc === false`).
// * DERIVED STATION OCCUPANCY. There is no `taskCounts` field anywhere in this
//   file. Occupancy is counted from `activeTaskId` at claim time, inside the
//   transaction, exactly as `README.md` §7 requires.
// * A DELIBERATE YIELD between the read phase and the write phase of every
//   contended atom (`await tick()`), so a check-then-write bug cannot hide
//   behind JavaScript's run-to-completion semantics. Without it, every atom
//   would be trivially serialised by the event loop and the contention test
//   would pass vacuously on ANY implementation.
//
//
// ── WHAT IT ONLY APPROXIMATES (do not read these as guarantees) ──────────────
//
// * REAL PARALLELISM. Node is single-threaded. "Concurrent" callers here are
//   interleaved at `await` points in a deterministic FIFO order — which is what
//   makes the suite reproducible, but it means this implementation can only
//   detect a read-then-write window that spans an `await`. It CANNOT reproduce a
//   genuine multi-process race, an inter-node clock skew, or a lock timeout.
//   Those are the Firestore/Postgres runs' job; the emulator e2e
//   station-contention scenario is the real-parallelism lane.
// * PHANTOM READS. The read set is the set of documents that EXISTED when the
//   body read them. A team document created by another writer after the
//   occupancy count is not conflict-checked. A real backend must serialise that
//   too (Firestore conflict-checks query results; Postgres needs a predicate
//   lock or a unique constraint). The contract therefore never seeds a team
//   mid-race, and this limitation is stated rather than papered over.
// * DURABILITY, PAGING, INDEXES, and the cost model. None are modelled at all.
// * ATOMS INSIDE AN ENCLOSING TRANSACTION. `atomic.ts` says an atom called
//   inside `runInTransaction` joins that transaction. This implementation always
//   opens its own, so it does NOT model composition. The contract does not test
//   it — see the NOT-IN-CONTRACT block in contract.ts.

import {
  DataError,
  isDelete,
  ok,
  refused,
  type ClaimActiveTaskResult,
  type ClaimTaskSlotResult,
  type Patch,
  type Run,
  type RunScope,
  type RunStageRecord,
  type RunTaskRecord,
  type RunTeam,
  type StaffInvite,
  type TeamScope,
  type Tx,
  type TransactionOptions,
  type TxBody,
} from '../src/index';
import type { ContractRepository, ContractTxRepository } from './contract';

type Doc = Record<string, unknown>;

interface Cell {
  version: number;
  data: Doc;
}

/** Structural clone. Also drops `undefined`-valued keys, which is the point:
 *  an absent field and a field holding `undefined` must not be distinguishable. */
function clone<T>(v: T): T {
  return v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/** The deterministic interleaving point. FIFO macrotask ordering in Node. */
export function tick(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

class TxState {
  /** key → version observed. Checked at commit. */
  readonly reads = new Map<string, number>();
  /** key → the next whole document. */
  readonly writes = new Map<string, Doc>();
}

const runKey = (s: RunScope) => `run:${s.ownerUid}/${s.gameId}/${s.runId}`;
const teamKey = (s: TeamScope) => `team:${s.ownerUid}/${s.gameId}/${s.runId}/${s.teamId}`;
const teamPrefix = (s: RunScope) => `team:${s.ownerUid}/${s.gameId}/${s.runId}/`;
const inviteKey = (s: RunScope, id: string) =>
  `invite:${s.ownerUid}/${s.gameId}/${s.runId}/${id}`;

/**
 * Apply a `Patch` to a document IN PLACE, honouring the three-valued rule.
 *
 * absent   → untouched (a key holding `undefined` counts as absent; see clone())
 * DELETE   → `delete doc[k]`
 * anything → written verbatim, `null` included
 */
function applyPatch(doc: Doc, patch: Record<string, unknown>): void {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v === undefined) continue;
    if (isDelete(v)) delete doc[k];
    else doc[k] = clone(v);
  }
}

export class InMemoryRepository implements ContractRepository {
  private readonly store = new Map<string, Cell>();

  // ── raw access ────────────────────────────────────────────────────────────

  private read(key: string): Doc | null {
    const cell = this.store.get(key);
    return cell ? clone(cell.data) : null;
  }

  // NOTE: there is deliberately no document DELETE here. No method on the
  // contract surface removes a whole document, and a tombstone that reset the
  // version counter would silently weaken conflict detection.
  private write(key: string, next: Doc): void {
    const prev = this.store.get(key);
    this.store.set(key, { version: (prev?.version ?? 0) + 1, data: clone(next) });
  }

  // ── transaction engine ────────────────────────────────────────────────────

  private txRead(tx: TxState, key: string): Doc | null {
    const cell = this.store.get(key);
    if (!tx.reads.has(key)) tx.reads.set(key, cell?.version ?? 0);
    // NO read-your-writes: deliberately ignores tx.writes.
    return cell ? clone(cell.data) : null;
  }

  /** Stage a write. Staged-over-staged merges, because that is a WRITE-side
   *  merge and does not smuggle read-your-writes into the read path. */
  private txPatch(tx: TxState, key: string, patch: Record<string, unknown>): void {
    const staged = tx.writes.get(key);
    const base: Doc = staged ? { ...staged } : { ...(this.txRead(tx, key) ?? {}) };
    applyPatch(base, patch);
    tx.writes.set(key, base);
  }

  private txPut(tx: TxState, key: string, doc: Doc): void {
    this.txRead(tx, key); // read-before-write, so the create is conflict-checked
    tx.writes.set(key, clone(doc));
  }

  private commit(tx: TxState): boolean {
    for (const [key, version] of tx.reads) {
      if ((this.store.get(key)?.version ?? 0) !== version) return false;
    }
    for (const [key, next] of tx.writes) this.write(key, next);
    return true;
  }

  private async runTx<T>(
    body: (tx: TxState) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const max = Math.max(1, options?.maxAttempts ?? 5);
    for (let attempt = 1; attempt <= max; attempt++) {
      const tx = new TxState();
      const value = await body(tx);
      if (this.commit(tx)) return value;
    }
    throw new DataError('contended', 'in-memory transaction attempts exhausted', {
      label: options?.label,
    });
  }

  runInTransaction = <T>(body: TxBody<T>, options?: TransactionOptions): Promise<T> =>
    this.runTx((tx) => body(tx as unknown as Tx), options);

  withTx(tx: Tx): ContractTxRepository {
    // `Tx` is nominally branded by a non-exported symbol, so no implementation
    // can construct one honestly. The cast is the seam; it is the ONLY one.
    const state = tx as unknown as TxState;
    return {
      getRun: async (scope) => this.txRead(state, runKey(scope)) as Run | null,
      patchRun: async (scope, patch) =>
        this.txPatch(state, runKey(scope), patch as Record<string, unknown>),
      getTeam: async (scope) => this.txRead(state, teamKey(scope)) as RunTeam | null,
      patchTeam: async (scope, patch) =>
        this.txPatch(state, teamKey(scope), patch as Record<string, unknown>),
    };
  }

  // ── generic CRUD ──────────────────────────────────────────────────────────

  async putRun(run: Run): Promise<void> {
    this.write(runKey({ ownerUid: run.ownerUid, gameId: run.gameId, runId: run.id }), run as unknown as Doc);
  }

  async getRun(scope: RunScope): Promise<Run | null> {
    return this.read(runKey(scope)) as Run | null;
  }

  async patchRun(scope: RunScope, patch: Patch<Run>): Promise<void> {
    const doc = this.read(runKey(scope));
    if (!doc) throw new DataError('not-found', 'run', { ...scope });
    applyPatch(doc, patch as Record<string, unknown>);
    this.write(runKey(scope), doc);
  }

  async putTeam(team: RunTeam): Promise<void> {
    this.write(
      teamKey({ ownerUid: team.ownerUid, gameId: team.gameId, runId: team.runId, teamId: team.id }),
      team as unknown as Doc,
    );
  }

  async getTeam(scope: TeamScope): Promise<RunTeam | null> {
    return this.read(teamKey(scope)) as RunTeam | null;
  }

  async patchTeam(scope: TeamScope, patch: Patch<Omit<RunTeam, 'stages'>>): Promise<void> {
    const doc = this.read(teamKey(scope));
    if (!doc) throw new DataError('not-found', 'team', { ...scope });
    const shallow = { ...(patch as Record<string, unknown>) };
    delete shallow.stages; // `stages` is not patchable here, by contract.
    applyPatch(doc, shallow);
    this.write(teamKey(scope), doc);
  }

  async getTaskRecord(
    scope: TeamScope,
    stageId: string,
    taskId: string,
  ): Promise<RunTaskRecord | null> {
    const team = await this.getTeam(scope);
    const stage = team?.stages.find((s) => s.stageId === stageId);
    return stage?.tasks.find((t) => t.taskId === taskId) ?? null;
  }

  private allTeams(tx: TxState, scope: RunScope): RunTeam[] {
    const prefix = teamPrefix(scope);
    const out: RunTeam[] = [];
    for (const key of [...this.store.keys()].sort()) {
      if (!key.startsWith(prefix)) continue;
      const doc = this.txRead(tx, key) as RunTeam | null;
      if (doc && doc.id) out.push(doc);
    }
    return out;
  }

  async listTeamsAtTask(scope: RunScope, taskId: string): Promise<RunTeam[]> {
    return this.allTeams(new TxState(), scope).filter((t) => t.activeTaskId === taskId);
  }

  async countTeamsAtTask(scope: RunScope, taskId: string): Promise<number> {
    return (await this.listTeamsAtTask(scope, taskId)).length;
  }

  async putStaffInvite(scope: RunScope, invite: StaffInvite): Promise<void> {
    this.write(inviteKey(scope, invite.id), invite as unknown as Doc);
  }

  // ── atomic operations ─────────────────────────────────────────────────────

  claimTaskSlot: ContractRepository['claimTaskSlot'] = (scope, args) =>
    this.runTx<ClaimTaskSlotResult>(async (tx) => {
      const team = this.txRead(tx, teamKey(scope)) as RunTeam | null;
      if (!team) throw new DataError('not-found', 'team', { ...scope });

      const stage = team.stages.find((s) => s.stageId === args.stageId);
      // "the claim is rejected if [the active stage] moved" — a refusal, not a throw.
      if (!stage || stage.status !== 'active') return refused('no-slot');

      const teams = this.allTeams(tx, scope);
      const occupancy = new Map<string, number>();
      for (const c of args.candidates) {
        occupancy.set(c.taskId, teams.filter((t) => t.activeTaskId === c.taskId).length);
      }

      const chosenId = args.choose(occupancy);
      if (chosenId === null) return refused('no-slot');
      const candidate = args.candidates.find((c) => c.taskId === chosenId);
      if (!candidate) return refused('no-slot');

      const occupancyBefore = occupancy.get(chosenId) ?? 0;
      if (candidate.capacity !== null && occupancyBefore >= candidate.capacity) {
        return refused('no-slot');
      }

      // The read→write window. See "A DELIBERATE YIELD" at the top of this file.
      await tick();

      const nextStages = stampAssigned(team.stages, args.stageId, chosenId, args.now);
      if (!nextStages) throw new DataError('not-found', 'task record', { taskId: chosenId });

      this.txPatch(tx, teamKey(scope), {
        activeTaskId: chosenId,
        stages: nextStages,
        updatedAt: args.now,
      });
      return ok({ taskId: chosenId, occupancyBefore });
    }, { label: 'claimTaskSlot', maxAttempts: 8 });

  releaseTaskSlot: ContractRepository['releaseTaskSlot'] = (scope, args) =>
    this.runTx(async (tx) => {
      const team = this.txRead(tx, teamKey(scope)) as RunTeam | null;
      if (!team) throw new DataError('not-found', 'team', { ...scope });

      let changed = false;
      const stages = team.stages.map((s) => ({
        ...s,
        tasks: s.tasks.map((t) => {
          if (t.taskId !== args.taskId || t.status !== 'assigned') return t;
          changed = true;
          const next: RunTaskRecord = { ...t, status: 'unassigned' };
          delete next.startedAt;
          return next;
        }),
      }));

      const clearsActive = team.activeTaskId === args.taskId;
      if (!changed && !clearsActive) return { released: false };

      await tick();
      this.txPatch(tx, teamKey(scope), {
        stages,
        ...(clearsActive ? { activeTaskId: null } : {}),
        updatedAt: args.now,
      });
      return { released: true };
    }, { label: 'releaseTaskSlot' });

  claimActiveTask: ContractRepository['claimActiveTask'] = (scope, args) =>
    this.runTx<ClaimActiveTaskResult>(async (tx) => {
      const team = this.txRead(tx, teamKey(scope)) as RunTeam | null;
      if (!team) throw new DataError('not-found', 'team', { ...scope });
      const stage = team.stages.find((s) => s.stageId === args.stageId);
      if (!stage) throw new DataError('not-found', 'stage record', { stageId: args.stageId });

      const incumbent = stage.tasks.find((t) => t.status === 'assigned');
      if (incumbent) return refused('already-assigned');

      await tick();
      const nextStages = stampAssigned(team.stages, args.stageId, args.taskId, args.now);
      if (!nextStages) throw new DataError('not-found', 'task record', { taskId: args.taskId });

      this.txPatch(tx, teamKey(scope), {
        activeTaskId: args.taskId,
        stages: nextStages,
        updatedAt: args.now,
      });
      return ok({ taskId: args.taskId, startedAt: args.now });
    }, { label: 'claimActiveTask' });

  claimOnceFlag: ContractRepository['claimOnceFlag'] = (target, args) =>
    this.runTx(async (tx) => {
      const key = target.kind === 'run' ? runKey(target.scope) : teamKey(target.scope);
      const doc = this.txRead(tx, key);
      if (!doc) throw new DataError('not-found', target.kind, { flag: args.flag });
      if (doc[args.flag] === true) return { claimed: false };

      await tick();
      this.txPatch(tx, key, { [args.flag]: true, updatedAt: args.now });
      return { claimed: true };
    }, { label: 'claimOnceFlag', maxAttempts: 8 });

  consumeStaffInvite: ContractRepository['consumeStaffInvite'] = (scope, args) =>
    this.runTx(async (tx) => {
      const key = inviteKey(scope, args.inviteId);
      const invite = this.txRead(tx, key) as StaffInvite | null;
      if (!invite) return refused('not-found');
      if (invite.usedAt) return refused('already-used');

      await tick();
      this.txPatch(tx, key, { usedAt: args.now, usedBy: args.byUid });
      return ok({ invite: { ...invite, usedAt: args.now } });
    }, { label: 'consumeStaffInvite', maxAttempts: 8 });
}

/** Pure: flip one task record to `assigned`. Returns null if the record is absent. */
function stampAssigned(
  stages: RunStageRecord[],
  stageId: string,
  taskId: string,
  now: string,
): RunStageRecord[] | null {
  let found = false;
  const next = stages.map((s) => {
    if (s.stageId !== stageId) return s;
    return {
      ...s,
      tasks: s.tasks.map((t) => {
        if (t.taskId !== taskId) return t;
        found = true;
        return { ...t, status: 'assigned' as const, startedAt: now };
      }),
    };
  });
  return found ? next : null;
}

/**
 * A DELIBERATELY BROKEN implementation, used by scripts/test-data-contract.ts to
 * prove the suite is not vacuous.
 *
 * The only change: `claimTaskSlot` counts occupancy, yields, then writes WITHOUT
 * conflict checking — the classic check-then-write. This is precisely the bug
 * `Run.taskCounts` kept producing, and the contract must fail on it. If a future
 * edit ever makes the contention test pass here, the test has stopped testing.
 */
export class NaiveClaimRepository extends InMemoryRepository {
  claimTaskSlot: ContractRepository['claimTaskSlot'] = async (scope, args) => {
    const team = await this.getTeam(scope);
    if (!team) throw new DataError('not-found', 'team', { ...scope });
    const stage = team.stages.find((s) => s.stageId === args.stageId);
    if (!stage || stage.status !== 'active') return refused('no-slot');

    const occupancy = new Map<string, number>();
    for (const c of args.candidates) {
      occupancy.set(c.taskId, await this.countTeamsAtTask(scope, c.taskId));
    }
    const chosenId = args.choose(occupancy);
    if (chosenId === null) return refused('no-slot');
    const candidate = args.candidates.find((c) => c.taskId === chosenId);
    if (!candidate) return refused('no-slot');
    const occupancyBefore = occupancy.get(chosenId) ?? 0;
    if (candidate.capacity !== null && occupancyBefore >= candidate.capacity) {
      return refused('no-slot');
    }

    await tick(); // ← the window every real caller also has

    const nextStages = stampAssigned(team.stages, args.stageId, chosenId, args.now);
    if (!nextStages) throw new DataError('not-found', 'task record', { taskId: chosenId });
    await this.putTeam({ ...team, activeTaskId: chosenId, stages: nextStages, updatedAt: args.now });
    return ok({ taskId: chosenId, occupancyBefore });
  };
}

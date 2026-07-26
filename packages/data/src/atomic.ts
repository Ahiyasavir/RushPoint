// ─── Atomic operations — where the app's correctness actually lives ──────────
//
// These are NOT conveniences over the generic CRUD in repository.ts. Each one
// enforces an invariant that cannot survive being decomposed into
// read-then-write by a caller, and each one is named after that invariant.
//
// WHY THEY ARE FIRST-CLASS
//
// A generic repository tempts every caller to write:
//
//     const team = await repo.getTeam(scope);            // read
//     if (!team.taskHintsUsed.includes(taskId)) {        // decide
//       await repo.patchTeam(scope, { ... });            // write
//     }
//
// …which is correct exactly until two requests interleave. RushPoint has
// already shipped and fixed this bug class more than once (the station-slot
// leak, the concurrent cap race, the double-charged hint). Naming the operation
// moves the decision INSIDE the atom, where both a Firestore transaction and a
// SQL `UPDATE … WHERE` can enforce it, and makes the unsafe version
// unrepresentable rather than merely discouraged.
//
// SHARED RULES FOR EVERY METHOD BELOW
//
// 1. Each is atomic ON ITS OWN. Calling it needs no `runInTransaction`.
// 2. Each may ALSO be called inside a transaction body, where it joins the
//    enclosing transaction. The signature is identical either way.
// 3. Every instant is a caller-supplied ISO string parameter (`now`). No method
//    reads a clock. See types.ts RULE 3.
// 4. Every id a method needs is caller-supplied. No method mints one — a minted
//    id would differ across a Firestore transaction retry.
// 5. A refusal is a RESULT, not an exception. "Station full", "already paid",
//    "duplicate completion", "run at capacity" are normal outcomes and are
//    returned via `Outcome`. A thrown `DataError` means something is wrong.
// 6. Post-commit side effects (audit rows, push, webhooks, Storage, email) are
//    the CALLER's job, driven by the returned value. None of them happen inside
//    these methods, because a transaction body may re-execute.

import type {
  AccessCode,
  AuditLogEntry,
  Patch,
  RateBudget,
  Run,
  RunFeedback,
  RunScope,
  RunTaskRecord,
  RunTeam,
  RunStageRecord,
  StaffInvite,
  StationStatus,
  TaskScoreBreakdown,
  TeamScope,
  Wallet,
  WalletTransaction,
  WindowState,
} from './types';
import type { Outcome } from './transaction';
import type { ChatMessage, ChatThread, Trackable, Zone } from './repository';


// ═══════════════════════════════════════════════════════════════════════════
// A. Station occupancy — the operation this whole migration is shaped around
// ═══════════════════════════════════════════════════════════════════════════
//
// TODAY: occupancy is a STORED counter, `Run.taskCounts[taskId]`, incremented
// by `assignTask` and decremented by `releaseTask` / `completeTaskForTeam`
// (functions/src/routing/assignNextTask.ts). It is a denormalised cache of a
// derivable fact, so every path that ends a team's hold on a task has to
// remember to decrement it — and the ones that forgot produced the
// "station-slot leak" bugs this repo has fixed repeatedly (photo auto-approve,
// review-approve, fold-skip). It needed a reconciler
// (`reconcileTaskCounts`, run at finalize) precisely because it drifts.
//
// HERE: THERE IS NO `taskCounts`. Occupancy is DERIVED — it is
// `count(teams where activeTaskId = :taskId)`, which is already the ground
// truth the reconciler computes. Firestore serves it from the existing
// `activeTaskId` index; Postgres serves it from a partial index on
// `run_team(run_id, active_task_id)`.
//
// That makes a leak structurally impossible: a team that no longer holds a task
// no longer has `activeTaskId = taskId`, so the slot is free by definition.
// It also removes the single hottest write in the system — every assign and
// every release currently locks the ONE run document, which is why
// `withLockRetry` exists with 8 attempts and jittered backoff.
//
// The cost is that "claim if under cap" can no longer be an increment. It has
// to be one atomic operation that counts, decides and claims together — which
// is exactly what `claimTaskSlot` is.

/** One candidate the router is willing to accept, with its own cap. */
export interface TaskSlotCandidate {
  taskId: string;
  /**
   * Maximum concurrent teams. `null` means UNCAPPED — locationless tasks have
   * no physical station to fill and must never be excluded by occupancy.
   * (Today this is `task.maxConcurrentTeams ?? 3`, with locationless skipped.)
   */
  capacity: number | null;
}

/**
 * Picks which candidate to claim, given live occupancy.
 *
 * MUST BE PURE. It is invoked INSIDE the atom, and on Firestore the enclosing
 * transaction may re-execute — so it may be invoked more than once, and must
 * return the same answer for the same occupancy. No clock, no randomness, no
 * I/O. All of routing's inputs (team location, skill ratio, hot zone, release
 * /expiry/unlock gates, `now`) are closed over from OUTSIDE the atom, which is
 * how `priorityScore` stays entirely in the application layer.
 *
 * Returns the chosen `taskId`, or `null` for "none of these are acceptable".
 * `occupancy` contains an entry for every candidate, uncapped ones included.
 */
export type SlotChooser = (occupancy: ReadonlyMap<string, number>) => string | null;

export type ClaimTaskSlotResult = Outcome<
  {
    taskId: string;
    /** Occupancy of the chosen task BEFORE this claim. For logging/telemetry. */
    occupancyBefore: number;
  },
  /** The chooser declined, or every candidate was at capacity. */
  'no-slot'
>;

export type ClaimActiveTaskResult = Outcome<
  { taskId: string; startedAt: string },
  /** The team already holds an assigned task in this stage — that one wins. */
  'already-assigned'
>;


// ═══════════════════════════════════════════════════════════════════════════
// B. Result shapes for the rest
// ═══════════════════════════════════════════════════════════════════════════

/** What a completion actually did. `heldSlot` tells the caller whether to reassign. */
export interface CompleteTeamTaskResult {
  /** False for a duplicate/terminal-status no-op. Nothing was written. */
  completed: boolean;
  /** True when this team held the station slot at completion time. */
  heldSlot: boolean;
  /** Set when this completion closed the stage. */
  stageCompleted: boolean;
  /** Set when this completion finished the team's whole run. */
  teamFinished: boolean;
  /** Tasks auto-terminated by the same commit (exclusive-group losers, folds). */
  releasedTaskIds: string[];
  /** Team score after the write. */
  score: number;
}

/** The per-task write a completion applies. Assembled by the caller's scorer. */
export interface TaskCompletionWrite {
  completedAt: string;
  actualMinutes?: number;
  /**
   * Stamped ONCE, here, when the game task carries `pausesTimer` — and stamped
   * even when the span is 0, because `computeSkillRatio` drops a record by the
   * PRESENCE of this field. Never re-derived from the template later, or a
   * mid-run edit would retroactively re-time finished work and break live/final
   * leaderboard parity.
   */
  excludedMs?: number;
  /** Snapshot of the template's expected minutes at the moment of completion. */
  expectedDurationMinutesAtCompletion?: number;
  earnedScore: number;
  scoreBreakdown?: TaskScoreBreakdown;
  surveyResponse?: string;
  verificationOutcome?: RunTaskRecord['verificationOutcome'];
  photoUrl?: string;
}


// ═══════════════════════════════════════════════════════════════════════════
// C. The interface
// ═══════════════════════════════════════════════════════════════════════════

export interface AtomicOperations {

  // ── A1. Station slots ───────────────────────────────────────────────────

  /**
   * Count occupancy of every candidate, let `choose` pick one, and claim it —
   * all in one atomic step.
   *
   * INVARIANT: for every capped task, `count(teams with activeTaskId = taskId)`
   * never exceeds `capacity`. Two teams racing the same last slot: exactly one
   * wins; the loser gets `{ ok:false, reason:'no-slot' }`, never a cap breach.
   *
   * "Claim" means: set this team's `activeTaskId` to the chosen task and flip
   * its task record to `assigned` with `startedAt = now`. Occupancy and
   * assignment are therefore THE SAME FACT and cannot drift — which is the
   * whole reason `taskCounts` is gone.
   *
   * This deliberately merges what are two separate transactions today (reserve
   * a count on the run doc, then claim it onto the team doc, with compensating
   * `releaseTask` calls on every failure path — see `assignNextInActiveStage`).
   * Merging them deletes the compensation logic and the window it covers.
   *
   * @param stageId the team's ACTIVE stage; the claim is rejected if it moved.
   * @param now     ISO instant stamped as `RunTaskRecord.startedAt`.
   */
  claimTaskSlot(
    scope: TeamScope,
    args: {
      stageId: string;
      candidates: TaskSlotCandidate[];
      choose: SlotChooser;
      now: string;
    },
  ): Promise<ClaimTaskSlotResult>;

  /**
   * Release this team's hold on `taskId`.
   *
   * INVARIANT: releasing is idempotent and only ever affects THIS team. Under
   * the derived model there is no counter to over-decrement, so the "never go
   * negative" guard that `releaseTask` needed has no analogue — the bug class
   * is gone, not handled.
   *
   * Clears `activeTaskId` (only if it still equals `taskId` — a team that has
   * since been assigned elsewhere must not be un-assigned) and returns the task
   * record to `unassigned` if and only if it is still `assigned`. A record that
   * already reached a terminal status (`completed`/`skipped`) is left alone.
   *
   * Returns whether anything changed, so a double-tap is visible but harmless.
   */
  releaseTaskSlot(
    scope: TeamScope,
    args: { taskId: string; now: string },
  ): Promise<{ released: boolean }>;

  /**
   * Claim a SPECIFIC task as the team's active one, without a capacity contest.
   *
   * INVARIANT: at most one `assigned` record per team per stage. If the team
   * already holds one, this refuses and reports the incumbent — it never
   * produces a second.
   *
   * This is the single-candidate path (a stage with one task, a directed
   * assignment, a re-claim after a check-out). `claimTaskSlot` is the contested
   * path. They are separate methods because they have different invariants:
   * this one does not consult capacity at all.
   */
  claimActiveTask(
    scope: TeamScope,
    args: { stageId: string; taskId: string; now: string },
  ): Promise<ClaimActiveTaskResult>;


  // ── A2. Completion ──────────────────────────────────────────────────────

  /**
   * Grade and commit one task completion.
   *
   * INVARIANTS, all in ONE commit:
   *  - A task reaches `completed` AT MOST ONCE. A record already in a terminal
   *    status (`completed`, `skipped`, or anything terminal added later) is a
   *    silent no-op returning `completed:false` — not an error, because a
   *    double-tap and a retried request are normal.
   *  - The score write and the station-slot release happen together. Today
   *    these are one transaction spanning the team doc and the run doc; here
   *    the release is implicit in clearing `activeTaskId`, so it cannot be
   *    forgotten.
   *  - A completion cannot land after the run is finished. `requireRunLive`
   *    is checked INSIDE the atom, closing the finalize TOCTOU.
   *  - Stage advance, and the team's own `finished` transition, are part of the
   *    same commit as the score — a team can never be seen finished with a
   *    stale score.
   *
   * The CALLER computes the score (scoring presets, hot-zone multiplier,
   * power-ups all live in @rushpoint/shared and in the functions layer) and
   * hands it in as `write`. The repository never scores anything: scoring reads
   * the game template, and the template is not this layer's business.
   *
   * `foldTaskIds` are tasks the same commit must terminate as `skipped` with
   * zero score — exclusive-group losers and partial-stage folds. They are here
   * rather than in a follow-up call precisely because a crash between the two
   * is what leaks a slot.
   */
  completeTeamTask(
    scope: TeamScope,
    args: {
      stageId: string;
      taskId: string;
      write: TaskCompletionWrite;
      /** Sibling tasks to auto-skip in the same commit (score 0). */
      foldTaskIds?: string[];
      /** Stage/team transitions the caller's pure planner decided. */
      stagePatch?: Patch<Omit<RunStageRecord, 'stageId' | 'order' | 'tasks'>>;
      /** Extra top-level team fields (powerUps, bonusPenalty delta already applied). */
      teamPatch?: Patch<Omit<RunTeam, 'stages' | 'score'>>;
      /** Signed delta applied to `RunTeam.score` inside the commit. */
      scoreDelta: number;
      /** Refuse unless the run is still live. Always true outside tests. */
      requireRunLive: boolean;
      now: string;
    },
  ): Promise<CompleteTeamTaskResult>;

  /**
   * Skip ONE mission for ONE team, keeping the team in the stage.
   *
   * INVARIANT: the skipped record becomes `skipped` with `earnedScore: 0`, the
   * slot is released, and — if the skip put `requiredTaskCount` out of reach —
   * the TEAM's stored requirement is lowered by the smallest winnable amount.
   * The requirement is lowered on the team's `RunStageRecord`, NEVER on the
   * game template: the template is replayed by later runs and copied by
   * duplicate/export/publish.
   *
   * The arithmetic (`planTaskSkip` in @rushpoint/shared) is pure and stays in
   * the caller; this method commits its verdict.
   */
  skipTeamTask(
    scope: TeamScope,
    args: {
      stageId: string;
      taskId: string;
      /** From planTaskSkip. Absent ⇒ leave the stored requirement alone. */
      requiredTaskCount?: number;
      /** Further tasks the same commit folds to `skipped` (stage completion). */
      foldTaskIds?: string[];
      stagePatch?: Patch<Omit<RunStageRecord, 'stageId' | 'order' | 'tasks'>>;
      now: string;
    },
  ): Promise<Outcome<
    { releasedTaskIds: string[]; stageCompleted: boolean; teamFinished: boolean },
    /** The record was already terminal, or is not in that stage. */
    'not-skippable'
  >>;


  // ── A3. Joining and launching ───────────────────────────────────────────

  /**
   * Create a team on a run if and only if there is room for it.
   *
   * INVARIANTS, one commit:
   *  - `participantCount` never exceeds `Run.maxParticipants`.
   *  - `deviceCount` never exceeds the device ceiling.
   *  - One uid holds at most one team per run. The team's document id IS the
   *    uid (`RunTeam.id === auth.uid`), so a second join by the same uid
   *    resolves to the same key and cannot create a second team — the
   *    uniqueness is a property of the ADDRESS, not of a check.
   *
   * The counters are incremented as part of the same commit that creates the
   * team, so "counted but not created" and "created but not counted" are both
   * impossible. Note this is a read-modify-write, NOT a blind increment: the
   * cap comparison and the bump must see the same value.
   *
   * `alreadyJoined` is a SUCCESS: re-joining is how a reloaded phone recovers.
   */
  joinRunWithCapacity(
    scope: RunScope,
    args: {
      team: RunTeam;
      participantCap: number;
      deviceCap: number;
      now: string;
    },
  ): Promise<Outcome<
    { teamId: string; alreadyJoined: boolean; participantCount: number },
    'run-full' | 'device-limit' | 'run-finished'
  >>;

  /**
   * Attach an additional phone to an existing team.
   *
   * INVARIANTS: per-team device cap AND run-wide device cap, both checked
   * against the same read that performs the bump; a uid is attached at most
   * once (idempotent re-attach); exactly one `controllerUid` at all times, and
   * a legacy team document with no `deviceUids` is backfilled in the SAME write
   * rather than by a migration.
   */
  attachDevice(
    scope: TeamScope,
    args: {
      uid: string;
      displayName: string;
      teamDeviceCap: number;
      runDeviceCap: number;
      now: string;
    },
  ): Promise<Outcome<
    { alreadyAttached: boolean; controllerUid: string; deviceCount: number },
    'team-full' | 'run-device-limit' | 'run-finished'
  >>;

  /**
   * Move the controller role.
   *
   * INVARIANT: exactly one controller, always an ATTACHED uid.
   *
   * `mode` distinguishes the two callers that share this invariant:
   *  - `'transfer'` — only the CURRENT controller may hand off. Refuses with
   *    `'not-controller'` otherwise.
   *  - `'claim'`    — ANY attached device may seize control. This is the
   *    never-stuck fallback for a dead controlling phone, so it deliberately
   *    does not consult the incumbent. Idempotent.
   *
   * Both refuse `'not-attached'` for a uid that is not on the team — that is
   * the trust boundary, and it is checked inside the atom because team
   * membership can change concurrently.
   */
  setController(
    scope: TeamScope,
    args: {
      mode: 'transfer' | 'claim';
      /** The caller. For 'transfer' this must currently be the controller. */
      byUid: string;
      /** The new controller. For 'claim' this equals `byUid`. */
      toUid: string;
      now: string;
    },
  ): Promise<Outcome<{ controllerUid: string }, 'not-controller' | 'not-attached'>>;

  /**
   * Create a run, its access code, and the billing debit, atomically.
   *
   * INVARIANT: a credit is NEVER burned without producing a usable run, and a
   * run never exists un-billed. The wallet debit, the ledger row, the run
   * document and the `accessCodes/{code}` document are one commit.
   *
   * `debit` is decided by the caller's pure billing resolver
   * (`resolveLaunchBilling`); this method only enforces that the wallet can
   * still afford it AT COMMIT TIME. That re-check is the point: the balance
   * read that produced the decision is not the balance that gets debited.
   *
   * `uniqueCodeRequired` makes the access code a uniqueness constraint rather
   * than a hope — if `code` is taken, the whole thing refuses and the caller
   * mints another. (Today this is a pre-check plus a blind set.)
   */
  launchRunBilled(
    args: {
      run: Run;
      accessCode: AccessCode;
      /** Absent ⇒ free mode / test drive: no wallet touch, no ledger row. */
      debit?: {
        uid: string;
        kind: 'free_run' | 'credit';
        ledger: WalletTransaction;
      };
      now: string;
    },
  ): Promise<Outcome<
    { runId: string; accessCode: string },
    'insufficient-credits' | 'code-taken' | 'test-run-already-live'
  >>;


  // ── A4. Consume-once tokens ─────────────────────────────────────────────

  /**
   * Redeem a staff PIN.
   *
   * INVARIANT: an invite is consumed AT MOST ONCE. `usedAt` is both the guard
   * and the effect, set in the same commit that reads it — a PIN is short and
   * shoulder-surfable, so a read-then-write here is a real race, not a
   * theoretical one.
   */
  consumeStaffInvite(
    scope: RunScope,
    args: { inviteId: string; byUid: string; now: string },
  ): Promise<Outcome<{ invite: StaffInvite }, 'already-used' | 'not-found'>>;

  /**
   * Redeem a guardian-consent token AND stamp the consent on the team.
   *
   * INVARIANT: single use, and consume-and-grant are ONE commit — a token
   * marked used without the consent landing would permanently lock a minor out
   * of the game with no way to re-issue.
   *
   * The token IS the authorization: the caller is any authenticated device (the
   * guardian's phone), never the child's, so there is no ownership check here
   * by design.
   */
  consumeConsentToken(
    scope: RunScope,
    args: {
      token: string;
      guardianName: string | null;
      now: string;
    },
  ): Promise<Outcome<{ teamId: string }, 'already-used' | 'not-found' | 'expired'>>;

  /**
   * The generic "do this exactly once" latch.
   *
   * INVARIANT: the flag goes false→true at most once across all callers, and
   * the winner is told it won. Everyone else gets `claimed:false` and MUST NOT
   * perform the guarded work.
   *
   * This is the shape behind `Run.benchmarkContributed` and
   * `Run.summaryEmailSent`, and behind `RunTeam.profileRecorded`. It is one
   * method rather than three because the invariant is identical and the flag
   * name is data.
   *
   * NOTE THE DELIBERATE WEAKNESS: this is claim-BEFORE-work. If the process
   * dies after claiming and before doing the work, the work never happens. That
   * is the accepted tradeoff for the non-idempotent consumers (a benchmark
   * merge is a rolling average; running it twice corrupts the aggregate, which
   * is worse than skipping it once). Do not "improve" it into claim-after-work
   * without checking each consumer.
   */
  claimOnceFlag(
    target:
      | { kind: 'run'; scope: RunScope }
      | { kind: 'team'; scope: TeamScope },
    args: { flag: string; now: string },
  ): Promise<{ claimed: boolean }>;


  // ── A5. Charges against a team's score ──────────────────────────────────
  //
  // All three write `RunTeam.bonusPenalty`, whose sign convention is: it is
  // SUBTRACTED from the final score, so a BONUS is a NEGATIVE penalty. That is
  // not obvious and it is not negotiable — `buildRankings` reads this one field
  // and ignores `RunTeam.score` (which is display-only), so anything that must
  // affect ranking has to come through here.

  /**
   * Reveal a paid hint, charging at most once per (team, task).
   *
   * INVARIANT: `taskId ∈ taskHintsUsed` is both the guard and the effect, in
   * one commit. A second call returns `alreadyCharged:true` and charges 0.
   *
   * `penalty` and `free` are decided by the caller (hint auto-escalation reads
   * the task record's `startedAt` and the team's wrong-attempt count) but are
   * APPLIED here, so two taps cannot both be charged.
   */
  chargeHint(
    scope: TeamScope,
    args: { taskId: string; penalty: number; now: string },
  ): Promise<{ alreadyCharged: boolean; charged: number }>;

  /**
   * Record a wrong answer: attempt count, cumulative charge, replay hash and
   * retry lockout, in one commit.
   *
   * INVARIANTS:
   *  - The cumulative charge per task honours its cap. This is why a bare
   *    increment is not enough: the cost of attempt N depends on how much has
   *    ALREADY been charged, so `cost` must be computed from a value read
   *    inside the atom. Hence `computeCost`, not a precomputed number.
   *  - An identical replayed submission is never charged twice and never
   *    extends the lockout. `submissionHash` is compared inside the atom;
   *    a match returns `replay:true` and writes nothing.
   *  - The lockout is stored as `(serverInstant, durationMs)`, never as an
   *    absolute deadline for a device clock to count down — a slow-clocked
   *    phone would freeze on it. `cooldownUntil` is derived on read and bounded
   *    by the level's own ceiling so an out-of-range stored value self-heals.
   *
   * `computeCost` MUST BE PURE for the same reason `SlotChooser` must be.
   */
  chargeWrongAnswer(
    scope: TeamScope,
    args: {
      taskId: string;
      submissionHash: string;
      /** Pure. Given what is already charged/attempted, what does this cost? */
      computeCost: (prior: { attempts: number; charged: number }) => {
        points: number;
        lockoutMs: number;
      };
      /** Server instant the lockout is measured FROM. */
      now: string;
      nowMs: number;
    },
  ): Promise<{
    replay: boolean;
    charged: number;
    attempts: number;
    lockoutMs: number;
    /** Server instant the lockout started. Ship `lockoutMs`, not this, to devices. */
    lastFailureAt: number;
  }>;

  /**
   * Apply a staff bonus/fine to a team.
   *
   * INVARIANT: `bonusPenalty` ACCUMULATES without lost updates against the
   * other three writers of the same field (hint charge, wrong-answer charge,
   * zone capture), all of which are concurrent. Hence read-modify-write inside
   * the atom rather than a blind increment — `clamp` sees the accumulated
   * result, not the delta.
   *
   * `clamp` is pure and bounds the ACCUMULATED value: a non-finite or unbounded
   * `bonusPenalty` poisons `buildRankings` and takes the whole leaderboard down
   * (this has happened), so the guard belongs where the new value is computed.
   */
  adjustTeamPenalty(
    scope: TeamScope,
    args: {
      /** Signed, in SCORE space. Positive = bonus ⇒ bonusPenalty DECREASES. */
      delta: number;
      /** Pure. Receives the would-be accumulated penalty; returns the stored one. */
      clamp: (next: number) => number;
      now: string;
    },
  ): Promise<{ previousBonusPenalty: number; bonusPenalty: number }>;


  // ── A6. Run-scoped operational state ────────────────────────────────────

  /**
   * Pause / close / resume ONE task for ONE run.
   *
   * INVARIANT: the override lands on the RUN document (`taskStatusOverrides`),
   * never on the game template — a stop closed today must not be closed for
   * tomorrow's run, for a duplicate, for an export, or in the gallery. The map
   * is rewritten whole because task ids are opaque strings and are not safe as
   * dotted field paths.
   *
   * `expectedFrom` makes the write a compare-and-set: it refuses if another
   * operator changed the status in between, so two staff toggling the same stop
   * cannot silently overwrite each other. Omit it for an unconditional set.
   *
   * Note what this does NOT do: it does not touch teams already holding the
   * task. Overrides are read by the ASSIGNMENT filters only; the completion
   * path never reads them, so a team mid-task still finishes and scores.
   */
  setTaskStatusOverride(
    scope: RunScope,
    args: {
      taskId: string;
      status: StationStatus;
      expectedFrom?: StationStatus;
      now: string;
    },
  ): Promise<Outcome<{ from: StationStatus; to: StationStatus }, 'conflict'>>;

  /**
   * Write a recomputed leaderboard snapshot unless the board is frozen.
   *
   * INVARIANTS:
   *  - A frozen board is NEVER overwritten. `frozen` is re-checked inside the
   *    atom, because computing rankings is an O(teams) scan and a freeze can
   *    land during it.
   *  - `published` and `frozen` are never clobbered. Only `rankings` and
   *    `updatedAt` are written, which is why this is a named method and not
   *    `patchRun({ leaderboard })` — a whole-object write of the leaderboard is
   *    exactly how a staged reveal gets un-staged.
   *  - Throttling: `minIntervalMs` is honoured against the STORED
   *    `updatedAt`, inside the atom, so N concurrent scoring events produce one
   *    write. An unparsable or FUTURE stored timestamp must not wedge the board
   *    forever — treat it as "refresh now".
   *
   * The caller computes `rankings` from the STORED team documents only, never
   * from the live template and never from `now`, or live and final standings
   * drift (see CLAUDE.md on live/final parity).
   */
  refreshLeaderboardIfNotFrozen(
    scope: RunScope,
    args: {
      rankings: import('./types').LeaderboardEntry[];
      /** 0 ⇒ always write (the organizer's explicit refresh). */
      minIntervalMs: number;
      now: string;
      nowMs: number;
    },
  ): Promise<{ written: boolean; skipped?: 'frozen' | 'throttled' }>;


  // ── A7. Append-style live ops ───────────────────────────────────────────

  /**
   * Append one message to a team↔HQ thread.
   *
   * INVARIANT: no message is lost when a team and HQ send simultaneously, and
   * the unread counter matches the messages actually stored. The thread is ONE
   * document holding an array today and will be message ROWS later; both are
   * served by "append + bump the counters in one commit", which is why the
   * method takes a message and not a thread.
   *
   * `maxMessages` trims the oldest in the same commit so an unbounded thread
   * cannot grow past the document size limit. Trimming outside the append is
   * what loses messages.
   */
  appendChatMessage(
    scope: TeamScope,
    args: {
      message: ChatMessage;
      /** Created on first message; ignored afterwards. */
      threadSeed: Omit<ChatThread, 'messages' | 'updatedAt'>;
      maxMessages: number;
      now: string;
    },
  ): Promise<{ messageCount: number; trimmed: number }>;

  /**
   * Set or clear one uid's reaction to a feed item.
   *
   * INVARIANT: ONE reaction per uid. `reactedBy[uid]` is the source of truth
   * and `reactions[emoji]` is a derived tally — they are updated together, so
   * they cannot disagree. Switching emoji decrements the old and increments the
   * new in one step; a zero tally is removed rather than stored as 0.
   *
   * `emoji: null` removes the reaction. This is why it is not two methods.
   */
  applyFeedReaction(
    scope: RunScope,
    args: { itemId: string; uid: string; emoji: string | null; now: string },
  ): Promise<Outcome<{ reactions: Record<string, number> }, 'not-found' | 'hidden'>>;

  /**
   * Record a UGC report against a feed item and auto-hide past a threshold.
   *
   * INVARIANT: one report per reporter key (`teamId`, or `staff:<uid>`), a
   * `reportCount` that always equals the number of distinct keys, and the
   * hide decision taken from the count IN THE SAME COMMIT that produces it —
   * otherwise an item can sit visible above the threshold.
   *
   * `reportsCleared` permanently disarms auto-hide for an item a moderator
   * restored, even as reports keep accumulating. It is checked here, not by
   * the caller, so a restore cannot be undone by a race.
   */
  applyFeedReport(
    scope: RunScope,
    args: {
      itemId: string;
      reporterKey: string;
      reason: string;
      autoHideAtCount: number;
      now: string;
    },
  ): Promise<Outcome<{ reportCount: number; hidden: boolean }, 'not-found'>>;


  // ── A8. Run objects ─────────────────────────────────────────────────────

  /**
   * Capture a territory zone.
   *
   * INVARIANT: the zone's new owner and the capturing team's bonus are ONE
   * commit — a zone that flipped owner without paying, or paid without
   * flipping, is a scoring bug either way. A team cannot re-capture a zone it
   * already holds (that would farm the bonus), and the proximity check is
   * re-validated here against the STORED zone geometry, never against
   * client-supplied bounds.
   *
   * The award goes through `bonusPenalty` (negative = bonus) because that is
   * the only channel `buildRankings` reads.
   */
  captureZone(
    scope: TeamScope,
    args: {
      zoneId: string;
      /** Server's verdict on the team's fix. Computed from the stored zone. */
      withinZone: (zone: Zone) => boolean;
      now: string;
    },
  ): Promise<Outcome<
    { zone: Zone; bonusAwarded: number },
    'not-found' | 'already-held' | 'out-of-range'
  >>;

  /**
   * Move a trackable between a team and a task.
   *
   * INVARIANT: exactly one holder at a time, and only the CURRENT holder may
   * drop. Pickup and drop are one method because they are one invariant
   * expressed twice — splitting them invites a "pick up then drop" pair that is
   * not atomic as a whole.
   */
  transferTrackable(
    scope: RunScope,
    args: {
      trackableId: string;
      action: 'pickup' | 'drop';
      teamId: string;
      teamName?: string;
      /** Where it is dropped. Ignored for 'pickup'. */
      taskId?: string | null;
      now: string;
    },
  ): Promise<Outcome<
    { trackable: Trackable },
    'not-found' | 'held-by-other' | 'not-carrying'
  >>;

  /**
   * Set or clear a smart-station secret code.
   *
   * Atomic only in the trivial sense, but named here because the secret must
   * never be readable through any participant-facing method: it lives in its
   * own aggregate precisely so a `getTask` can never carry it. There is no
   * `getStationSecretFor(team)` and there never will be — verification is
   * `verifyStationCode`, server-side, against a value the client never sees.
   */
  setStationSecret(
    args: { taskId: string; code: string | null; now: string },
  ): Promise<void>;

  /**
   * Store a player's post-game feedback — first response wins.
   *
   * INVARIANT: one response per PLAYER uid (not per team: every attached device
   * answers independently), and a response is never overwritten. The document
   * key IS the uid, so the uniqueness is again a property of the address; the
   * atom only has to refuse the overwrite.
   */
  submitFeedbackOnce(
    scope: RunScope,
    args: { feedback: RunFeedback },
  ): Promise<{ stored: boolean; already: boolean }>;


  // ── A9. Public gallery signals ──────────────────────────────────────────

  /**
   * Toggle one creator's like of a public game or task.
   *
   * INVARIANT: one like per (kind, item, uid) — the like record's key is
   * derived from exactly that tuple, so a duplicate resolves to the same row.
   * The `likeCount` tally on the public document moves in the SAME commit as
   * the like record, so the count can never drift from the records that justify
   * it. `popularity` is recomputed from the new count by `recompute` (pure) and
   * written in the same step, because the gallery ORDERS BY it — a count
   * without its score is an invisible like.
   */
  togglePublicLike(
    args: {
      kind: 'game' | 'task';
      itemId: string;
      uid: string;
      /** true = like, false = unlike. Idempotent in both directions. */
      liked: boolean;
      /** Pure. (likeCount, uses, createdAt) → popularity. */
      recompute: (signals: { likeCount: number; uses: number; createdAt: string }) => number;
      now: string;
    },
  ): Promise<Outcome<{ likeCount: number; popularity: number; changed: boolean }, 'not-found'>>;

  /**
   * Bump a public item's usage signals (playCount / copyCount) and its
   * derived `popularity` together.
   *
   * INVARIANT: same as above — a signal and the ordering score derived from it
   * are one commit, or the gallery ranks by a stale number.
   *
   * BEST-EFFORT BY CONTRACT: this is called from the launch and copy paths,
   * where a failure must never fail the user's action. It returns a result
   * rather than throwing for a missing document, so the caller can ignore it
   * without a try/catch that would also swallow real errors.
   */
  bumpPublicSignals(
    args: {
      kind: 'game' | 'task';
      itemId: string;
      /** Signed deltas. `uses` is playCount for a game, copyCount for a task. */
      uses?: number;
      recompute: (signals: { likeCount: number; uses: number; createdAt: string }) => number;
      now: string;
    },
  ): Promise<Outcome<{ uses: number; popularity: number }, 'not-found'>>;

  /**
   * Fold a publish's tag diff into the global tag histogram.
   *
   * INVARIANT: every tag added and every tag removed by ONE publish moves in
   * ONE commit, so a half-applied retag can never leave a tag over-counted.
   * Counters floor at 0 and an entry reaching 0 is REMOVED, never stored as 0
   * (a zero row is indistinguishable from a stale one and pollutes the picker).
   *
   * Takes `added`/`removed` lists rather than a signed delta map because that
   * is what a publish produces (`newTags \ priorTags` and the converse), and
   * because a caller assembling signed deltas by hand is how a tag ends up
   * counted twice.
   *
   * BEST-EFFORT BY CONTRACT: never throws, and both lists empty is a no-op that
   * does not even read. A tag histogram is a nicety; failing a publish over it
   * is not acceptable.
   */
  bumpTagStats(
    args: { added: string[]; removed: string[]; now: string },
  ): Promise<void>;


  // ── A10. Cross-run aggregates ───────────────────────────────────────────

  /**
   * Fold one sample into a rolling cross-run benchmark.
   *
   * INVARIANT: concurrent folds of different runs do not lose each other. The
   * merge is a ROLLING AVERAGE and is therefore NOT idempotent — which is
   * exactly why the caller must first win `claimOnceFlag('benchmarkContributed')`.
   * This method does not and cannot protect against double-folding; it only
   * protects against interleaving.
   *
   * `merge` is pure: (previous aggregate, sample) → next aggregate.
   */
  mergeBenchmark<S>(
    args: {
      type: string;
      sample: S;
      merge: (prev: import('./repository').BenchmarkDoc | null, sample: S) =>
        import('./repository').BenchmarkDoc;
      now: string;
    },
  ): Promise<void>;

  /**
   * Fold one finished team's result into a player's cross-run profile.
   *
   * INVARIANT: the guard (`RunTeam.profileRecorded`) is checked AND set in the
   * same commit that writes the profile, so a retried trigger cannot
   * double-count a player's history. This is the claim-AFTER-work variant of
   * `claimOnceFlag`, and it is safe here precisely because the profile write
   * and the flag are one commit — a luxury `mergeBenchmark` does not have,
   * because its target is a different aggregate root.
   *
   * `merge` is pure.
   */
  recordPlayerResult<R>(
    args: {
      uid: string;
      teamScope: TeamScope;
      result: R;
      merge: (prev: import('./repository').PlayerProfileDoc | null, r: R) =>
        import('./repository').PlayerProfileDoc;
      now: string;
    },
  ): Promise<{ recorded: boolean }>;

  /**
   * Grant a wallet credit / free run and write its ledger row.
   *
   * INVARIANT: the balance change and the ledger row are ONE commit — a
   * balance without a ledger row is unauditable and a ledger row without a
   * balance is a support ticket.
   *
   * `idempotencyKey` is the Stripe session/event id. It is recorded on the
   * wallet and checked inside the atom, so a webhook redelivery (which is
   * guaranteed, not hypothetical) credits exactly once. Returns
   * `duplicate:true` for a replay, which is a SUCCESS — the webhook must be
   * acknowledged, not retried forever.
   */
  creditWallet(
    args: {
      uid: string;
      idempotencyKey: string;
      /** Signed deltas. Applied together. */
      credits?: number;
      bonusFreeRuns?: number;
      /** Non-balance wallet fields set by the same commit (plan, expiry, ids). */
      walletPatch?: Patch<Omit<Wallet, 'eventCredits' | 'bonusFreeRuns'>>;
      ledger: WalletTransaction;
      now: string;
    },
  ): Promise<{ duplicate: boolean; eventCredits: number }>;

  /**
   * Claim a referral: bind the invitee to the inviter and reward both.
   *
   * INVARIANTS, one commit across TWO wallets:
   *  - `referredBy` is set at most once per invitee. A creator cannot re-claim,
   *    and cannot switch inviters.
   *  - The inviter's `referralCount` never exceeds the anti-farming cap. The
   *    cap is checked against the value read in the SAME commit that increments
   *    it, so 20 simultaneous claims cannot all pass a cap of 20.
   *  - Self-referral is refused here, not upstream, because the ids are what
   *    this method has.
   *  - Both reward grants and both ledger rows land together — a one-sided
   *    referral is a support ticket.
   */
  claimReferral(
    args: {
      inviteeUid: string;
      inviterUid: string;
      bonusFreeRuns: number;
      maxPerReferrer: number;
      inviteeLedger: WalletTransaction;
      inviterLedger: WalletTransaction;
      now: string;
    },
  ): Promise<Outcome<
    { inviterReferralCount: number },
    'already-claimed' | 'self-referral' | 'referrer-cap-reached' | 'inviter-not-found'
  >>;


  // ── A11. Rate limiting ──────────────────────────────────────────────────

  /**
   * Advance a per-(bucket, uid) fixed-window counter and decide.
   *
   * INVARIANT: concurrent calls cannot both slip under the cap — read, decide
   * and write are one step. That is the ONLY reason this is a transaction
   * today, and it is why it belongs here rather than as a patch call.
   *
   * `step` is the pure limiter from @rushpoint/shared (`rateLimit`). Keeping it
   * a parameter means the policy stays testable without a database and the
   * repository stays ignorant of what a "window" is.
   *
   * FAIL-OPEN is the CALLER's decision, not this method's: a missing budget is
   * usually a typo'd bucket name silently disabling a limit, and swallowing it
   * here would hide that.
   */
  rateLimitStep(
    args: {
      bucket: string;
      uid: string;
      budget: RateBudget;
      step: (state: WindowState | null, budget: RateBudget, nowMs: number) => {
        allowed: boolean;
        nextState: WindowState;
        retryAfterMs: number;
      };
      nowMs: number;
    },
  ): Promise<{ allowed: boolean; retryAfterMs: number }>;


  // ── A12. Audit ──────────────────────────────────────────────────────────

  /**
   * Append an audit row.
   *
   * Listed among the atomic operations not because it races, but because it is
   * APPEND-ONLY and must stay that way: there is deliberately no update and no
   * delete anywhere on this interface for `auditLogs`. Every privileged
   * callable writes one (enforced statically by
   * `scripts/lib/callableHardening.mjs`), so the method exists to be the one
   * place that guarantee is expressed.
   *
   * It is intentionally NOT bundled into the operations it records: an audit
   * row is written AFTER its subject commits, from the returned result, so a
   * rolled-back attempt leaves no trail of something that never happened.
   */
  appendAuditLog(entry: AuditLogEntry): Promise<void>;
}


// ─── @rushpoint/data — domain types + data-layer primitives ───────────────────
//
// RULE 1: this package NEVER redefines a domain type. Every Game/Run/RunTeam/
// Task/Wallet/… shape is owned by @rushpoint/shared and is re-exported from here
// so a repository implementation has exactly ONE import.
//
// RULE 2: no backend type ever appears in this package's public surface. There is
// no `DocumentSnapshot`, no `Timestamp`, no `FieldValue`, no `QuerySnapshot`, no
// `PoolClient`. If you cannot express an operation without one, the operation is
// modelled wrong — add a named method instead of leaking the driver.
//
// RULE 3: no `serverTimestamp()`. RushPoint has never used one: every stored
// instant is a caller-supplied ISO-8601 string, decided by the callable, so the
// whole domain is deterministic and unit-testable. Every mutating method on this
// interface therefore takes its instants as parameters. An implementation MUST
// store exactly what it was handed and MUST NOT substitute a clock of its own.

// ── Domain types (re-export, never redefine) ─────────────────────────────────
export type {
  // primitives
  GeoPoint,
  GameMode,
  ScoringPreset,
  TaskType,
  TriggerMode,
  GameRequirement,
  StageStatus,
  TaskStatus,
  RunStatus,
  TeamStatus,
  Visibility,
  AccessCodeStatus,
  StaffPermission,
  AlertType,
  AnnouncementLevel,
  VerificationType,
  StationSubmissionStatus,
  VerifyOutcome,
  StationStatus,
  TransactionType,
  AuditActionType,
  EventPackageId,

  // aggregates
  Game,
  Stage,
  Task,
  TaskMedia,
  TaskStep,
  RegistrationField,
  ScoringOptions,
  GameBranding,
  PublicGame,
  PublicTask,
  PublicLike,
  Run,
  RunLeaderboard,
  LeaderboardEntry,
  LiveRunSummary,
  HotZone,
  StaffInvite,
  RunTeam,
  RunStageRecord,
  RunTaskRecord,
  TaskScoreBreakdown,
  TeamDevice,
  RunFeedback,
  AccessCode,
  Wallet,
  WalletTransaction,
  Announcement,
  AdminAlert,
  FlashMission,
  FeedItem,
  TeamLocation,
  StationSubmission,
  VerifyAttempt,
  AuditLogEntry,
} from '@rushpoint/shared';

// Types that live outside the types barrel but are part of a stored document.
export type { SafeZone } from '@rushpoint/shared';
export type { GuardianConsent } from '@rushpoint/shared';
export type { TeamPowerUps } from '@rushpoint/shared';
export type { TeamDiscoveryState } from '@rushpoint/shared';
export type { TaskStatusOverrides } from '@rushpoint/shared';
export type { WindowState, RateBudget } from '@rushpoint/shared';

import type {
  Game,
  Run,
  RunTeam,
  RunTaskRecord,
  RunStageRecord,
} from '@rushpoint/shared';


// ─── ABSENT vs NULL — the single most load-bearing rule in this package ───────
//
// Firestore distinguishes "the field is not in the document" from "the field is
// present and holds null", and RushPoint RELIES on that distinction:
//
//   Game.safeZone?: SafeZone | null
//     undefined ⇒ "the Builder did not send this field; leave whatever is stored"
//     null      ⇒ "the creator explicitly REMOVED the boundary; clear it"
//
// A naive `Partial<T>` cannot say the second thing, because `{ safeZone:
// undefined }` and `{}` are indistinguishable after JSON, after a spread, and
// after `Object.assign`. Postgres has the same problem in reverse (a column is
// always present; NULL is its only absence).
//
// So a patch in this package is an EXPLICIT three-valued thing:
//
//   field absent from the patch object   → leave the stored value alone
//   field present with a value           → write that value
//   field present with the DELETE token  → remove the field / set the column NULL
//
// `null` as a patch value is NOT a delete. It is a real stored null, and it is
// how `safeZone: null` ("cleared") reaches the database. Only DELETE removes.

/** The unique "remove this field" token. Compared by identity, never by value. */
export const DELETE = Symbol.for('@rushpoint/data:DELETE');
export type DeleteToken = typeof DELETE;

/** True when a patch field carries the delete token. Narrowing helper. */
export function isDelete(v: unknown): v is DeleteToken {
  return v === DELETE;
}

/**
 * A partial update of a stored document.
 *
 * `Patch<Game>` allows `{ title: 'x' }` (write), `{ safeZone: null }` (store a
 * real null) and `{ safeZone: DELETE }` (remove the field). It does NOT allow
 * `{ title: undefined }` at the type level for a required field, so "I meant to
 * clear it" can never be typo'd into "I meant to skip it".
 *
 * Patches are SHALLOW by contract. A nested object value REPLACES the stored
 * object wholesale — there is no merge and no dotted-path syntax. (Dotted keys
 * are a documented Firestore footgun in this codebase and a SQL implementation
 * cannot express them at all.) When you need to touch one element of a nested
 * collection, use the named method for it — e.g. `updateTaskRecord` rather than
 * patching `RunTeam.stages`.
 */
export type Patch<T> = {
  [K in keyof T]?: T[K] | DeleteToken;
};

/**
 * A patch that MAY NOT delete anything — for aggregates whose every field is
 * required (Run counters, leaderboards). Kept separate so an implementation can
 * reject a delete token structurally rather than at runtime.
 */
export type StrictPatch<T> = { [K in keyof T]?: T[K] };


// ─── Scopes — the addressing model, path-free ────────────────────────────────
//
// Firestore addresses everything by a nested path; Postgres addresses it by a
// key tuple. The interface uses the TUPLE, because a tuple maps onto a path
// trivially (`FIRESTORE_PATHS.team(...)`) while a path does not map onto a
// tuple. No method on this interface ever accepts a string path.

export interface GameScope {
  ownerUid: string;
  gameId: string;
}

export interface RunScope extends GameScope {
  runId: string;
}

export interface TeamScope extends RunScope {
  teamId: string;
}


// ─── Reads, pages and cursors ────────────────────────────────────────────────

/**
 * An opaque page cursor. It is a STRING to both implementations: Firestore
 * encodes its start-after key into it, Postgres encodes its keyset tuple. A
 * caller may store it and hand it back; a caller may never parse it.
 */
export type Cursor = string & { readonly __brand: 'rp.cursor' };

export interface Page<T> {
  items: T[];
  /** Absent when this was the last page. */
  nextCursor?: Cursor;
}

export interface PageRequest {
  limit: number;
  cursor?: Cursor;
}

/** Ascending/descending, for the handful of reads whose order is load-bearing. */
export type SortDir = 'asc' | 'desc';


// ─── Errors ──────────────────────────────────────────────────────────────────
//
// The repository throws exactly these. It never throws an `HttpsError`, a
// `GrpcError` or a `PostgresError` — mapping a repository error onto a callable
// error code is the CALLER's job, precisely so the same repository can back a
// callable, a script and a test.

export type DataErrorCode =
  /** The addressed document does not exist. */
  | 'not-found'
  /** A create collided with an existing id / unique key. */
  | 'already-exists'
  /** A precondition the operation itself asserts was false (see `detail`). */
  | 'failed-precondition'
  /** The backend gave up under contention. RETRIABLE. */
  | 'contended'
  /** The backend was unreachable or timed out. RETRIABLE. */
  | 'unavailable';

export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DataError';
  }
  /** True for the two codes a caller may safely retry with the same arguments. */
  get retriable(): boolean {
    return this.code === 'contended' || this.code === 'unavailable';
  }
}


// ─── Nested-collection shapes that WILL become rows ──────────────────────────
//
// `RunTeam.stages[]` is an array of `RunStageRecord`, each holding an array of
// `RunTaskRecord`. In Firestore that is one document; in Postgres it will be two
// tables (`run_stage_record`, `run_task_record`) keyed by (run_id, team_id, …).
//
// Every method that touches those records is therefore addressed by KEY, never
// by array index, and patches ONE record — so the SQL implementation is a single
// UPDATE and the Firestore implementation does the read-modify-rewrite of the
// nested array internally. Nothing above the repository may index `stages[i]`
// for the purpose of WRITING. (Reading the whole `RunTeam` and computing over
// `stages` in memory stays fine and is what routing and scoring do today.)

export type TaskRecordPatch = Patch<Omit<RunTaskRecord, 'taskId' | 'taskIndex'>>;
export type StageRecordPatch = Patch<Omit<RunStageRecord, 'stageId' | 'order' | 'tasks'>>;

/** Identifies one task record without any positional assumption. */
export interface TaskRecordKey {
  stageId: string;
  taskId: string;
}


// ─── Opaque-blob aggregates (Phase 1) ────────────────────────────────────────
//
// `Game.stages[]` stays a BLOB. Routing loads the whole game and filters in
// memory; scoring reads the template the same way. Decomposing the template into
// per-task rows now would change behaviour, so Phase 1 keeps `Game` a
// read-whole/write-whole aggregate and the SQL implementation stores `stages` as
// JSONB. There is deliberately NO `getTask`, NO `updateTask`, NO `listTasks` on
// the game side of this interface.
export type GameTemplate = Game;

/** The run document minus the derived station occupancy that no longer exists. */
export type RunDoc = Run;

export type TeamDoc = RunTeam;

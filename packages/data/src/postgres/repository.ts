// ─── PostgresRepository — the implementation that actually ships ─────────────
//
// The Firestore implementation exists to prove the interface. THIS one is the
// target: self-hosted Supabase on IONOS, against `supabase/migrations/*.sql`.
//
// FULLY IMPLEMENTED here: users · wallets (+transactions) · games (+discovery
// POIs) · runs (+task-status overrides) · run_teams (+run_team_stages,
// run_task_records, and the per-(team,task) maps folded onto them) · access
// codes · staff invites · audit logs · the station-slot and consume-once atoms.
//
// EVERYTHING ELSE throws `notImplemented(<method>)`, for exactly the reason the
// Firestore implementation gives: a stub returning `null`, `[]` or `0` is not
// merely stale, it is FABRICATED. An empty team list reads as "nobody joined";
// a zero occupancy count reads as "this station is free". A throw naming the
// method is the only honest placeholder.
//
//
// ── Behavioural differences from the Firestore implementation ────────────────
//
// Phase 1 is behaviour-neutral, and these are the places where the SCHEMA (not
// this file) makes that impossible. Each is stated here rather than discovered:
//
//  1. ABSENT vs NULL AT REST. Postgres has one NULL. `Patch<T>` stays
//     three-valued at the PATCH — omission never clears, `DELETE` always does —
//     which is what README §3 requires and what `contract.ts` asserts with
//     `absentDistinctFromNull: false`. See patch.ts.
//  2. `CreatorProfile.email` / `.photoURL` / `.lang` and its index signature do
//     not round-trip: `users` has no columns for them (GoTrue owns identity).
//  3. A non-uuid identity round-trips only where a `legacy_firebase_uid` column
//     exists (users, run_teams). See ids.ts.
//  4. `claimOnceFlag` needs a table this schema does not yet have. See
//     `ONCE_FLAGS_DDL` in atomic.ts — it is a named gap, not a silent one.
//  5. `consumeStaffInvite` cannot record `byUid` (no `used_by` column).

import {
  DataError,
  type AccessCode,
  type AdminAlert,
  type Announcement,
  type AuditLogEntry,
  type Cursor,
  type FeedItem,
  type FlashMission,
  type Game,
  type GameScope,
  type Page,
  type PageRequest,
  type Patch,
  type PublicGame,
  type PublicLike,
  type PublicTask,
  type RateBudget,
  type Run,
  type RunFeedback,
  type RunScope,
  type RunStageRecord,
  type RunTaskRecord,
  type RunTeam,
  type StaffInvite,
  type StageRecordPatch,
  type StationStatus,
  type StationSubmission,
  type TaskRecordPatch,
  type TeamLocation,
  type TeamScope,
  type Wallet,
  type WalletTransaction,
  type WindowState,
} from '../types';
import type { Tx, TxBody, TransactionOptions, Outcome } from '../transaction';
import type {
  AggregateRepository,
  AuditRepository,
  BenchmarkDoc,
  ChatMessage,
  ChatThread,
  ConsentToken,
  CreatorProfile,
  DiscoveryPoi,
  FeedbackRepository,
  LiveOpsRepository,
  LocationTrackPoint,
  PlayerProfileDoc,
  PublicSearchQuery,
  Repository,
  RunObjectRepository,
  StaffAttemptState,
  StationSecret,
  StationRepository,
  SweepBudget,
  SweepResult,
  Trackable,
  TrackableLogEntry,
  TransactionalRepository,
  Zone,
} from '../repository';
import type {
  AtomicOperations,
  ClaimActiveTaskResult,
  ClaimTaskSlotResult,
  CompleteTeamTaskResult,
  TaskCompletionWrite,
  TaskSlotCandidate,
  SlotChooser,
} from '../atomic';

import { guard, type SqlClient, type SqlQueryable, type SqlRow } from './client';
import { toUuid, toUuidOrNull, isUuid } from './ids';
import {
  buildInsert,
  encodeArrayLiteral,
  excludedAssignments,
  rowToDomain,
  type FieldMap,
  type InsertPlan,
} from './mapping';
import { buildSetClause, isEmptyPatch } from './patch';
import { makeRunInTransaction, unwrapTx } from './transaction';
import {
  claimActiveTask as sqlClaimActiveTask,
  claimOnceFlag as sqlClaimOnceFlag,
  claimTaskSlot as sqlClaimTaskSlot,
  consumeStaffInvite as sqlConsumeStaffInvite,
  releaseTaskSlot as sqlReleaseTaskSlot,
} from './atomic';
import {
  ACCESS_CODE_COLUMNS,
  AUDIT_COLUMNS,
  FOLDED_TASK_COLUMNS,
  GAME_COLUMNS,
  INVITE_COLUMNS,
  RUN_COLUMNS,
  RUN_TEAM_COLUMNS,
  STAGE_COLUMNS,
  TASK_COLUMNS,
  USER_COLUMNS,
  WALLET_COLUMNS,
  WALLET_TX_COLUMNS,
  instantToMs,
  msToInstant,
} from './schema';


// ═══════════════════════════════════════════════════════════════════════════
// Identity resolution in SELECTs
// ═══════════════════════════════════════════════════════════════════════════
//
// `Run.ownerUid` and `RunTeam.ownerUid` are domain strings; the columns are
// `uuid`. The original string lives in `users.legacy_firebase_uid` (see ids.ts),
// so every read that must return an owner identity JOINS `users` and reads it
// back. It is never guessed and never reconstructed from the uuid.

const OWNER = `coalesce(u.legacy_firebase_uid, u.uid::text) as domain_owner_uid`;
const USER_SELECT = `select u.*, coalesce(u.legacy_firebase_uid, u.uid::text) as domain_uid from users u`;
const WALLET_SELECT =
  `select w.*, coalesce(u.legacy_firebase_uid, u.uid::text) as domain_uid
     from wallets w join users u on u.uid = w.uid`;
const GAME_SELECT = `select g.*, ${OWNER} from games g join users u on u.uid = g.owner_uid`;
const RUN_SELECT = `select r.*, ${OWNER} from runs r join users u on u.uid = r.owner_uid`;
const TEAM_SELECT =
  `select t.*, coalesce(t.legacy_firebase_uid, t.id::text) as domain_team_id, ${OWNER}
     from run_teams t join users u on u.uid = t.owner_uid`;
const INVITE_SELECT_LIST = `i.*, ${OWNER}`;
const INVITE_SELECT = `select ${INVITE_SELECT_LIST} from staff_invites i join users u on u.uid = i.owner_uid`;
const CODE_SELECT = `select c.*, ${OWNER} from access_codes c join users u on u.uid = c.owner_uid`;


// ═══════════════════════════════════════════════════════════════════════════
// Cursors
// ═══════════════════════════════════════════════════════════════════════════
//
// KEYSET, not OFFSET. A `Cursor` is opaque to callers by contract, so its
// encoding is this file's business — it carries the ORDER-KEY VALUES of the last
// row of the page and resumes with a row-value comparison
// (`(created_at, id) < ($1, $2)`), which is index-friendly and, unlike OFFSET,
// cannot skip or repeat a row when the table is written between pages.
//
// Plain JSON rather than base64: `btoa` lives in `lib.dom` and `Buffer` needs
// `@types/node`, and this package's tsconfig has NEITHER. Same constraint, same
// answer, as the Firestore implementation.

function encodeCursor(values: unknown[]): Cursor {
  return JSON.stringify(values) as Cursor;
}

function decodeCursor(cursor: Cursor | undefined, what: string): unknown[] | null {
  if (cursor === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(cursor as unknown as string);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch (e) {
    throw new DataError('failed-precondition', `${what}: malformed cursor`, {
      cause: String((e as Error).message),
    });
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// Stubs
// ═══════════════════════════════════════════════════════════════════════════

const IMPLEMENTED_AGGREGATES =
  'users, wallets(+transactions), games(+discoveryPois), runs, teams(+stages/tasks), ' +
  'accessCodes, staffInvites, auditLogs, and the station-slot / consume-once atoms';

function notImplemented(method: string): never {
  throw new DataError(
    'failed-precondition',
    `PostgresRepository.${method}() is not implemented. This phase implements: ${IMPLEMENTED_AGGREGATES}.`,
    { method },
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// The bound repository (identical inside and outside a transaction)
// ═══════════════════════════════════════════════════════════════════════════
//
// Every method routes through `this.q`, which is the client outside a
// transaction and the transaction handle inside one. That is what makes "the
// signature is identical either way" true by CONSTRUCTION rather than by
// discipline — the same class, the same code, one different queryable.

class BoundPostgresRepository implements TransactionalRepository {
  constructor(protected readonly q: SqlQueryable) {}

  // ── low-level helpers ───────────────────────────────────────────────────

  protected async one<T>(
    sql: string,
    params: unknown[],
    map: FieldMap,
    what: string,
  ): Promise<T | null> {
    return guard(what, async () => {
      const r = await this.q.query<SqlRow>(sql, params);
      return r.rows.length === 0 ? null : rowToDomain<T>(r.rows[0], map);
    });
  }

  protected async many<T>(
    sql: string,
    params: unknown[],
    map: FieldMap,
    what: string,
  ): Promise<T[]> {
    return guard(what, async () => {
      const r = await this.q.query<SqlRow>(sql, params);
      return r.rows.map((row) => rowToDomain<T>(row, map));
    });
  }

  /**
   * Keyset page over `(orderCol desc, tieCol desc)`.
   *
   * `where` must already be a complete predicate using `$1…$n`; the cursor
   * comparison and the limit are appended after it.
   */
  protected async page<T>(
    select: string,
    where: string,
    params: unknown[],
    orderCol: string,
    tieCol: string,
    req: PageRequest,
    map: FieldMap,
    what: string,
    rowKeys: [string, string],
  ): Promise<Page<T>> {
    return guard(what, async () => {
      const limit = Math.max(1, Math.floor(req.limit));
      const after = decodeCursor(req.cursor, what);
      const p = params.slice();
      let sql = `${select} where ${where}`;
      if (after) {
        sql += ` and (${orderCol}, ${tieCol}) < ($${p.length + 1}::timestamptz, $${p.length + 2}::text)`;
        p.push(after[0], String(after[1]));
      }
      sql += ` order by ${orderCol} desc, ${tieCol} desc limit ${limit}`;

      const r = await this.q.query<SqlRow>(sql, p);
      const items = r.rows.map((row) => rowToDomain<T>(row, map));
      const out: Page<T> = { items };
      if (r.rows.length === limit) {
        const last = r.rows[r.rows.length - 1];
        const at = last[rowKeys[0]];
        out.nextCursor = encodeCursor([
          at instanceof Date ? at.toISOString() : String(at),
          String(last[rowKeys[1]]),
        ]);
      }
      return out;
    });
  }

  /** Add a hand-managed column to an insert plan (identity columns, mostly). */
  protected append(plan: InsertPlan, column: string, cast: string, value: unknown): void {
    plan.columns.push(column);
    plan.placeholders.push(`$${plan.params.length + 1}::${cast}`);
    plan.params.push(value);
  }

  /**
   * `UPDATE … SET … WHERE …`, three-valued patch semantics, `not-found` when
   * the row is absent.
   *
   * An EMPTY patch is a silent no-op and never reaches the database: `UPDATE t
   * SET WHERE …` is a syntax error, so a semantic no-op would otherwise become a
   * spurious failure. This mirrors the Firestore implementation exactly, and for
   * the same reason.
   */
  protected async patchRow(
    table: string,
    patch: Record<string, unknown> | undefined,
    map: FieldMap,
    where: (nextIndex: number) => { sql: string; params: unknown[] },
    what: string,
  ): Promise<void> {
    if (isEmptyPatch(patch)) return;
    const set = buildSetClause(patch, map, what);
    if (set.assignments.length === 0) return;
    const w = where(set.nextIndex);
    return guard(what, async () => {
      const r = await this.q.query(
        `update ${table} set ${set.assignments.join(', ')} where ${w.sql}`,
        set.params.concat(w.params),
      );
      if ((r.rowCount ?? 0) === 0) throw new DataError('not-found', what);
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 1. Users
  // ═════════════════════════════════════════════════════════════════════════

  async getProfile(uid: string): Promise<CreatorProfile | null> {
    return this.one<CreatorProfile>(
      `${USER_SELECT} where u.uid = $1::uuid`, [toUuid(uid)], USER_COLUMNS, 'getProfile',
    );
  }

  /**
   * Create-or-replace.
   *
   * NOTE `users.uid` references `auth.users(id)`: a creator row cannot exist
   * before the identity does. That is not this repository's job to arrange —
   * GoTrue creates the auth user and this row follows.
   */
  async putProfile(profile: CreatorProfile): Promise<void> {
    const plan = buildInsert(profile as unknown as Record<string, unknown>, USER_COLUMNS, 'putProfile');
    this.append(plan, 'uid', 'uuid', toUuid(profile.uid));
    this.append(plan, 'legacy_firebase_uid', 'text', isUuid(profile.uid) ? null : profile.uid);
    await guard('putProfile', () => this.q.query(
      `insert into users (${plan.columns.join(', ')}) values (${plan.placeholders.join(', ')})
       on conflict (uid) do update set ${excludedAssignments(plan)}`,
      plan.params,
    ));
  }

  async patchProfile(uid: string, patch: Patch<CreatorProfile>): Promise<void> {
    await this.patchRow(
      'users', patch as Record<string, unknown>, USER_COLUMNS,
      (i) => ({ sql: `uid = $${i}::uuid`, params: [toUuid(uid)] }),
      'patchProfile',
    );
  }

  /**
   * Hard delete of the creator row.
   *
   * Unlike Firestore — where deleting a document leaves its sub-collections
   * behind and `sweepUserSubtree` has to walk them — every child here is
   * `on delete cascade`, so this ONE statement removes the games, runs, teams
   * and wallet too. That is a real behavioural difference and it is why the
   * account-deletion caller must still drive the sweep for the things Postgres
   * does NOT own (Storage objects, Stripe state).
   */
  async deleteProfile(uid: string): Promise<void> {
    await guard('deleteProfile', () =>
      this.q.query(`delete from users where uid = $1::uuid`, [toUuid(uid)]));
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 2. Wallets
  // ═════════════════════════════════════════════════════════════════════════

  async getWallet(uid: string): Promise<Wallet | null> {
    return this.one<Wallet>(
      `${WALLET_SELECT} where w.uid = $1::uuid`, [toUuid(uid)], WALLET_COLUMNS, 'getWallet',
    );
  }

  async putWallet(wallet: Wallet): Promise<void> {
    const plan = buildInsert(wallet as unknown as Record<string, unknown>, WALLET_COLUMNS, 'putWallet');
    this.append(plan, 'uid', 'uuid', toUuid(wallet.uid));
    await guard('putWallet', () => this.q.query(
      `insert into wallets (${plan.columns.join(', ')}) values (${plan.placeholders.join(', ')})
       on conflict (uid) do update set ${excludedAssignments(plan)}`,
      plan.params,
    ));
  }

  async patchWallet(uid: string, patch: Patch<Wallet>): Promise<void> {
    await this.patchRow(
      'wallets', patch as Record<string, unknown>, WALLET_COLUMNS,
      (i) => ({ sql: `uid = $${i}::uuid`, params: [toUuid(uid)] }),
      'patchWallet',
    );
  }

  async appendTransaction(uid: string, tx: WalletTransaction): Promise<void> {
    const plan = buildInsert(tx as unknown as Record<string, unknown>, WALLET_TX_COLUMNS, 'appendTransaction');
    this.append(plan, 'uid', 'uuid', toUuid(uid));
    await guard('appendTransaction', () => this.q.query(
      `insert into wallet_transactions (${plan.columns.join(', ')})
       values (${plan.placeholders.join(', ')})
       on conflict (id) do nothing`,
      plan.params,
    ));
  }

  async listTransactions(uid: string, page: PageRequest): Promise<Page<WalletTransaction>> {
    return this.page<WalletTransaction>(
      `select * from wallet_transactions`, `uid = $1::uuid`, [toUuid(uid)],
      'created_at', 'id::text', page, WALLET_TX_COLUMNS, 'listTransactions', ['created_at', 'id'],
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 3. Games
  // ═════════════════════════════════════════════════════════════════════════
  //
  // `approxLocation` is ONE domain field over THREE columns, so it is expanded
  // on the way in and recomposed on the way out. It is split because the gallery
  // FILTERS and SORTS on it and a jsonb point cannot use a btree range scan.

  private static readApproxLocation(row: SqlRow): Game['approxLocation'] | undefined {
    const lat = row['approx_lat'];
    const lng = row['approx_lng'];
    if (lat === null || lat === undefined || lng === null || lng === undefined) return undefined;
    const label = row['approx_label'];
    const out: { lat: number; lng: number; label?: string } =
      { lat: Number(lat), lng: Number(lng) };
    if (label !== null && label !== undefined) out.label = String(label);
    return out;
  }

  private gameFromRow(row: SqlRow): Game {
    const game = rowToDomain<Game>(row, GAME_COLUMNS);
    const loc = BoundPostgresRepository.readApproxLocation(row);
    if (loc) (game as { approxLocation?: unknown }).approxLocation = loc;
    return game;
  }

  async getGame(scope: GameScope): Promise<Game | null> {
    return guard('getGame', async () => {
      const r = await this.q.query<SqlRow>(
        `${GAME_SELECT} where g.id = $1::text and g.owner_uid = $2::uuid`,
        [scope.gameId, toUuid(scope.ownerUid)],
      );
      return r.rows.length === 0 ? null : this.gameFromRow(r.rows[0]);
    });
  }

  async putGame(game: Game): Promise<void> {
    const plan = buildInsert(game as unknown as Record<string, unknown>, GAME_COLUMNS, 'putGame');
    this.append(plan, 'id', 'text', game.id);
    this.append(plan, 'owner_uid', 'uuid', toUuid(game.ownerUid));
    const loc = game.approxLocation;
    this.append(plan, 'approx_lat', 'double precision', loc ? loc.lat : null);
    this.append(plan, 'approx_lng', 'double precision', loc ? loc.lng : null);
    this.append(plan, 'approx_label', 'text', loc && loc.label !== undefined ? loc.label : null);
    await guard('putGame', () => this.q.query(
      `insert into games (${plan.columns.join(', ')}) values (${plan.placeholders.join(', ')})
       on conflict (id) do update set ${excludedAssignments(plan)}`,
      plan.params,
    ));
  }

  async patchGame(scope: GameScope, patch: Patch<Game>): Promise<void> {
    const rest = { ...(patch as Record<string, unknown>) };
    // Expand the composite BEFORE the generic builder sees it, so the builder
    // never has to know that one field can mean three columns.
    let extra: string[] = [];
    let extraParams: unknown[] = [];
    if ('approxLocation' in rest) {
      const v = rest['approxLocation'] as { lat: number; lng: number; label?: string } | null | undefined;
      delete rest['approxLocation'];
      if (v !== undefined) {
        const loc = v && typeof v === 'object' && 'lat' in v ? v : null;
        extra = ['approx_lat = $A::double precision', 'approx_lng = $B::double precision', 'approx_label = $C::text'];
        extraParams = [loc ? loc.lat : null, loc ? loc.lng : null, loc && loc.label !== undefined ? loc.label : null];
      }
    }
    if (isEmptyPatch(rest) && extra.length === 0) return;

    const set = buildSetClause(rest, GAME_COLUMNS, 'patchGame');
    let i = set.nextIndex;
    const expanded = extra.map((frag) => frag.replace(/\$[ABC]/, () => `$${i++}`));
    const assignments = set.assignments.concat(expanded);
    if (assignments.length === 0) return;

    await guard('patchGame', async () => {
      const r = await this.q.query(
        `update games set ${assignments.join(', ')}
          where id = $${i}::text and owner_uid = $${i + 1}::uuid`,
        set.params.concat(extraParams, [scope.gameId, toUuid(scope.ownerUid)]),
      );
      if ((r.rowCount ?? 0) === 0) throw new DataError('not-found', 'patchGame', { ...scope });
    });
  }

  async deleteGame(scope: GameScope): Promise<void> {
    await guard('deleteGame', () => this.q.query(
      `delete from games where id = $1::text and owner_uid = $2::uuid`,
      [scope.gameId, toUuid(scope.ownerUid)],
    ));
  }

  async listGames(ownerUid: string, page: PageRequest): Promise<Page<Game>> {
    return this.pageGames(`g.owner_uid = $1::uuid and g.deleted_at is null`, ownerUid, page, 'listGames');
  }

  async listDeletedGames(ownerUid: string, page: PageRequest): Promise<Page<Game>> {
    return this.pageGames(`g.owner_uid = $1::uuid and g.deleted_at is not null`, ownerUid, page, 'listDeletedGames');
  }

  private async pageGames(
    where: string, ownerUid: string, req: PageRequest, what: string,
  ): Promise<Page<Game>> {
    return guard(what, async () => {
      const limit = Math.max(1, Math.floor(req.limit));
      const after = decodeCursor(req.cursor, what);
      const params: unknown[] = [toUuid(ownerUid)];
      let sql = `${GAME_SELECT} where ${where}`;
      if (after) {
        sql += ` and (g.created_at, g.id) < ($2::timestamptz, $3::text)`;
        params.push(after[0], String(after[1]));
      }
      sql += ` order by g.created_at desc, g.id desc limit ${limit}`;
      const r = await this.q.query<SqlRow>(sql, params);
      const out: Page<Game> = { items: r.rows.map((row) => this.gameFromRow(row)) };
      if (r.rows.length === limit) {
        const last = r.rows[r.rows.length - 1];
        const at = last['created_at'];
        out.nextCursor = encodeCursor([
          at instanceof Date ? at.toISOString() : String(at), String(last['id']),
        ]);
      }
      return out;
    });
  }

  // ── discovery POIs (server-secret coordinates AND answers; own table) ────

  async getDiscoveryPoi(scope: GameScope, poiId: string): Promise<DiscoveryPoi | null> {
    return guard('getDiscoveryPoi', async () => {
      const r = await this.q.query<SqlRow>(
        `select * from discovery_pois where game_id = $1::text and id = $2::text and owner_uid = $3::uuid`,
        [scope.gameId, poiId, toUuid(scope.ownerUid)],
      );
      return r.rows.length === 0 ? null : poiFromRow(r.rows[0], scope);
    });
  }

  async putDiscoveryPoi(scope: GameScope, poi: DiscoveryPoi): Promise<void> {
    await guard('putDiscoveryPoi', () => this.q.query(
      `insert into discovery_pois
         (id, game_id, owner_uid, lat, lng, radius_meters, title, flavor_text,
          question, answers, bonus_points, hint, created_at)
       values ($1::text, $2::text, $3::uuid, $4::double precision, $5::double precision,
               $6::double precision, $7::text, $8::text, $9::text, $10::text[],
               $11::integer, $12::text, $13::timestamptz)
       on conflict (game_id, id) do update set
         lat = excluded.lat, lng = excluded.lng, radius_meters = excluded.radius_meters,
         title = excluded.title, flavor_text = excluded.flavor_text,
         question = excluded.question, answers = excluded.answers,
         bonus_points = excluded.bonus_points, hint = excluded.hint`,
      [
        poi.id, scope.gameId, toUuid(scope.ownerUid), poi.lat, poi.lng, poi.radiusMeters,
        poi.title ?? '', (poi as { flavorText?: string }).flavorText ?? null,
        poi.question ?? '',
        encodeArrayLiteral((poi as { answers?: string[] }).answers ?? (poi.answer ? [poi.answer] : []), 'putDiscoveryPoi'),
        poi.points ?? (poi as { bonusPoints?: number }).bonusPoints ?? 0,
        (poi as { hint?: string }).hint ?? null,
        poi.createdAt,
      ],
    ));
  }

  async deleteDiscoveryPoi(scope: GameScope, poiId: string): Promise<void> {
    await guard('deleteDiscoveryPoi', () => this.q.query(
      `delete from discovery_pois where game_id = $1::text and id = $2::text and owner_uid = $3::uuid`,
      [scope.gameId, poiId, toUuid(scope.ownerUid)],
    ));
  }

  async listDiscoveryPois(scope: GameScope): Promise<DiscoveryPoi[]> {
    return guard('listDiscoveryPois', async () => {
      const r = await this.q.query<SqlRow>(
        `select * from discovery_pois where game_id = $1::text and owner_uid = $2::uuid order by id`,
        [scope.gameId, toUuid(scope.ownerUid)],
      );
      return r.rows.map((row) => poiFromRow(row, scope));
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 5. Runs
  // ═════════════════════════════════════════════════════════════════════════
  //
  // `taskStatusOverrides` is a CHILD TABLE here (`run_task_overrides`), not a
  // map on the run row — so one stop can be paused without rewriting the map,
  // and so the per-task override has a real primary key. It is read as an
  // aggregate and written as a REPLACE of the whole map, which is exactly what
  // the domain shape means.

  private async readOverrides(runId: string): Promise<Record<string, StationStatus> | undefined> {
    const r = await this.q.query<{ task_id: string; status: string }>(
      `select task_id, status from run_task_overrides where run_id = $1::text`, [runId],
    );
    if (r.rows.length === 0) return undefined;
    const out: Record<string, StationStatus> = {};
    for (const row of r.rows) out[row.task_id] = row.status as StationStatus;
    return out;
  }

  private async writeOverrides(
    runId: string, overrides: Record<string, StationStatus> | null, now: string,
  ): Promise<void> {
    await this.q.query(`delete from run_task_overrides where run_id = $1::text`, [runId]);
    if (!overrides) return;
    for (const taskId of Object.keys(overrides)) {
      await this.q.query(
        `insert into run_task_overrides (run_id, task_id, status, updated_at)
         values ($1::text, $2::text, $3::station_status, $4::timestamptz)`,
        [runId, taskId, overrides[taskId], now],
      );
    }
  }

  async getRun(scope: RunScope): Promise<Run | null> {
    return guard('getRun', async () => {
      const r = await this.q.query<SqlRow>(
        `${RUN_SELECT} where r.id = $1::text and r.game_id = $2::text and r.owner_uid = $3::uuid`,
        [scope.runId, scope.gameId, toUuid(scope.ownerUid)],
      );
      if (r.rows.length === 0) return null;
      const run = rowToDomain<Run>(r.rows[0], RUN_COLUMNS);
      const overrides = await this.readOverrides(scope.runId);
      if (overrides) (run as { taskStatusOverrides?: unknown }).taskStatusOverrides = overrides;
      return run;
    });
  }

  async putRun(run: Run): Promise<void> {
    const plan = buildInsert(run as unknown as Record<string, unknown>, RUN_COLUMNS, 'putRun');
    this.append(plan, 'id', 'text', run.id);
    this.append(plan, 'game_id', 'text', run.gameId);
    this.append(plan, 'owner_uid', 'uuid', toUuid(run.ownerUid));
    await guard('putRun', async () => {
      await this.q.query(
        `insert into runs (${plan.columns.join(', ')}) values (${plan.placeholders.join(', ')})
         on conflict (id) do update set ${excludedAssignments(plan)}`,
        plan.params,
      );
      // A `put*` is create-or-REPLACE, so the child map is replaced too.
      await this.writeOverrides(run.id, run.taskStatusOverrides ?? null, run.updatedAt);
    });
  }

  async patchRun(scope: RunScope, patch: Patch<Run>): Promise<void> {
    const rest = { ...(patch as Record<string, unknown>) };
    const hasOverrides = 'taskStatusOverrides' in rest && rest['taskStatusOverrides'] !== undefined;
    const overrides = rest['taskStatusOverrides'];
    delete rest['taskStatusOverrides'];

    await guard('patchRun', async () => {
      const set = buildSetClause(rest, RUN_COLUMNS, 'patchRun');
      // The row must exist even when the patch writes nothing but overrides —
      // `patch*` means "modify a document that exists", so a missing run is
      // `not-found` rather than a silent no-op.
      const i = set.nextIndex;
      const r = await this.q.query(
        set.assignments.length > 0
          ? `update runs set ${set.assignments.join(', ')}
              where id = $${i}::text and game_id = $${i + 1}::text and owner_uid = $${i + 2}::uuid`
          : `select 1 from runs where id = $${i}::text and game_id = $${i + 1}::text and owner_uid = $${i + 2}::uuid`,
        set.params.concat([scope.runId, scope.gameId, toUuid(scope.ownerUid)]),
      );
      const touched = set.assignments.length > 0 ? (r.rowCount ?? 0) : r.rows.length;
      if (touched === 0) throw new DataError('not-found', 'run', { ...scope });

      if (hasOverrides) {
        const now = typeof rest['updatedAt'] === 'string' ? String(rest['updatedAt']) : new Date(0).toISOString();
        await this.writeOverrides(
          scope.runId,
          overrides === null || overrides === undefined
            ? null
            : (overrides as Record<string, StationStatus>),
          now,
        );
      }
    });
  }

  async deleteRun(scope: RunScope): Promise<void> {
    await guard('deleteRun', () => this.q.query(
      `delete from runs where id = $1::text and game_id = $2::text and owner_uid = $3::uuid`,
      [scope.runId, scope.gameId, toUuid(scope.ownerUid)],
    ));
  }

  async listRunsForGame(scope: GameScope, page: PageRequest): Promise<Page<Run>> {
    return this.pageRuns(
      `r.game_id = $1::text and r.owner_uid = $2::uuid`,
      [scope.gameId, toUuid(scope.ownerUid)], page, 'listRunsForGame',
    );
  }

  async listLiveRunsForOwner(ownerUid: string): Promise<Run[]> {
    return this.many<Run>(
      `${RUN_SELECT} where r.owner_uid = $1::uuid and r.status = 'live' order by r.created_at desc`,
      [toUuid(ownerUid)], RUN_COLUMNS, 'listLiveRunsForOwner',
    );
  }

  async listFinishedRunsBefore(finishedBefore: string, page: PageRequest): Promise<Page<Run>> {
    return this.pageRuns(
      `r.status = 'finished' and r.finished_at is not null and r.finished_at < $1::timestamptz`,
      [finishedBefore], page, 'listFinishedRunsBefore',
    );
  }

  private async pageRuns(
    where: string, params: unknown[], req: PageRequest, what: string,
  ): Promise<Page<Run>> {
    return this.page<Run>(RUN_SELECT, where, params, 'r.created_at', 'r.id',
      req, RUN_COLUMNS, what, ['created_at', 'id']);
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 6. Teams — three tables that used to be one document
  // ═════════════════════════════════════════════════════════════════════════

  async getTeam(scope: TeamScope): Promise<RunTeam | null> {
    return guard('getTeam', async () => {
      const teamUuid = toUuid(scope.teamId);
      const r = await this.q.query<SqlRow>(
        `${TEAM_SELECT} where t.run_id = $1::text and t.id = $2::uuid and t.owner_uid = $3::uuid`,
        [scope.runId, teamUuid, toUuid(scope.ownerUid)],
      );
      if (r.rows.length === 0) return null;
      const team = rowToDomain<RunTeam>(r.rows[0], RUN_TEAM_COLUMNS);
      await this.attachStages(team, scope.runId, teamUuid);
      return team;
    });
  }

  /**
   * Rebuild `stages[] -> tasks[]` AND the per-(team,task) maps that used to hang
   * off the team document, so the object a caller receives is the same shape
   * Firestore returned. See the "ALSO NOT HERE" block in schema.ts for the
   * field-by-field mapping.
   */
  private async attachStages(team: RunTeam, runId: string, teamUuid: string): Promise<void> {
    const stageRows = await this.q.query<SqlRow>(
      `select * from run_team_stages where run_id = $1::text and team_id = $2::uuid
        order by stage_order`,
      [runId, teamUuid],
    );
    const taskRows = await this.q.query<SqlRow>(
      `select * from run_task_records where run_id = $1::text and team_id = $2::uuid
        order by stage_id, task_index`,
      [runId, teamUuid],
    );

    const byStage = new Map<string, RunTaskRecord[]>();
    const hintsUsed: string[] = [];
    const attempts: Record<string, number> = {};
    const stepProgress: Record<string, number> = {};
    const stationHints: Record<string, number[]> = {};
    const smartVerifications: Record<string, string[]> = {};
    const answerPenalties: Record<string, Record<string, unknown>> = {};

    for (const row of taskRows.rows) {
      const stageId = String(row['stage_id']);
      const rec = rowToDomain<RunTaskRecord>(row, TASK_COLUMNS);
      const list = byStage.get(stageId) ?? [];
      list.push(rec);
      byStage.set(stageId, list);

      const taskId = String(row[FOLDED_TASK_COLUMNS.attempts && 'task_id']);
      if (row[FOLDED_TASK_COLUMNS.hintPurchased] === true) hintsUsed.push(taskId);
      const n = Number(row[FOLDED_TASK_COLUMNS.attempts] ?? 0);
      if (n > 0) attempts[taskId] = n;
      const steps = Number(row[FOLDED_TASK_COLUMNS.stepProgress] ?? 0);
      if (steps > 0) stepProgress[taskId] = steps;
      const hints = row[FOLDED_TASK_COLUMNS.stationHintsUsed];
      if (Array.isArray(hints) && hints.length > 0) stationHints[taskId] = hints.map(Number);
      const verifs = row[FOLDED_TASK_COLUMNS.smartVerifications];
      if (Array.isArray(verifs) && verifs.length > 0) smartVerifications[taskId] = verifs.map(String);

      const charged = Number(row[FOLDED_TASK_COLUMNS.penaltyCharged] ?? 0);
      const hash = row[FOLDED_TASK_COLUMNS.lastAnswerHash];
      const cooldown = row[FOLDED_TASK_COLUMNS.cooldownUntil];
      if (charged > 0 || (typeof hash === 'string' && hash !== '') || cooldown) {
        const entry: Record<string, unknown> = {
          charged,
          lastHash: typeof hash === 'string' ? hash : '',
          cooldownUntil: cooldown ? Number(instantToMs(cooldown)) : 0,
        };
        const lastFailure = row[FOLDED_TASK_COLUMNS.lastFailureAt];
        if (lastFailure) entry.lastFailureAt = Number(instantToMs(lastFailure));
        const lockout = row[FOLDED_TASK_COLUMNS.lockoutMs];
        if (lockout !== null && lockout !== undefined) entry.lockoutMs = Number(lockout);
        const failures = Number(row[FOLDED_TASK_COLUMNS.failureCount] ?? 0);
        if (failures > 0) entry.failureCount = failures;
        answerPenalties[taskId] = entry;
      }
    }

    const stages: RunStageRecord[] = stageRows.rows.map((row) => {
      const stage = rowToDomain<RunStageRecord>(row, STAGE_COLUMNS);
      stage.tasks = byStage.get(String(row['stage_id'])) ?? [];
      return stage;
    });
    team.stages = stages;

    const t = team as unknown as Record<string, unknown>;
    if (hintsUsed.length > 0) t.taskHintsUsed = hintsUsed;
    if (Object.keys(attempts).length > 0) t.taskAttempts = attempts;
    if (Object.keys(stepProgress).length > 0) t.taskStepProgress = stepProgress;
    if (Object.keys(stationHints).length > 0) t.stationHintsUsed = stationHints;
    if (Object.keys(smartVerifications).length > 0) t.smartVerifications = smartVerifications;
    if (Object.keys(answerPenalties).length > 0) t.answerPenalties = answerPenalties;
  }

  async putTeam(team: RunTeam): Promise<void> {
    const teamUuid = toUuid(team.id);
    const plan = buildInsert(team as unknown as Record<string, unknown>, RUN_TEAM_COLUMNS, 'putTeam');
    this.append(plan, 'id', 'uuid', teamUuid);
    this.append(plan, 'run_id', 'text', team.runId);
    this.append(plan, 'owner_uid', 'uuid', toUuid(team.ownerUid));
    this.append(plan, 'legacy_firebase_uid', 'text', isUuid(team.id) ? null : team.id);

    await guard('putTeam', async () => {
      await this.q.query(
        `insert into run_teams (${plan.columns.join(', ')}) values (${plan.placeholders.join(', ')})
         on conflict (run_id, id) do update set ${excludedAssignments(plan)}`,
        plan.params,
      );
      await this.writeStages(team, team.runId, teamUuid, team.stages ?? []);
    });
  }

  /**
   * Rewrite the whole progress tree.
   *
   * DELETE-then-INSERT rather than a diff: `run_team_stages` cascades to
   * `run_task_records`, this is only reached from run build / whole-stage
   * operations, and the alternative — an upsert plus a delete of the rows that
   * vanished — is three statements that can each be wrong instead of two that
   * cannot. A PER-TASK change must go through `patchTaskRecord`, which is a
   * single-row UPDATE and does not rewrite rows it did not change (README §5).
   */
  private async writeStages(
    team: { ownerUid: string }, runId: string, teamUuid: string, stages: RunStageRecord[],
  ): Promise<void> {
    await this.q.query(
      `delete from run_team_stages where run_id = $1::text and team_id = $2::uuid`,
      [runId, teamUuid],
    );
    for (const stage of stages) {
      const plan = buildInsert(stage as unknown as Record<string, unknown>, STAGE_COLUMNS, 'putTeam.stage');
      this.append(plan, 'run_id', 'text', runId);
      this.append(plan, 'team_id', 'uuid', teamUuid);
      this.append(plan, 'stage_id', 'text', stage.stageId);
      await this.q.query(
        `insert into run_team_stages (${plan.columns.join(', ')}) values (${plan.placeholders.join(', ')})`,
        plan.params,
      );
      for (const task of stage.tasks ?? []) {
        const tp = buildInsert(task as unknown as Record<string, unknown>, TASK_COLUMNS, 'putTeam.task');
        this.append(tp, 'run_id', 'text', runId);
        this.append(tp, 'team_id', 'uuid', teamUuid);
        this.append(tp, 'task_id', 'text', task.taskId);
        this.append(tp, 'stage_id', 'text', stage.stageId);
        await this.q.query(
          `insert into run_task_records (${tp.columns.join(', ')}) values (${tp.placeholders.join(', ')})`,
          tp.params,
        );
      }
    }
  }

  /**
   * Top-level team fields only.
   *
   * `stages` is stripped rather than rejected, matching the reference
   * implementation (`inMemory.ts` does `delete shallow.stages`). The type
   * already forbids it; the strip is what makes a JSON round trip that
   * reintroduced the key harmless instead of a 500.
   */
  async patchTeam(scope: TeamScope, patch: Patch<Omit<RunTeam, 'stages'>>): Promise<void> {
    const shallow = { ...(patch as Record<string, unknown>) };
    delete shallow.stages;
    await this.patchRow(
      'run_teams', shallow, RUN_TEAM_COLUMNS,
      (i) => ({
        sql: `run_id = $${i}::text and id = $${i + 1}::uuid`,
        params: [scope.runId, toUuid(scope.teamId)],
      }),
      'patchTeam',
    );
  }

  async deleteTeam(scope: TeamScope): Promise<void> {
    await guard('deleteTeam', () => this.q.query(
      `delete from run_teams where run_id = $1::text and id = $2::uuid`,
      [scope.runId, toUuid(scope.teamId)],
    ));
  }

  async listTeams(scope: RunScope, page: PageRequest): Promise<Page<RunTeam>> {
    // Paged reads do NOT hydrate the progress tree: one extra query per team per
    // page is a fan-out the interface never promised. Callers that need the tree
    // use getTeam / listAllTeams.
    return this.page<RunTeam>(
      TEAM_SELECT, `t.run_id = $1::text and t.owner_uid = $2::uuid`,
      [scope.runId, toUuid(scope.ownerUid)],
      't.updated_at', 't.id::text', page, RUN_TEAM_COLUMNS, 'listTeams', ['updated_at', 'id'],
    );
  }

  async listAllTeams(scope: RunScope): Promise<RunTeam[]> {
    return guard('listAllTeams', async () => {
      const r = await this.q.query<SqlRow>(
        `${TEAM_SELECT} where t.run_id = $1::text and t.owner_uid = $2::uuid order by t.id`,
        [scope.runId, toUuid(scope.ownerUid)],
      );
      const out: RunTeam[] = [];
      for (const row of r.rows) {
        const team = rowToDomain<RunTeam>(row, RUN_TEAM_COLUMNS);
        await this.attachStages(team, scope.runId, String(row['id']));
        out.push(team);
      }
      return out;
    });
  }

  /**
   * The station-occupancy read. Backed by the partial index on
   * `run_teams (run_id, active_task_id) where active_task_id is not null`
   * (0003_indexes.sql), which is what makes a DERIVED occupancy affordable and
   * `Run.taskCounts` unnecessary.
   */
  async listTeamsAtTask(scope: RunScope, taskId: string): Promise<RunTeam[]> {
    return this.many<RunTeam>(
      `${TEAM_SELECT} where t.run_id = $1::text and t.active_task_id = $2::text order by t.id`,
      [scope.runId, taskId], RUN_TEAM_COLUMNS, 'listTeamsAtTask',
    );
  }

  async countTeamsAtTask(scope: RunScope, taskId: string): Promise<number> {
    return guard('countTeamsAtTask', async () => {
      const r = await this.q.query<{ n: number }>(
        `select count(*)::int as n from run_teams
          where run_id = $1::text and active_task_id = $2::text`,
        [scope.runId, taskId],
      );
      return Number(r.rows[0]?.n ?? 0);
    });
  }

  /** Occupancy for several tasks in ONE round trip — routing's candidate set. */
  async countTeamsAtTasks(scope: RunScope, taskIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const id of taskIds) out.set(id, 0);
    if (taskIds.length === 0) return out;
    return guard('countTeamsAtTasks', async () => {
      const r = await this.q.query<{ active_task_id: string; n: number }>(
        `select active_task_id, count(*)::int as n from run_teams
          where run_id = $1::text and active_task_id = any($2::text[])
          group by active_task_id`,
        [scope.runId, encodeArrayLiteral(taskIds, 'countTeamsAtTasks')],
      );
      for (const row of r.rows) out.set(row.active_task_id, Number(row.n));
      return out;
    });
  }

  async getStageRecord(scope: TeamScope, stageId: string): Promise<RunStageRecord | null> {
    return guard('getStageRecord', async () => {
      const teamUuid = toUuid(scope.teamId);
      const r = await this.q.query<SqlRow>(
        `select * from run_team_stages
          where run_id = $1::text and team_id = $2::uuid and stage_id = $3::text`,
        [scope.runId, teamUuid, stageId],
      );
      if (r.rows.length === 0) return null;
      const stage = rowToDomain<RunStageRecord>(r.rows[0], STAGE_COLUMNS);
      const tasks = await this.q.query<SqlRow>(
        `select * from run_task_records
          where run_id = $1::text and team_id = $2::uuid and stage_id = $3::text
          order by task_index`,
        [scope.runId, teamUuid, stageId],
      );
      stage.tasks = tasks.rows.map((row) => rowToDomain<RunTaskRecord>(row, TASK_COLUMNS));
      return stage;
    });
  }

  async patchStageRecord(
    scope: TeamScope, stageId: string, patch: StageRecordPatch,
  ): Promise<void> {
    await this.patchRow(
      'run_team_stages', patch as Record<string, unknown>, STAGE_COLUMNS,
      (i) => ({
        sql: `run_id = $${i}::text and team_id = $${i + 1}::uuid and stage_id = $${i + 2}::text`,
        params: [scope.runId, toUuid(scope.teamId), stageId],
      }),
      'patchStageRecord',
    );
  }

  async getTaskRecord(
    scope: TeamScope, stageId: string, taskId: string,
  ): Promise<RunTaskRecord | null> {
    return this.one<RunTaskRecord>(
      `select * from run_task_records
        where run_id = $1::text and team_id = $2::uuid and stage_id = $3::text and task_id = $4::text`,
      [scope.runId, toUuid(scope.teamId), stageId, taskId],
      TASK_COLUMNS, 'getTaskRecord',
    );
  }

  /**
   * The single-row UPDATE the whole `stages`-by-key design exists for.
   *
   * Under Firestore this is a read-modify-rewrite of a nested array inside the
   * repository, precisely so no call site can dotted-path an array element (a
   * shipped, unrecoverable corruption — see CLAUDE.md). Here it is what it
   * always should have been: one row, addressed by (run, team, stage, task).
   */
  async patchTaskRecord(
    scope: TeamScope, stageId: string, taskId: string, patch: TaskRecordPatch,
  ): Promise<void> {
    await this.patchRow(
      'run_task_records', patch as Record<string, unknown>, TASK_COLUMNS,
      (i) => ({
        sql: `run_id = $${i}::text and team_id = $${i + 1}::uuid ` +
          `and stage_id = $${i + 2}::text and task_id = $${i + 3}::text`,
        params: [scope.runId, toUuid(scope.teamId), stageId, taskId],
      }),
      'patchTaskRecord',
    );
  }

  async replaceTeamStages(scope: TeamScope, stages: RunStageRecord[]): Promise<void> {
    const teamUuid = toUuid(scope.teamId);
    await guard('replaceTeamStages', async () => {
      const exists = await this.q.query(
        `select 1 from run_teams where run_id = $1::text and id = $2::uuid`,
        [scope.runId, teamUuid],
      );
      if (exists.rows.length === 0) throw new DataError('not-found', 'team', { ...scope });
      await this.writeStages({ ownerUid: scope.ownerUid }, scope.runId, teamUuid, stages);
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 4. Access codes
  // ═════════════════════════════════════════════════════════════════════════

  async getAccessCode(code: string): Promise<AccessCode | null> {
    return this.one<AccessCode>(
      `${CODE_SELECT} where c.code = $1::text`, [code], ACCESS_CODE_COLUMNS, 'getAccessCode',
    );
  }

  async patchAccessCode(code: string, patch: Patch<AccessCode>): Promise<void> {
    await this.patchRow(
      'access_codes', patch as Record<string, unknown>, ACCESS_CODE_COLUMNS,
      (i) => ({ sql: `code = $${i}::text`, params: [code] }),
      'patchAccessCode',
    );
  }

  async deleteAccessCode(code: string): Promise<void> {
    await guard('deleteAccessCode', () =>
      this.q.query(`delete from access_codes where code = $1::text`, [code]));
  }

  async listAccessCodesForGame(scope: GameScope): Promise<AccessCode[]> {
    return this.many<AccessCode>(
      `${CODE_SELECT} where c.game_id = $1::text and c.owner_uid = $2::uuid order by c.code`,
      [scope.gameId, toUuid(scope.ownerUid)], ACCESS_CODE_COLUMNS, 'listAccessCodesForGame',
    );
  }

  async listAccessCodesForRun(scope: RunScope): Promise<AccessCode[]> {
    return this.many<AccessCode>(
      `${CODE_SELECT} where c.run_id = $1::text and c.owner_uid = $2::uuid order by c.code`,
      [scope.runId, toUuid(scope.ownerUid)], ACCESS_CODE_COLUMNS, 'listAccessCodesForRun',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 8. Staff invites
  // ═════════════════════════════════════════════════════════════════════════

  async putStaffInvite(scope: RunScope, invite: StaffInvite): Promise<void> {
    const plan = buildInsert(invite as unknown as Record<string, unknown>, INVITE_COLUMNS, 'putStaffInvite');
    this.append(plan, 'id', 'uuid', toUuid(invite.id));
    this.append(plan, 'run_id', 'text', scope.runId);
    this.append(plan, 'owner_uid', 'uuid', toUuid(scope.ownerUid));
    await guard('putStaffInvite', () => this.q.query(
      `insert into staff_invites (${plan.columns.join(', ')}) values (${plan.placeholders.join(', ')})
       on conflict (id) do update set ${excludedAssignments(plan)}`,
      plan.params,
    ));
  }

  async getStaffInvite(scope: RunScope, inviteId: string): Promise<StaffInvite | null> {
    return this.one<StaffInvite>(
      `${INVITE_SELECT} where i.id = $1::uuid and i.run_id = $2::text`,
      [toUuid(inviteId), scope.runId], INVITE_COLUMNS, 'getStaffInvite',
    );
  }

  async listStaffInvites(scope: RunScope): Promise<StaffInvite[]> {
    return this.many<StaffInvite>(
      `${INVITE_SELECT} where i.run_id = $1::text order by i.created_at`,
      [scope.runId], INVITE_COLUMNS, 'listStaffInvites',
    );
  }

  /**
   * Resolve a PIN to its invite.
   *
   * ALWAYS paired with `consumeStaffInvite` — a PIN is short and human-typed, so
   * this read is never trusted alone. The unused-only filter is a convenience,
   * not the gate; the gate is the `used_at is null` in the consume UPDATE.
   */
  async findStaffInviteByPin(scope: RunScope, pin: string): Promise<StaffInvite | null> {
    return this.one<StaffInvite>(
      `${INVITE_SELECT} where i.run_id = $1::text and i.pin = $2::text and i.used_at is null
        order by i.created_at limit 1`,
      [scope.runId, pin], INVITE_COLUMNS, 'findStaffInviteByPin',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // 13. Audit — append-only by contract
  // ═════════════════════════════════════════════════════════════════════════

  async appendAuditLog(entry: AuditLogEntry): Promise<void> {
    const plan = buildInsert(entry as unknown as Record<string, unknown>, AUDIT_COLUMNS, 'appendAuditLog');
    // BEST-EFFORT BY CONTRACT (README §9): an audit row must never be able to
    // fail the action it records. A duplicate id is a retry, not an error.
    await guard('appendAuditLog', () => this.q.query(
      `insert into audit_logs (${plan.columns.join(', ')}) values (${plan.placeholders.join(', ')})
       on conflict (id) do nothing`,
      plan.params,
    ));
  }

  async listAuditLogsForRun(scope: RunScope, page: PageRequest): Promise<Page<AuditLogEntry>> {
    return this.page<AuditLogEntry>(
      `select * from audit_logs`, `run_id = $1::text and owner_uid = $2::uuid`,
      [scope.runId, toUuid(scope.ownerUid)],
      'created_at', 'id::text', page, AUDIT_COLUMNS, 'listAuditLogsForRun', ['created_at', 'id'],
    );
  }

  async listAuditLogsForOwner(ownerUid: string, page: PageRequest): Promise<Page<AuditLogEntry>> {
    return this.page<AuditLogEntry>(
      `select * from audit_logs`, `owner_uid = $1::uuid`, [toUuid(ownerUid)],
      'created_at', 'id::text', page, AUDIT_COLUMNS, 'listAuditLogsForOwner', ['created_at', 'id'],
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Atomic operations
  // ═════════════════════════════════════════════════════════════════════════
  //
  // These delegate to `./atomic.ts`, which takes a queryable that is ALREADY
  // inside a transaction. On the BOUND repository (i.e. inside `withTx`) that is
  // `this.q` — so an atom called inside a transaction body JOINS it, exactly as
  // atomic.ts rule 2 requires. The unbound `PostgresRepository` overrides these
  // to open a transaction of their own.

  claimTaskSlot(
    scope: TeamScope,
    args: { stageId: string; candidates: TaskSlotCandidate[]; choose: SlotChooser; now: string },
  ): Promise<ClaimTaskSlotResult> {
    return guard('claimTaskSlot', () => sqlClaimTaskSlot(this.q, scope, args));
  }

  releaseTaskSlot(
    scope: TeamScope, args: { taskId: string; now: string },
  ): Promise<{ released: boolean }> {
    return guard('releaseTaskSlot', () => sqlReleaseTaskSlot(this.q, scope, args));
  }

  claimActiveTask(
    scope: TeamScope, args: { stageId: string; taskId: string; now: string },
  ): Promise<ClaimActiveTaskResult> {
    return guard('claimActiveTask', () => sqlClaimActiveTask(this.q, scope, args));
  }

  claimOnceFlag(
    target: { kind: 'run'; scope: RunScope } | { kind: 'team'; scope: TeamScope },
    args: { flag: string; now: string },
  ): Promise<{ claimed: boolean }> {
    return guard('claimOnceFlag', () => sqlClaimOnceFlag(this.q, target, args));
  }

  consumeStaffInvite(
    scope: RunScope, args: { inviteId: string; byUid: string; now: string },
  ): Promise<Outcome<{ invite: StaffInvite }, 'already-used' | 'not-found'>> {
    return guard('consumeStaffInvite', () =>
      sqlConsumeStaffInvite(this.q, scope, args, INVITE_SELECT_LIST));
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Not implemented — see the header for why these throw rather than return
  // ═════════════════════════════════════════════════════════════════════════

  async getPublicGame(_gameId: string): Promise<PublicGame | null> { return notImplemented('getPublicGame'); }
  async putPublicGame(_game: PublicGame): Promise<void> { return notImplemented('putPublicGame'); }
  async deletePublicGame(_gameId: string): Promise<void> { return notImplemented('deletePublicGame'); }
  async getPublicTask(_id: string): Promise<PublicTask | null> { return notImplemented('getPublicTask'); }
  async replacePublicTasksForGame(
    _gameId: string, _tasks: PublicTask[],
    _carryForward: (next: PublicTask, prior: PublicTask | null) => PublicTask,
  ): Promise<void> { return notImplemented('replacePublicTasksForGame'); }
  async deletePublicTasksForGame(_gameId: string): Promise<void> { return notImplemented('deletePublicTasksForGame'); }
  async searchPublicGames(_q: PublicSearchQuery): Promise<Page<PublicGame>> { return notImplemented('searchPublicGames'); }
  async searchPublicTasks(_q: PublicSearchQuery): Promise<Page<PublicTask>> { return notImplemented('searchPublicTasks'); }
  async getPublicLike(_k: 'game' | 'task', _i: string, _u: string): Promise<PublicLike | null> { return notImplemented('getPublicLike'); }
  async listLikedItemIds(_k: 'game' | 'task', _u: string, _ids: string[]): Promise<string[]> { return notImplemented('listLikedItemIds'); }
  async scanPublicTasks(_p: PageRequest): Promise<Page<PublicTask>> { return notImplemented('scanPublicTasks'); }
  async getTagStats(): Promise<Record<string, number>> { return notImplemented('getTagStats'); }

  async putAnnouncement(_s: RunScope, _a: Announcement): Promise<void> { return notImplemented('putAnnouncement'); }
  async patchAnnouncement(_s: RunScope, _id: string, _p: Patch<Announcement>): Promise<void> { return notImplemented('patchAnnouncement'); }
  async listAnnouncements(_s: RunScope, _p: PageRequest): Promise<Page<Announcement>> { return notImplemented('listAnnouncements'); }
  async listActiveAnnouncements(_s: RunScope): Promise<Announcement[]> { return notImplemented('listActiveAnnouncements'); }
  async putFlashMission(_s: RunScope, _m: FlashMission): Promise<void> { return notImplemented('putFlashMission'); }
  async patchFlashMission(_s: RunScope, _id: string, _p: Patch<FlashMission>): Promise<void> { return notImplemented('patchFlashMission'); }
  async listActiveFlashMissions(_s: RunScope, _now: string): Promise<FlashMission[]> { return notImplemented('listActiveFlashMissions'); }
  async putAlert(_s: RunScope, _a: AdminAlert): Promise<void> { return notImplemented('putAlert'); }
  async getAlert(_s: RunScope, _id: string): Promise<AdminAlert | null> { return notImplemented('getAlert'); }
  async patchAlert(_s: RunScope, _id: string, _p: Patch<AdminAlert>): Promise<void> { return notImplemented('patchAlert'); }
  async listAlerts(_s: RunScope, _p: PageRequest): Promise<Page<AdminAlert>> { return notImplemented('listAlerts'); }
  async countUnackedAlerts(_s: RunScope): Promise<number> { return notImplemented('countUnackedAlerts'); }
  async putTeamLocation(_s: RunScope, _l: TeamLocation): Promise<void> { return notImplemented('putTeamLocation'); }
  async listTeamLocations(_s: RunScope): Promise<TeamLocation[]> { return notImplemented('listTeamLocations'); }
  async appendLocationTrackPoint(_s: RunScope, _p: LocationTrackPoint): Promise<void> { return notImplemented('appendLocationTrackPoint'); }
  async listLocationTrack(_s: RunScope, _p: PageRequest): Promise<Page<LocationTrackPoint>> { return notImplemented('listLocationTrack'); }
  async getFeedItem(_s: RunScope, _id: string): Promise<FeedItem | null> { return notImplemented('getFeedItem'); }
  async putFeedItem(_s: RunScope, _i: FeedItem): Promise<void> { return notImplemented('putFeedItem'); }
  async patchFeedItem(
    _s: RunScope, _id: string,
    _p: Patch<Pick<FeedItem, 'active' | 'hiddenAt' | 'hiddenBy' | 'reportsCleared'>>,
  ): Promise<void> { return notImplemented('patchFeedItem'); }
  async listFeedItems(_s: RunScope, _p: PageRequest): Promise<Page<FeedItem>> { return notImplemented('listFeedItems'); }
  async getChatThread(_s: TeamScope): Promise<ChatThread | null> { return notImplemented('getChatThread'); }
  async listChatThreads(_s: RunScope): Promise<ChatThread[]> { return notImplemented('listChatThreads'); }
  async appendTrackableLog(_s: RunScope, _id: string, _e: TrackableLogEntry): Promise<void> { return notImplemented('appendTrackableLog'); }

  async getStaffAttempts(_s: RunScope, _k: string): Promise<StaffAttemptState | null> { return notImplemented('getStaffAttempts'); }
  async putStaffAttempts(_s: RunScope, _k: string, _v: StaffAttemptState): Promise<void> { return notImplemented('putStaffAttempts'); }

  async getStationSecret(_taskId: string): Promise<StationSecret | null> { return notImplemented('getStationSecret'); }
  async putStationSecret(_s: StationSecret): Promise<void> { return notImplemented('putStationSecret'); }
  async deleteStationSecret(_taskId: string): Promise<void> { return notImplemented('deleteStationSecret'); }
  async getSubmission(_id: string): Promise<StationSubmission | null> { return notImplemented('getSubmission'); }
  async putSubmission(_s: StationSubmission): Promise<void> { return notImplemented('putSubmission'); }
  async patchSubmission(_id: string, _p: Patch<StationSubmission>): Promise<void> { return notImplemented('patchSubmission'); }
  async listPendingSubmissions(_s: RunScope, _p: PageRequest): Promise<Page<StationSubmission>> { return notImplemented('listPendingSubmissions'); }
  async listSubmissionsForRun(_s: RunScope, _p: PageRequest): Promise<Page<StationSubmission>> { return notImplemented('listSubmissionsForRun'); }

  async getFeedback(_s: RunScope, _uid: string): Promise<RunFeedback | null> { return notImplemented('getFeedback'); }
  async listFeedback(_s: RunScope, _p: PageRequest): Promise<Page<RunFeedback>> { return notImplemented('listFeedback'); }

  async getTrackable(_s: RunScope, _id: string): Promise<Trackable | null> { return notImplemented('getTrackable'); }
  async putTrackable(_s: RunScope, _t: Trackable): Promise<void> { return notImplemented('putTrackable'); }
  async listTrackables(_s: RunScope): Promise<Trackable[]> { return notImplemented('listTrackables'); }
  async getZone(_s: RunScope, _id: string): Promise<Zone | null> { return notImplemented('getZone'); }
  async putZone(_s: RunScope, _z: Zone): Promise<void> { return notImplemented('putZone'); }
  async deleteZone(_s: RunScope, _id: string): Promise<void> { return notImplemented('deleteZone'); }
  async listZones(_s: RunScope): Promise<Zone[]> { return notImplemented('listZones'); }
  async getConsentToken(_s: RunScope, _t: string): Promise<ConsentToken | null> { return notImplemented('getConsentToken'); }
  async putConsentToken(_s: RunScope, _t: ConsentToken): Promise<void> { return notImplemented('putConsentToken'); }

  async getBenchmark(_type: string): Promise<BenchmarkDoc | null> { return notImplemented('getBenchmark'); }
  async getPlayerProfile(_uid: string): Promise<PlayerProfileDoc | null> { return notImplemented('getPlayerProfile'); }

  async completeTeamTask(
    _scope: TeamScope,
    _args: {
      stageId: string; taskId: string; write: TaskCompletionWrite; foldTaskIds?: string[];
      stagePatch?: StageRecordPatch; teamPatch?: Patch<Omit<RunTeam, 'stages' | 'score'>>;
      scoreDelta: number; requireRunLive: boolean; now: string;
    },
  ): Promise<CompleteTeamTaskResult> { return notImplemented('completeTeamTask'); }
  async skipTeamTask(
    _scope: TeamScope,
    _args: {
      stageId: string; taskId: string; requiredTaskCount?: number; foldTaskIds?: string[];
      stagePatch?: StageRecordPatch; now: string;
    },
  ): Promise<Outcome<{ releasedTaskIds: string[]; stageCompleted: boolean; teamFinished: boolean }, 'not-skippable'>> {
    return notImplemented('skipTeamTask');
  }
  async joinRunWithCapacity(
    _scope: RunScope,
    _args: { team: RunTeam; participantCap: number; deviceCap: number; now: string },
  ): Promise<Outcome<{ teamId: string; alreadyJoined: boolean; participantCount: number }, 'run-full' | 'device-limit' | 'run-finished'>> {
    return notImplemented('joinRunWithCapacity');
  }
  async attachDevice(
    _scope: TeamScope,
    _args: { uid: string; displayName: string; teamDeviceCap: number; runDeviceCap: number; now: string },
  ): Promise<Outcome<{ alreadyAttached: boolean; controllerUid: string; deviceCount: number }, 'team-full' | 'run-device-limit' | 'run-finished'>> {
    return notImplemented('attachDevice');
  }
  async setController(
    _scope: TeamScope,
    _args: { mode: 'transfer' | 'claim'; byUid: string; toUid: string; now: string },
  ): Promise<Outcome<{ controllerUid: string }, 'not-controller' | 'not-attached'>> {
    return notImplemented('setController');
  }
  async launchRunBilled(
    _args: {
      run: Run; accessCode: AccessCode;
      debit?: { uid: string; kind: 'free_run' | 'credit'; ledger: WalletTransaction };
      now: string;
    },
  ): Promise<Outcome<{ runId: string; accessCode: string }, 'insufficient-credits' | 'code-taken' | 'test-run-already-live'>> {
    return notImplemented('launchRunBilled');
  }
  async consumeConsentToken(
    _scope: RunScope, _args: { token: string; guardianName: string | null; now: string },
  ): Promise<Outcome<{ teamId: string }, 'already-used' | 'not-found' | 'expired'>> {
    return notImplemented('consumeConsentToken');
  }
  async chargeHint(
    _scope: TeamScope, _args: { taskId: string; penalty: number; now: string },
  ): Promise<{ alreadyCharged: boolean; charged: number }> { return notImplemented('chargeHint'); }
  async chargeWrongAnswer(
    _scope: TeamScope,
    _args: {
      taskId: string; submissionHash: string;
      computeCost: (prior: { attempts: number; charged: number }) => { points: number; lockoutMs: number };
      now: string; nowMs: number;
    },
  ): Promise<{ replay: boolean; charged: number; attempts: number; lockoutMs: number; lastFailureAt: number }> {
    return notImplemented('chargeWrongAnswer');
  }
  async adjustTeamPenalty(
    _scope: TeamScope, _args: { delta: number; clamp: (next: number) => number; now: string },
  ): Promise<{ previousBonusPenalty: number; bonusPenalty: number }> {
    return notImplemented('adjustTeamPenalty');
  }
  async setTaskStatusOverride(
    _scope: RunScope,
    _args: { taskId: string; status: StationStatus; expectedFrom?: StationStatus; now: string },
  ): Promise<Outcome<{ from: StationStatus; to: StationStatus }, 'conflict'>> {
    return notImplemented('setTaskStatusOverride');
  }
  async refreshLeaderboardIfNotFrozen(
    _scope: RunScope,
    _args: { rankings: import('../types').LeaderboardEntry[]; minIntervalMs: number; now: string; nowMs: number },
  ): Promise<{ written: boolean; skipped?: 'frozen' | 'throttled' }> {
    return notImplemented('refreshLeaderboardIfNotFrozen');
  }
  async appendChatMessage(
    _scope: TeamScope,
    _args: { message: ChatMessage; threadSeed: Omit<ChatThread, 'messages' | 'updatedAt'>; maxMessages: number; now: string },
  ): Promise<{ messageCount: number; trimmed: number }> { return notImplemented('appendChatMessage'); }
  async applyFeedReaction(
    _scope: RunScope, _args: { itemId: string; uid: string; emoji: string | null; now: string },
  ): Promise<Outcome<{ reactions: Record<string, number> }, 'not-found' | 'hidden'>> {
    return notImplemented('applyFeedReaction');
  }
  async applyFeedReport(
    _scope: RunScope,
    _args: { itemId: string; reporterKey: string; reason: string; autoHideAtCount: number; now: string },
  ): Promise<Outcome<{ reportCount: number; hidden: boolean }, 'not-found'>> {
    return notImplemented('applyFeedReport');
  }
  async captureZone(
    _scope: TeamScope, _args: { zoneId: string; withinZone: (zone: Zone) => boolean; now: string },
  ): Promise<Outcome<{ zone: Zone; bonusAwarded: number }, 'not-found' | 'already-held' | 'out-of-range'>> {
    return notImplemented('captureZone');
  }
  async transferTrackable(
    _scope: RunScope,
    _args: { trackableId: string; action: 'pickup' | 'drop'; teamId: string; teamName?: string; taskId?: string | null; now: string },
  ): Promise<Outcome<{ trackable: Trackable }, 'not-found' | 'held-by-other' | 'not-carrying'>> {
    return notImplemented('transferTrackable');
  }
  async setStationSecret(_args: { taskId: string; code: string | null; now: string }): Promise<void> {
    return notImplemented('setStationSecret');
  }
  async submitFeedbackOnce(
    _scope: RunScope, _args: { feedback: RunFeedback },
  ): Promise<{ stored: boolean; already: boolean }> { return notImplemented('submitFeedbackOnce'); }
  async togglePublicLike(
    _args: {
      kind: 'game' | 'task'; itemId: string; uid: string; liked: boolean;
      recompute: (s: { likeCount: number; uses: number; createdAt: string }) => number; now: string;
    },
  ): Promise<Outcome<{ likeCount: number; popularity: number; changed: boolean }, 'not-found'>> {
    return notImplemented('togglePublicLike');
  }
  async bumpPublicSignals(
    _args: {
      kind: 'game' | 'task'; itemId: string; uses?: number;
      recompute: (s: { likeCount: number; uses: number; createdAt: string }) => number; now: string;
    },
  ): Promise<Outcome<{ uses: number; popularity: number }, 'not-found'>> {
    return notImplemented('bumpPublicSignals');
  }
  async bumpTagStats(_args: { added: string[]; removed: string[]; now: string }): Promise<void> {
    return notImplemented('bumpTagStats');
  }
  async mergeBenchmark<S>(
    _args: { type: string; sample: S; merge: (prev: BenchmarkDoc | null, sample: S) => BenchmarkDoc; now: string },
  ): Promise<void> { return notImplemented('mergeBenchmark'); }
  async recordPlayerResult<R>(
    _args: { uid: string; teamScope: TeamScope; result: R; merge: (prev: PlayerProfileDoc | null, r: R) => PlayerProfileDoc; now: string },
  ): Promise<{ recorded: boolean }> { return notImplemented('recordPlayerResult'); }
  async creditWallet(
    _args: {
      uid: string; idempotencyKey: string; credits?: number; bonusFreeRuns?: number;
      walletPatch?: Patch<Omit<Wallet, 'eventCredits' | 'bonusFreeRuns'>>;
      ledger: WalletTransaction; now: string;
    },
  ): Promise<{ duplicate: boolean; eventCredits: number }> { return notImplemented('creditWallet'); }
  async claimReferral(
    _args: {
      inviteeUid: string; inviterUid: string; bonusFreeRuns: number; maxPerReferrer: number;
      inviteeLedger: WalletTransaction; inviterLedger: WalletTransaction; now: string;
    },
  ): Promise<Outcome<{ inviterReferralCount: number }, 'already-claimed' | 'self-referral' | 'referrer-cap-reached' | 'inviter-not-found'>> {
    return notImplemented('claimReferral');
  }
  async rateLimitStep(
    _args: {
      bucket: string; uid: string; budget: RateBudget;
      step: (state: WindowState | null, budget: RateBudget, nowMs: number) => { allowed: boolean; nextState: WindowState; retryAfterMs: number };
      nowMs: number;
    },
  ): Promise<{ allowed: boolean; retryAfterMs: number }> { return notImplemented('rateLimitStep'); }
}

/** DiscoveryPoi is a loose grab-bag; its column set is bespoke, so is its reader. */
function poiFromRow(row: SqlRow, scope: GameScope): DiscoveryPoi {
  const at = row['created_at'];
  const answers = Array.isArray(row['answers']) ? (row['answers'] as unknown[]).map(String) : [];
  const poi: DiscoveryPoi = {
    id: String(row['id']),
    gameId: scope.gameId,
    lat: Number(row['lat']),
    lng: Number(row['lng']),
    radiusMeters: Number(row['radius_meters']),
    title: row['title'] === null ? undefined : String(row['title']),
    question: row['question'] === null ? undefined : String(row['question']),
    points: Number(row['bonus_points'] ?? 0),
    createdAt: at instanceof Date ? at.toISOString() : String(at),
  };
  if (answers.length > 0) poi.answer = answers[0];
  (poi as { answers?: string[] }).answers = answers;
  if (row['flavor_text'] !== null) (poi as { flavorText?: string }).flavorText = String(row['flavor_text']);
  if (row['hint'] !== null) (poi as { hint?: string }).hint = String(row['hint']);
  return poi;
}

// Compile-time proof that the bound surface really is the full transactional
// interface — including every atomic operation. If a method is added to
// `AtomicOperations` and not to this class, THIS line fails, not a call site.
const _boundSatisfiesTransactional: new (q: SqlQueryable) =>
  TransactionalRepository & AtomicOperations & AuditRepository & AggregateRepository &
  FeedbackRepository & LiveOpsRepository & RunObjectRepository & StationRepository =
  BoundPostgresRepository;
void _boundSatisfiesTransactional;


// ═══════════════════════════════════════════════════════════════════════════
// The repository
// ═══════════════════════════════════════════════════════════════════════════

export class PostgresRepository extends BoundPostgresRepository implements Repository {
  private readonly runner: <T>(body: TxBody<T>, options?: TransactionOptions) => Promise<T>;

  constructor(private readonly client: SqlClient) {
    super(client);
    this.runner = makeRunInTransaction(client);
  }

  /** See ../transaction.ts. SQL runs the body ONCE per attempt — a legal
   *  special case of the published "MAY execute more than once". */
  runInTransaction = <T>(body: TxBody<T>, options?: TransactionOptions): Promise<T> =>
    this.runner(body, options);

  /**
   * Bind the whole read/write surface to a transaction.
   *
   * The returned object is the SAME class as `this`, differing only in its
   * queryable — which is what makes "the signature is identical inside and
   * outside a transaction" true by construction rather than by discipline.
   */
  withTx(tx: Tx): TransactionalRepository {
    return new BoundPostgresRepository(unwrapTx(tx));
  }


  // ── Atomic operations, called OUTSIDE a transaction ──────────────────────
  //
  // Each opens its own. `maxAttempts` is 8 on the contested paths, matching the
  // `withLockRetry` tuning the Firestore implementation inherited — that number
  // was arrived at empirically under load on exactly this path and the
  // migration must not re-tune it.

  claimTaskSlot(
    scope: TeamScope,
    args: { stageId: string; candidates: TaskSlotCandidate[]; choose: SlotChooser; now: string },
  ): Promise<ClaimTaskSlotResult> {
    return this.runner(
      (tx) => sqlClaimTaskSlot(unwrapTx(tx), scope, args),
      { label: 'claimTaskSlot', maxAttempts: 8 },
    );
  }

  releaseTaskSlot(
    scope: TeamScope, args: { taskId: string; now: string },
  ): Promise<{ released: boolean }> {
    return this.runner(
      (tx) => sqlReleaseTaskSlot(unwrapTx(tx), scope, args), { label: 'releaseTaskSlot' },
    );
  }

  claimActiveTask(
    scope: TeamScope, args: { stageId: string; taskId: string; now: string },
  ): Promise<ClaimActiveTaskResult> {
    return this.runner(
      (tx) => sqlClaimActiveTask(unwrapTx(tx), scope, args), { label: 'claimActiveTask' },
    );
  }

  claimOnceFlag(
    target: { kind: 'run'; scope: RunScope } | { kind: 'team'; scope: TeamScope },
    args: { flag: string; now: string },
  ): Promise<{ claimed: boolean }> {
    return this.runner(
      (tx) => sqlClaimOnceFlag(unwrapTx(tx), target, args),
      { label: 'claimOnceFlag', maxAttempts: 8 },
    );
  }

  consumeStaffInvite(
    scope: RunScope, args: { inviteId: string; byUid: string; now: string },
  ): Promise<Outcome<{ invite: StaffInvite }, 'already-used' | 'not-found'>> {
    return this.runner(
      (tx) => sqlConsumeStaffInvite(unwrapTx(tx), scope, args, INVITE_SELECT_LIST),
      { label: 'consumeStaffInvite', maxAttempts: 8 },
    );
  }


  // ── 14. Sweeps — bounded, resumable, NOT atomic ──────────────────────────
  //
  // Stubbed. When implemented they MUST honour `budget.maxDocs` as a hard
  // ceiling and return a `nextCursor` whenever they stopped early. Note the
  // Postgres shape is materially better than the Firestore one and should not be
  // ported line-for-line: `sweepRunPii`'s biggest table (`location_track`) is
  // RANGE PARTITIONED BY MONTH, so the 90-day prune is
  // `drop_location_track_partitions_older_than(90)` — constant time, no bloat,
  // nothing to reconcile if interrupted — rather than a chunked delete loop
  // bounded by a 500-op batch cap.

  async sweepRunPii(_s: RunScope, _b: SweepBudget): Promise<SweepResult> { return notImplemented('sweepRunPii'); }
  async sweepRunSubtree(_s: RunScope, _b: SweepBudget): Promise<SweepResult> { return notImplemented('sweepRunSubtree'); }
  async sweepGameSubtree(_s: GameScope, _b: SweepBudget): Promise<SweepResult> { return notImplemented('sweepGameSubtree'); }
  async sweepUserSubtree(_uid: string, _b: SweepBudget): Promise<SweepResult> { return notImplemented('sweepUserSubtree'); }
  async sweepPublicTaskProjection(
    _b: SweepBudget, _repair: (task: PublicTask) => Patch<PublicTask> | null,
  ): Promise<SweepResult> { return notImplemented('sweepPublicTaskProjection'); }
}

/** Convenience factory. `createPostgresRepository(client)`. */
export function createPostgresRepository(client: SqlClient): Repository {
  return new PostgresRepository(client);
}

// `toUuidOrNull` and `msToInstant` are part of the mapping vocabulary this file
// establishes for the aggregates it has NOT yet implemented (alerts, feed items,
// chat, zones — all of which carry optional identity columns and epoch-ms
// fields). Referenced here so the module's exports stay honest about what the
// next implementer should reach for.
void toUuidOrNull;
void msToInstant;

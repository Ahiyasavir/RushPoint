// ─── Live ops — announcements · flash missions · alerts · feed · chat · staff ─
//
// Phase 1, behaviour-neutral. Every method here mirrors what `functions/src`
// does TODAY (`functions/src/index.ts` for the broadcast/alert/feed/chat/staff
// surface, `functions/src/runs/index.ts` for trackables · zones · feedback ·
// consent tokens). Where today's code is surprising, this file REPRODUCES the
// surprise and comments it. Fixes belong in separate, reviewed changes —
// otherwise "did the migration break it?" stops being answerable.
//
// This file owns the aggregates listed above and NOTHING else. It never imports
// `firebase-admin` (see context.ts) and takes the driver injected, exactly as
// `repository.ts` does.
//
//
// ── THE ONE THING TO KNOW: the list reads are BOUNDED ────────────────────────
//
// `announcements` and `flashMissions` are on EVERY participant's phone via an
// `onSnapshot`, and both were bounded on purpose:
//
//   where(active|isActive, '==', true) · orderBy('createdAt','desc') · limit(N)
//
// (`apps/play-web/src/components/LiveOps.tsx`, backed by the composite indexes
// in `firestore.indexes.json`). The `orderBy` is LOAD-BEARING, not cosmetic:
// these documents carry Firestore auto-ids, so a bare `limit()` orders by
// `__name__` and returns an ARBITRARY subset — it can silently drop the banner
// pushed one second ago. Every list method below therefore carries an explicit
// order and a bound; none of them may become an unbounded `.get()`.

import {
  DataError,
  type AdminAlert,
  type Announcement,
  type Cursor,
  type FeedItem,
  type FlashMission,
  type Page,
  type PageRequest,
  type Patch,
  type RunFeedback,
  type RunScope,
  type SortDir,
  type StaffInvite,
  type TeamLocation,
  type TeamScope,
} from '../types';
import type {
  ChatThread,
  ConsentToken,
  FeedbackRepository,
  LiveOpsRepository,
  LocationTrackPoint,
  RunObjectRepository,
  StaffAttemptState,
  StaffRepository,
  Trackable,
  TrackableLogEntry,
  Zone,
} from '../repository';

import { COLLECTIONS } from '@rushpoint/shared';

import {
  guard,
  type FirestoreContext,
  type FsDocumentData,
  type FsDocumentReference,
  type FsDocumentSnapshot,
  type FsQuery,
  type FsQueryDocumentSnapshot,
  type FsQuerySnapshot,
} from './context';
import { assertId, colPaths, docPaths } from './paths';
import { toDocumentData, toUpdateData } from './patch';


// ═══════════════════════════════════════════════════════════════════════════
// The I/O seam (structurally identical to repository.ts's private `Io`)
// ═══════════════════════════════════════════════════════════════════════════
//
// `repository.ts` declares this interface privately and exports neither it nor
// the protected helpers built on it. It is RESTATED here rather than imported
// because `repository.ts` imports this module, so importing it back would make
// a module cycle — and a cycle around a class definition is exactly the kind of
// "works in dev, undefined at runtime after bundling" failure this repo has
// already shipped once (see MEMORY: stale shared bundle → INTERNAL).
//
// Structural typing makes the two interchangeable: `new FirestoreLiveOpsStore(
// ctx, this.io)` type-checks inside `repository.ts` with no cast. If the parent
// promotes `Io` and the helper block to a shared module, delete both from here.

export interface FsIo {
  readonly inTransaction: boolean;
  getDoc(ref: FsDocumentReference): Promise<FsDocumentSnapshot>;
  getQuery(query: FsQuery): Promise<FsQuerySnapshot>;
  set(ref: FsDocumentReference, data: FsDocumentData, options?: { merge?: boolean }): Promise<void>;
  update(ref: FsDocumentReference, data: FsDocumentData): Promise<void>;
  del(ref: FsDocumentReference): Promise<void>;
}


// ═══════════════════════════════════════════════════════════════════════════
// Path segments that have NO owner in shared today
// ═══════════════════════════════════════════════════════════════════════════
//
// `FIRESTORE_PATHS` / `COLLECTIONS` (@rushpoint/shared) name most of the layout,
// and `paths.ts` derives every collection from a document path so the layout has
// exactly ONE owner. These segments are simply not in shared at all — they are
// written as string literals in `functions/src` and nowhere else. They are
// mirrored here VERBATIM, in one block, so the debt is visible and a future
// rename has a single place to fix rather than a scatter of inline literals.
//
// ⚠ TODO for whoever extends shared: move these into `FIRESTORE_PATHS` and make
// `paths.ts` derive them, then delete this block.

const SEGMENTS = {
  /** `…/runs/{runId}/flashMissions` — shared DOES own this one. */
  flashMissions: COLLECTIONS.FLASH_MISSIONS,
  /** `…/runs/{runId}/locationTrack` (functions/src/index.ts, updateLocation). */
  locationTrack: 'locationTrack',
  /** `…/runs/{runId}/trackables` (functions/src/runs/index.ts, createTrackable). */
  trackables: 'trackables',
  /** `…/trackables/{id}/log` — the append-only travel log. */
  trackableLog: 'log',
  /** `…/runs/{runId}/zones` (functions/src/runs/index.ts, createZone). */
  zones: 'zones',
  /** `…/runs/{runId}/consentTokens` (functions/src/runs/index.ts, guardian consent). */
  consentTokens: 'consentTokens',
  /** `…/runs/{runId}/staffAttempts` — the two-tier PIN lockout counters. */
  staffAttempts: 'staffAttempts',
} as const;


// ═══════════════════════════════════════════════════════════════════════════
// The bounded live-ops windows
// ═══════════════════════════════════════════════════════════════════════════
//
// Mirrors `ANNOUNCEMENT_WINDOW` / `FLASH_WINDOW` in
// `apps/play-web/src/components/LiveOps.tsx`. They are duplicated rather than
// imported because `@rushpoint/data` may not depend on an app. If the client
// window grows, these must grow with it — a SMALLER value here would hide a
// document the client would still be rendering.

/** Newest-first announcement window (client: 30). */
export const ANNOUNCEMENT_WINDOW = 30;
/** Newest-first flash-mission window (client: 20). */
export const FLASH_MISSION_WINDOW = 20;


// ═══════════════════════════════════════════════════════════════════════════
// Helpers — MECHANICALLY DUPLICATED from repository.ts, deliberately
// ═══════════════════════════════════════════════════════════════════════════
//
// Same reason as `FsIo` above: `repository.ts` keeps them `protected` and
// imports this module. They are byte-for-byte the same decisions, including the
// cursor encoding (plain JSON — `btoa` needs `lib.dom` and `Buffer` needs
// `@types/node`, and this package's real build config has neither).

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

interface OrderSpec {
  field: string;
  dir: SortDir;
}


// ═══════════════════════════════════════════════════════════════════════════
// The store
// ═══════════════════════════════════════════════════════════════════════════

export class FirestoreLiveOpsStore
implements LiveOpsRepository, StaffRepository, FeedbackRepository, RunObjectRepository {
  constructor(
    protected readonly ctx: FirestoreContext,
    protected readonly io: FsIo,
  ) {}

  // ── low-level helpers (see the block comment above) ──────────────────────

  protected doc(path: string): FsDocumentReference {
    return this.ctx.db.doc(path);
  }

  protected async readDoc<T>(path: string, what: string): Promise<T | null> {
    return guard(what, async () => {
      const snap = await this.io.getDoc(this.doc(path));
      if (!snap.exists) return null;
      const data = snap.data();
      return (data === undefined ? null : (data as unknown as T));
    });
  }

  /** Whole-document create-or-replace. `put*` semantics. */
  protected async writeDoc(path: string, value: object, what: string): Promise<void> {
    const data = toDocumentData(value as Record<string, unknown>, what);
    await guard(what, () => this.io.set(this.doc(path), data));
  }

  /** Three-valued patch → `.update()`. An empty patch skips the round trip. */
  protected async patchDoc(
    path: string,
    patch: Record<string, unknown> | undefined,
    what: string,
  ): Promise<void> {
    const data = toUpdateData(patch, this.ctx.deleteSentinel, what);
    if (data === null) return;
    await guard(what, () => this.io.update(this.doc(path), data));
  }

  protected async deleteDoc(path: string, what: string): Promise<void> {
    await guard(what, () => this.io.del(this.doc(path)));
  }

  /** Keyset-paged query. Order fields must be STORED fields. */
  protected async pageQuery<T>(
    base: FsQuery,
    order: OrderSpec[],
    req: PageRequest,
    what: string,
  ): Promise<Page<T>> {
    return guard(what, async () => {
      const limit = Math.max(1, Math.floor(req.limit));
      let q = base;
      for (const o of order) q = q.orderBy(o.field, o.dir);
      const after = decodeCursor(req.cursor, what);
      if (after) q = q.startAfter(...after);
      const snap = await this.io.getQuery(q.limit(limit));

      const raw = snap.docs;
      const page: Page<T> = { items: raw.map((d) => d.data() as unknown as T) };
      if (raw.length === limit) {
        const last = raw[raw.length - 1] as FsQueryDocumentSnapshot;
        const data = last.data();
        page.nextCursor = encodeCursor(order.map((o) => data[o.field] ?? null));
      }
      return page;
    });
  }

  protected async listAll<T>(base: FsQuery, what: string): Promise<T[]> {
    return guard(what, async () => {
      const snap = await this.io.getQuery(base);
      return snap.docs.map((d) => d.data() as unknown as T);
    });
  }

  /** `…/runs/{runId}/<segment>` — derived from the owned run document path. */
  protected runSub(scope: RunScope, segment: string): string {
    return `${docPaths.run(scope)}/${segment}`;
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Announcements
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * `pushAnnouncement` (and `adjustTeamScore`, which writes the `kind:'score'`
   * notice into the SAME collection) mint the id with `.doc()` and copy it into
   * the document. Here the id is caller-supplied (package rule 1/2), so it must
   * already be on the object.
   */
  async putAnnouncement(scope: RunScope, a: Announcement): Promise<void> {
    if (!a?.id) {
      throw new DataError(
        'failed-precondition',
        'putAnnouncement: Announcement.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(docPaths.runAnnouncement(scope, a.id), a, 'putAnnouncement');
  }

  /**
   * The deactivate path (`deactivateAnnouncement`, and the stale-notice sweep
   * below) — `{ active: false, deactivatedAt }`. `.update()`, so deactivating a
   * document that no longer exists is a loud `not-found`, exactly as today.
   */
  async patchAnnouncement(scope: RunScope, id: string, patch: Patch<Announcement>): Promise<void> {
    await this.patchDoc(
      docPaths.runAnnouncement(scope, id),
      patch as Record<string, unknown>,
      'patchAnnouncement',
    );
  }

  /**
   * Newest first. The operator-facing history read: it does NOT filter on
   * `active`, because a console reviewing what was broadcast must see the
   * retired banners too.
   */
  async listAnnouncements(scope: RunScope, page: PageRequest): Promise<Page<Announcement>> {
    return this.pageQuery<Announcement>(
      this.ctx.db.collection(colPaths.announcements(scope)),
      [{ field: 'createdAt', dir: 'desc' }],
      page,
      'listAnnouncements',
    );
  }

  /**
   * THE participant-facing window: `active == true`, newest first, capped at
   * `ANNOUNCEMENT_WINDOW`. Identical in shape to the play-web listener and
   * served by the same `(active, createdAt desc)` composite index.
   *
   * The cap is not a paging convenience, it is the contract — see the header.
   * Per-team targeting (`Announcement.teamId`) is deliberately NOT filtered
   * here: it is a CLIENT COURTESY (`announcementVisibleTo`), never server
   * enforcement, because Firestore rules cannot filter documents within a
   * collection read. Filtering it here would make the repository stricter than
   * the rule that actually protects the data, which reads as a guarantee this
   * layer cannot keep.
   */
  async listActiveAnnouncements(scope: RunScope): Promise<Announcement[]> {
    return this.listAll<Announcement>(
      this.ctx.db
        .collection(colPaths.announcements(scope))
        .where('active', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(ANNOUNCEMENT_WINDOW),
      'listActiveAnnouncements',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Flash missions
  // ═════════════════════════════════════════════════════════════════════════

  async putFlashMission(scope: RunScope, m: FlashMission): Promise<void> {
    if (!m?.id) {
      throw new DataError(
        'failed-precondition',
        'putFlashMission: FlashMission.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(
      `${this.runSub(scope, SEGMENTS.flashMissions)}/${assertId(m.id, 'flashMissionId')}`,
      m,
      'putFlashMission',
    );
  }

  async patchFlashMission(scope: RunScope, id: string, patch: Patch<FlashMission>): Promise<void> {
    await this.patchDoc(
      `${this.runSub(scope, SEGMENTS.flashMissions)}/${assertId(id, 'flashMissionId')}`,
      patch as Record<string, unknown>,
      'patchFlashMission',
    );
  }

  /**
   * `isActive == true`, newest first, capped at `FLASH_MISSION_WINDOW` — then
   * expiry is applied IN MEMORY against `now`, never by the query.
   *
   * That split is today's behaviour and is deliberate: there is no
   * `(isActive, expiresAt)` index, and the client decides expiry in its render
   * filter for the same reason. `now` is a parameter because this package never
   * reads a clock of its own (types.ts rule 3).
   *
   * FAIL-OPEN, matching `sweepStaleLiveOps`: a missing or unparseable
   * `expiresAt` is NOT proof of expiry, so such a mission stays in the result.
   * String comparison is chronological here because every writer stamps
   * `new Date().toISOString()` — fixed width, always UTC.
   */
  async listActiveFlashMissions(scope: RunScope, now: string): Promise<FlashMission[]> {
    const active = await this.listAll<FlashMission>(
      this.ctx.db
        .collection(this.runSub(scope, SEGMENTS.flashMissions))
        .where('isActive', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(FLASH_MISSION_WINDOW),
      'listActiveFlashMissions',
    );
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) return active; // unusable clock ⇒ hide nothing
    return active.filter((m) => {
      if (typeof m.expiresAt !== 'string') return true;
      const expiresMs = Date.parse(m.expiresAt);
      if (!Number.isFinite(expiresMs)) return true;
      return expiresMs > nowMs;
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Alerts (SOS + safe-zone breach)
  // ═════════════════════════════════════════════════════════════════════════
  //
  // ⚠ TWO DIVERGENCES THE PARENT MUST RULE ON — both inherited, neither
  // introduced here:
  //
  //  1. COLLECTION NAME. `paths.ts` addresses `…/runs/{runId}/adminAlerts` (it
  //     derives from `FIRESTORE_PATHS.runAlert`, which says `adminAlerts`).
  //     `functions/src/index.ts` — triggerSOS, the breach alert, and
  //     acknowledgeAlert — and BOTH clients (`RunConsolePage.tsx`,
  //     `StaffConsole.tsx`) hardcode `…/alerts`. So production stores alerts in
  //     `alerts` and `FIRESTORE_PATHS.runAlert` points at a collection nothing
  //     writes. This file follows `paths.ts` (single owner of the layout; the
  //     repo rule forbids hardcoding the literal here), which means these
  //     methods address `adminAlerts` and would NOT see today's documents. The
  //     fix belongs in shared/`paths.ts`, not here — flagging rather than
  //     silently hardcoding `alerts`.
  //
  //  2. TIMESTAMP FIELD. `AdminAlert` declares `timestamp`, but every stored
  //     document carries `createdAt` (and flat `lat`/`lng` rather than
  //     `location`). The ordering below uses the STORED field, `createdAt`,
  //     because ordering on a field no document has returns nothing.

  async putAlert(scope: RunScope, a: AdminAlert): Promise<void> {
    if (!a?.id) {
      throw new DataError(
        'failed-precondition',
        'putAlert: AdminAlert.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(docPaths.runAlert(scope, a.id), a, 'putAlert');
  }

  async getAlert(scope: RunScope, id: string): Promise<AdminAlert | null> {
    return this.readDoc<AdminAlert>(docPaths.runAlert(scope, id), 'getAlert');
  }

  /** `acknowledgeAlert` — `{ acknowledged, acknowledgedBy, acknowledgedAt }`. */
  async patchAlert(scope: RunScope, id: string, patch: Patch<AdminAlert>): Promise<void> {
    await this.patchDoc(
      docPaths.runAlert(scope, id),
      patch as Record<string, unknown>,
      'patchAlert',
    );
  }

  /** Newest first — see divergence 2 above on why the order field is `createdAt`. */
  async listAlerts(scope: RunScope, page: PageRequest): Promise<Page<AdminAlert>> {
    return this.pageQuery<AdminAlert>(
      this.ctx.db.collection(colPaths.alerts(scope)),
      [{ field: 'createdAt', dir: 'desc' }],
      page,
      'listAlerts',
    );
  }

  /**
   * The GM overview's per-run badge. A single equality, so no composite index
   * is needed. `count()` is an aggregation query: it does not materialise the
   * documents, which is the whole point of having it separate from `listAlerts`.
   */
  async countUnackedAlerts(scope: RunScope): Promise<number> {
    return guard('countUnackedAlerts', async () => {
      const snap = await this.ctx.db
        .collection(colPaths.alerts(scope))
        .where('acknowledged', '==', false)
        .count()
        .get();
      return snap.data().count;
    });
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Team locations (last-known ping) + the append-only track
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * ONE document per team, OVERWRITTEN on every ping — this is the live map pin,
   * not a history. `updateLocation` writes it with `.set({merge:true})`; here it
   * is a whole-document `.set()`, which is the same result for a caller handing
   * over a complete `TeamLocation` and avoids the merge semantics the package
   * deliberately does not expose (README: `patch` means "modify a document that
   * exists"; a ping must create it on the first fix).
   */
  async putTeamLocation(scope: RunScope, loc: TeamLocation): Promise<void> {
    await this.writeDoc(
      docPaths.teamLocation(scope, loc.teamId),
      loc,
      'putTeamLocation',
    );
  }

  /**
   * Unpaged, and bounded by construction: one document per team, so the ceiling
   * is `Run.maxParticipants`. Matches today's live-map read.
   */
  async listTeamLocations(scope: RunScope): Promise<TeamLocation[]> {
    return this.listAll<TeamLocation>(
      this.ctx.db.collection(colPaths.teamLocations(scope)),
      'listTeamLocations',
    );
  }

  /**
   * The movement-heatmap breadcrumb (PII; dies with the run's 90-day prune).
   *
   * PRESERVED-BEHAVIOUR NOTE: `updateLocation` appends with `.add()`, i.e. a
   * server-minted id, and the stored document has no id field at all. This
   * package may not mint ids (rule 1) and the driver's `doc()` deliberately has
   * no no-arg overload, so the id is required from the caller. That is the one
   * place a caller must do slightly more work than today.
   */
  async appendLocationTrackPoint(scope: RunScope, p: LocationTrackPoint): Promise<void> {
    if (!p?.id) {
      throw new DataError(
        'failed-precondition',
        'appendLocationTrackPoint: LocationTrackPoint.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(
      `${this.runSub(scope, SEGMENTS.locationTrack)}/${assertId(p.id, 'locationTrackId')}`,
      p,
      'appendLocationTrackPoint',
    );
  }

  /**
   * CHRONOLOGICAL (oldest first) — a movement track read backwards is not a
   * track. Today's heatmap reads the whole collection unordered and sorts (or
   * doesn't) in memory; a keyset cursor needs a deterministic order, so `at`
   * ascending is named here.
   */
  async listLocationTrack(scope: RunScope, page: PageRequest): Promise<Page<LocationTrackPoint>> {
    return this.pageQuery<LocationTrackPoint>(
      this.ctx.db.collection(this.runSub(scope, SEGMENTS.locationTrack)),
      [{ field: 'at', dir: 'asc' }],
      page,
      'listLocationTrack',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Live photo feed
  // ═════════════════════════════════════════════════════════════════════════

  async getFeedItem(scope: RunScope, id: string): Promise<FeedItem | null> {
    return this.readDoc<FeedItem>(docPaths.feedItem(scope, id), 'getFeedItem');
  }

  /** `writeFeedItem` — a plain `.set()` on a brand-new document, no transaction. */
  async putFeedItem(scope: RunScope, item: FeedItem): Promise<void> {
    if (!item?.id) {
      throw new DataError(
        'failed-precondition',
        'putFeedItem: FeedItem.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(docPaths.feedItem(scope, item.id), item, 'putFeedItem');
  }

  /**
   * Moderator hide/restore ONLY (`hideFeedItem`). The type already forbids it,
   * but to say it out loud: `reactions`/`reactedBy`/`reportedBy`/`reportCount`
   * are NOT patchable here — a tally and its source of truth must move together,
   * which is why they belong to `applyFeedReaction`/`applyFeedReport` in
   * atomic.ts.
   *
   * The restore path clears `hiddenAt`/`hiddenBy` with the DELETE token (today:
   * `FieldValue.delete()`); `null` would leave the fields stored, which is a
   * different document.
   */
  async patchFeedItem(
    scope: RunScope,
    id: string,
    patch: Patch<Pick<FeedItem, 'active' | 'hiddenAt' | 'hiddenBy' | 'reportsCleared'>>,
  ): Promise<void> {
    await this.patchDoc(
      docPaths.feedItem(scope, id),
      patch as Record<string, unknown>,
      'patchFeedItem',
    );
  }

  /**
   * Newest first, paged. NOT filtered on `active`: this is the moderator/console
   * read, which must see hidden items in order to restore them. The bounded
   * participant window (`active == true` + a `limit`) is the play-web listener,
   * and the `(active, createdAt desc)` composite index that serves it already
   * exists.
   */
  async listFeedItems(scope: RunScope, page: PageRequest): Promise<Page<FeedItem>> {
    return this.pageQuery<FeedItem>(
      this.ctx.db.collection(colPaths.feedItems(scope)),
      [{ field: 'createdAt', dir: 'desc' }],
      page,
      'listFeedItems',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Team ↔ HQ chat
  // ═════════════════════════════════════════════════════════════════════════
  //
  // ONE document per team holding the whole message array (`sendTeamChatMessage`
  // sets it whole — never a dotted array update, which would coerce the array to
  // a map). The append itself is `appendChatMessage` in atomic.ts, because a
  // concurrent send must not lose a message; these two are the reads.

  async getChatThread(scope: TeamScope): Promise<ChatThread | null> {
    return this.readDoc<ChatThread>(docPaths.runChat(scope), 'getChatThread');
  }

  /** Unpaged: one thread per team, so bounded by the run's participant cap. */
  async listChatThreads(scope: RunScope): Promise<ChatThread[]> {
    return this.listAll<ChatThread>(
      this.ctx.db.collection(colPaths.runChat(scope)),
      'listChatThreads',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Trackables (+ their travel log) and zones
  // ═════════════════════════════════════════════════════════════════════════

  async getTrackable(scope: RunScope, id: string): Promise<Trackable | null> {
    return this.readDoc<Trackable>(
      `${this.runSub(scope, SEGMENTS.trackables)}/${assertId(id, 'trackableId')}`,
      'getTrackable',
    );
  }

  async putTrackable(scope: RunScope, t: Trackable): Promise<void> {
    if (!t?.id) {
      throw new DataError(
        'failed-precondition',
        'putTrackable: Trackable.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(
      `${this.runSub(scope, SEGMENTS.trackables)}/${assertId(t.id, 'trackableId')}`,
      t,
      'putTrackable',
    );
  }

  /** Unpaged, matching `getRunTrackables`: a run's trackables are hand-authored. */
  async listTrackables(scope: RunScope): Promise<Trackable[]> {
    return this.listAll<Trackable>(
      this.ctx.db.collection(this.runSub(scope, SEGMENTS.trackables)),
      'listTrackables',
    );
  }

  /**
   * ⚠ AMBIGUITY, FLAGGED RATHER THAN GUESSED SILENTLY. `transferTrackable`
   * appends with `.add()` (server-minted id) and `TrackableLogEntry` carries no
   * id, so there is nothing caller-supplied to address the document with — yet
   * this package may not mint one (rule 1: a minted id inside a re-executed
   * transaction orphans the previous attempt's document).
   *
   * Best reading: DERIVE a deterministic id from the entry's own fields. It is
   * stable across a retry (so a re-execution overwrites rather than duplicates,
   * which is the safer failure for an append-only log) and it collides only if
   * one team logs the same action on the same trackable at the very same
   * millisecond — in which case the two entries are indistinguishable anyway.
   *
   * The alternative — adding an `id` to `TrackableLogEntry` — is an interface
   * change and therefore the parent's call, not this file's.
   */
  async appendTrackableLog(
    scope: RunScope,
    trackableId: string,
    entry: TrackableLogEntry,
  ): Promise<void> {
    const derivedId = `${entry.at}_${entry.teamId}_${entry.action}`.replace(/\//g, '-');
    await this.writeDoc(
      `${this.runSub(scope, SEGMENTS.trackables)}/${assertId(trackableId, 'trackableId')}` +
        `/${SEGMENTS.trackableLog}/${assertId(derivedId, 'trackableLogId')}`,
      entry,
      'appendTrackableLog',
    );
  }

  async getZone(scope: RunScope, id: string): Promise<Zone | null> {
    return this.readDoc<Zone>(
      `${this.runSub(scope, SEGMENTS.zones)}/${assertId(id, 'zoneId')}`,
      'getZone',
    );
  }

  /**
   * PRESERVED SHAPE MISMATCH: `Zone` (repository.ts) names the label `name`,
   * while `createZone` stores `title`. Both are carried because `Zone` has an
   * index signature — this method stores exactly what it is handed and invents
   * nothing, so a caller mirroring today's callable keeps writing `title`.
   */
  async putZone(scope: RunScope, z: Zone): Promise<void> {
    if (!z?.id) {
      throw new DataError(
        'failed-precondition',
        'putZone: Zone.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(
      `${this.runSub(scope, SEGMENTS.zones)}/${assertId(z.id, 'zoneId')}`,
      z,
      'putZone',
    );
  }

  async deleteZone(scope: RunScope, id: string): Promise<void> {
    await this.deleteDoc(
      `${this.runSub(scope, SEGMENTS.zones)}/${assertId(id, 'zoneId')}`,
      'deleteZone',
    );
  }

  /** Unpaged, matching `getRunZones`: zones are hand-authored per run. */
  async listZones(scope: RunScope): Promise<Zone[]> {
    return this.listAll<Zone>(
      this.ctx.db.collection(this.runSub(scope, SEGMENTS.zones)),
      'listZones',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Guardian-consent tokens
  // ═════════════════════════════════════════════════════════════════════════
  //
  // The token IS the document id (`…/consentTokens/{token}`), so a token is
  // single-use by ADDRESS. The consume is `consumeConsentToken` (atomic.ts);
  // these two are the plain read/seed.

  async getConsentToken(scope: RunScope, token: string): Promise<ConsentToken | null> {
    return this.readDoc<ConsentToken>(
      `${this.runSub(scope, SEGMENTS.consentTokens)}/${assertId(token, 'consentToken')}`,
      'getConsentToken',
    );
  }

  async putConsentToken(scope: RunScope, t: ConsentToken): Promise<void> {
    await this.writeDoc(
      `${this.runSub(scope, SEGMENTS.consentTokens)}/${assertId(t.token, 'consentToken')}`,
      t,
      'putConsentToken',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Staff invites + the PIN lockout counters
  // ═════════════════════════════════════════════════════════════════════════

  async putStaffInvite(scope: RunScope, invite: StaffInvite): Promise<void> {
    if (!invite?.id) {
      throw new DataError(
        'failed-precondition',
        'putStaffInvite: StaffInvite.id is required (ids come from the caller)',
      );
    }
    await this.writeDoc(docPaths.staffInvite(scope, invite.id), invite, 'putStaffInvite');
  }

  async getStaffInvite(scope: RunScope, inviteId: string): Promise<StaffInvite | null> {
    return this.readDoc<StaffInvite>(
      docPaths.staffInvite(scope, inviteId),
      'getStaffInvite',
    );
  }

  /** Unpaged: a run has a handful of staff. Matches the console's read. */
  async listStaffInvites(scope: RunScope): Promise<StaffInvite[]> {
    return this.listAll<StaffInvite>(
      this.ctx.db.collection(colPaths.staffInvites(scope)),
      'listStaffInvites',
    );
  }

  /**
   * `where('pin','==',pin).where('used','==',false).limit(1)` — VERBATIM from
   * `staffSignIn`, including the `used == false` arm.
   *
   * This read is NON-TRANSACTIONAL by design and is never trusted alone: N
   * concurrent callers with the same PIN all see `used == false`, so the
   * single-use consume is `consumeStaffInvite` (atomic.ts) and exactly one of
   * them wins there. Do not "harden" this into a transaction — the ORDER of the
   * two lockout walls relative to this lookup is a deliberate anti-oracle
   * property (a correct, unused PIN must win even while the run-wide counter is
   * locked out by an identity-cycling attacker).
   *
   * PRESERVED ODDITY: `used` is the queried field, but `StaffInvite` declares
   * only `usedAt`. Today's `inviteStaff` writes BOTH (`used: false`), and the
   * query needs the boolean, so a caller must keep writing it.
   */
  async findStaffInviteByPin(scope: RunScope, pin: string): Promise<StaffInvite | null> {
    const found = await this.listAll<StaffInvite>(
      this.ctx.db
        .collection(colPaths.staffInvites(scope))
        .where('pin', '==', pin)
        .where('used', '==', false)
        .limit(1),
      'findStaffInviteByPin',
    );
    return found[0] ?? null;
  }

  /**
   * The two-tier brute-force counters: one per caller uid, plus the run-wide one
   * under the reserved key `'_run'`.
   *
   * Deliberately a plain read + write and NOT an atomic step — that is what it
   * is today, and it is safe as a race precisely because it fails toward MORE
   * lockout, never less (a lost update under-counts failures by one, and the
   * invite consume is the real gate).
   */
  async getStaffAttempts(scope: RunScope, key: string): Promise<StaffAttemptState | null> {
    return this.readDoc<StaffAttemptState>(
      `${this.runSub(scope, SEGMENTS.staffAttempts)}/${assertId(key, 'staffAttemptsKey')}`,
      'getStaffAttempts',
    );
  }

  /**
   * Today's writer uses `.set({merge:true})`; this is a whole-document `.set()`
   * of the complete `StaffAttemptState`, which stores the same three fields. The
   * merge mattered only because the callable wrote partial objects.
   */
  async putStaffAttempts(scope: RunScope, key: string, state: StaffAttemptState): Promise<void> {
    await this.writeDoc(
      `${this.runSub(scope, SEGMENTS.staffAttempts)}/${assertId(key, 'staffAttemptsKey')}`,
      state,
      'putStaffAttempts',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // Post-game feedback
  // ═════════════════════════════════════════════════════════════════════════
  //
  // One response per player uid, and the uid IS the document id — which is what
  // makes "one response per player" a property of the address rather than of a
  // check. The write is `submitFeedbackOnce` (atomic.ts): it must never
  // overwrite an existing response.

  async getFeedback(scope: RunScope, uid: string): Promise<RunFeedback | null> {
    return this.readDoc<RunFeedback>(docPaths.feedback(scope, uid), 'getFeedback');
  }

  /**
   * PRESERVED-BEHAVIOUR NOTE: today's summary reads the whole collection with a
   * bare `.get()` and no order at all (the rollup is order-independent). A
   * keyset cursor needs a deterministic order, so `createdAt` ASCENDING —
   * submission order — is named here. It is the least surprising order for the
   * drill-down list and it does not change any aggregate.
   */
  async listFeedback(scope: RunScope, page: PageRequest): Promise<Page<RunFeedback>> {
    return this.pageQuery<RunFeedback>(
      this.ctx.db.collection(colPaths.feedback(scope)),
      [{ field: 'createdAt', dir: 'asc' }],
      page,
      'listFeedback',
    );
  }


  // ═════════════════════════════════════════════════════════════════════════
  // The stale live-ops sweep
  // ═════════════════════════════════════════════════════════════════════════
  //
  // Mirrors `sweepStaleLiveOps` (functions/src/index.ts). NOTE it is NOT on the
  // `Repository` interface today — there is no sweep method for it — so it is
  // exposed as a method of this class only, for the parent to wire (or not).
  // It is included because the task named it explicitly and because leaving it
  // out would silently drop a behaviour the live-ops aggregate owns.
  //
  // WHAT IT IS FOR. Two documents are written active and nothing ever turns them
  // off: the `kind:'score'` notice `adjustTeamScore` writes (only the CLIENT
  // hides it, on a 10-minute TTL) and a flash mission past its `expiresAt` (only
  // the client's render filter drops it). Both keep occupying slots in the
  // participant's BOUNDED newest-first window, so a still-relevant banner can be
  // pushed out of the window by notices nobody is being shown. This is a
  // correctness bug against those bounds, not a billing tail.
  //
  // FAIL-CLOSED IS THE WHOLE SAFETY ARGUMENT — it only ever retires documents
  // the client ALREADY refuses to render:
  //   * a `kind:'announcement'` doc (or a legacy doc with NO `kind`, which the
  //     type says means 'announcement') is NEVER touched, at any age;
  //   * the `createdAt` range excludes any doc with no `createdAt`, so unknown
  //     age ⇒ leave it alone;
  //   * an unparseable `expiresAt` is not proof of expiry ⇒ the mission stays
  //     ACTIVE.
  // Deactivate, never delete, so the history survives for a future recap.

  /**
   * Mirror of `SCORE_NOTICE_TTL_MS` in play-web's `LiveOps.tsx`. If that TTL
   * grows, this must grow with it — a smaller value here would retire a notice
   * the client would still be showing.
   */
  static readonly SCORE_NOTICE_TTL_MS = 10 * 60 * 1000;

  /**
   * Extra slack on top of the TTL. The client evaluates the TTL against each
   * PHONE's clock, so a slow-clocked phone could still be counting down a notice
   * the server considers expired; this makes the server strictly the later of
   * the two and keeps the sweep invisible.
   */
  static readonly SCORE_NOTICE_SWEEP_GRACE_MS = 60 * 1000;

  /**
   * Hard cap on documents examined per collection per sweep. Bounds both the
   * read cost and the resulting batch: 2 × 40 = 80 writes, far under the 500-op
   * WriteBatch ceiling — so this sweep is bounded BY CONSTRUCTION and never
   * needs chunking.
   */
  static readonly LIVE_OPS_SWEEP_LIMIT = 40;

  /**
   * Retire live-ops documents that have outlived their own visibility rules.
   *
   * `nowMs`/`nowIso` come from the caller (rule 3: this package never reads a
   * clock). Returns how many documents it deactivated.
   *
   * UNLIKE today's version this does NOT swallow its own errors. Best-effort is
   * the CALLER's posture — `sweepStaleLiveOps` is wrapped in a try/catch because
   * every caller has already completed the staff member's actual request — and
   * swallowing here would also swallow a misconfiguration. Same reasoning as
   * `auditBestEffort` staying outside `appendAuditLog`.
   *
   * Not a transaction, and never to be run inside one: it is a bounded sweep.
   */
  async sweepStaleLiveOps(scope: RunScope, nowMs: number, nowIso: string): Promise<number> {
    if (this.io.inTransaction) {
      throw new DataError(
        'failed-precondition',
        'sweepStaleLiveOps: a sweep may not run inside a transaction',
      );
    }
    return guard('sweepStaleLiveOps', async () => {
      const batch = this.ctx.db.batch();
      let ops = 0;

      // ── score notices ────────────────────────────────────────────────────
      // The `createdAt` range does the filtering server-side, so a quiet run
      // reads ZERO documents. `kind` is filtered in memory on purpose: a third
      // equality would need a new composite index, and the range already keeps
      // the candidate set tiny.
      const noticeCutoff = new Date(
        nowMs -
          FirestoreLiveOpsStore.SCORE_NOTICE_TTL_MS -
          FirestoreLiveOpsStore.SCORE_NOTICE_SWEEP_GRACE_MS,
      ).toISOString();
      const staleNotices = await this.io.getQuery(
        this.ctx.db
          .collection(colPaths.announcements(scope))
          .where('active', '==', true)
          .where('createdAt', '<', noticeCutoff)
          .orderBy('createdAt', 'asc')
          .limit(FirestoreLiveOpsStore.LIVE_OPS_SWEEP_LIMIT),
      );
      for (const doc of staleNotices.docs) {
        // ONLY a score notice self-expires. Retiring anything else here WOULD be
        // the "hid a live announcement mid-game" failure.
        if ((doc.data() as { kind?: string }).kind !== 'score') continue;
        batch.update(doc.ref, { active: false, deactivatedAt: nowIso });
        ops++;
      }

      // ── flash missions ───────────────────────────────────────────────────
      // Their lifetime is a per-doc `expiresAt` (caller-supplied TTL), so no
      // single `createdAt` cutoff is correct for all of them and there is no
      // `(isActive, expiresAt)` index to range on. Scan the oldest still-active
      // ones and expire in memory. Self-limiting: because this sweep retires
      // them, the active set stays down to the handful that are genuinely live.
      const activeFlashes = await this.io.getQuery(
        this.ctx.db
          .collection(this.runSub(scope, SEGMENTS.flashMissions))
          .where('isActive', '==', true)
          .orderBy('createdAt', 'asc')
          .limit(FirestoreLiveOpsStore.LIVE_OPS_SWEEP_LIMIT),
      );
      for (const doc of activeFlashes.docs) {
        const expiresAt = (doc.data() as { expiresAt?: unknown }).expiresAt;
        if (typeof expiresAt !== 'string') continue;
        const expiresMs = Date.parse(expiresAt);
        // Unparseable ⇒ NOT proof of expiry. Leave it live and let the client
        // keep deciding — the same fail-open posture as the rest of the app.
        if (!Number.isFinite(expiresMs) || expiresMs > nowMs) continue;
        batch.update(doc.ref, { isActive: false, deactivatedAt: nowIso });
        ops++;
      }

      if (ops > 0) await batch.commit();
      return ops;
    });
  }
}

// Compile-time proof that this class really is the whole live-ops surface. If a
// method is added to any of these interfaces and not to the class, THIS line
// fails rather than a call site in repository.ts.
const _satisfiesLiveOps: new (
  ctx: FirestoreContext,
  io: FsIo,
) => LiveOpsRepository & StaffRepository & FeedbackRepository & RunObjectRepository =
  FirestoreLiveOpsStore;
void _satisfiesLiveOps;

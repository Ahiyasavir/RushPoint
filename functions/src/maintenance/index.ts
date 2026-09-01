// ─── Data-retention maintenance ───────────────────────────────────────────────
//
// Honours the Privacy Policy commitment: raw participant PII captured during a
// run — GPS location pings (teamLocations) and uploaded photos (Storage +
// photoUrl fields on team submissions) — is purged RUN_DATA_RETENTION_DAYS
// after the run finishes. Aggregate results (scores/rankings) are retained.
//
// Three surfaces share one core (`pruneRunPII`):
//   • pruneExpiredRunData  — scheduled daily sweep (production)
//   • pruneExpiredRunDataNow — admin callable, runs the same sweep on demand
//   • pruneRunNow          — admin callable, prunes one named run (e2e-testable)
//
// A SECOND, SHORTER window lives here too (change: post-run-player-report):
// recorded answers — the free-typed text a participant submitted — are destroyed
// after ANSWER_LOG_RETENTION_DAYS (30), by `sweepExpiredAnswerLogs`, well before
// the 90-day PII prune. It reuses the same `evaluateRunPrune` predicate rather
// than deciding age a second way; see the comment on that sweep for why.
//
// Storage deletion is best-effort (catch + continue) so the job is safe whether
// or not a run actually had photo uploads, and is idempotent.

import * as functions from 'firebase-functions';
import { loggedCallable } from '../obs/log';
import { db, storage } from '../firebase';
import {
  RUN_DATA_RETENTION_DAYS,
  GAME_TRASH_RETENTION_DAYS, isPurgeDue, type Game,
  // Recorded answers (change: post-run-player-report) — their own, SHORTER window.
  ANSWER_LOG_RETENTION_DAYS, stripAnswerLogsFromStages, type RunStageRecord,
} from '@rushpoint/shared';
import { deleteDocsInChunks } from '../batchUtil';
// The movement track also lives on the VPS disk when configured; retention must reach it too
// or the 90-day promise would hold in Firestore and quietly fail on disk (change: vps-track-storage).
import { trackStore } from '../trackStore';
import { runPhotoPrefix } from '../storagePaths';
// Pure, total, fail-closed prune eligibility (change: run-retention-completeness).
import {
  evaluateRunPrune, parseRunPath, ABANDONABLE_RUN_STATUSES, type RunRetentionFacts,
} from './runRetention';
// Game trash purge (change: recoverable-game-deletion). purgeGameTree is the ONE
// destruction implementation, shared with the owner-triggered purgeGameNow.
import { purgeGameTree } from '../games/index';
import {
  auditBestEffort, AUDIT_SYSTEM_OPERATOR,
  AUDIT_RUN_PII_PRUNED, AUDIT_RUN_PII_SWEEP, AUDIT_GAME_PURGE_SWEEP, AUDIT_PUBLIC_TASK_BACKFILL,
} from '../obs/audit';
import { backfillPublicTaskCoordinates } from './publicTaskBackfill';
import { assertAdmin } from '../auth';

interface RunRef {
  ownerUid: string;
  gameId: string;
  runId: string;
}

// Run-level subcollections whose docs are bulk-deleted wholesale by the retention
// prune. Every one holds raw participant PII — GPS pings or names/photo URLs:
//   • teamLocations / locationTrack — live GPS pings + append-only movement track
//   • zones                         — capture zones carry the owning team's name
//   • feedItems                     — live photo feed: photo URLs + team names
//   • alerts                        — SOS + safe_zone_breach docs carry raw lat/lng
//                                     (functions/src/index.ts triggerSOS + breach),
//                                     exactly the "GPS location pings" the policy purges
//   • chat                          — team↔HQ threads: free-typed message text +
//                                     senderName (change: feed-ugc-safety). Added when
//                                     the privacy policy gained a participant-deletion
//                                     clause promising chat is purged with the run —
//                                     a Play Data Safety declaration has to match what
//                                     the code actually does.
// Pure list (no I/O) so the delete-set is unit-testable without an emulator.
export const PII_BULK_SUBCOLLECTIONS = [
  'teamLocations',
  'locationTrack',
  'zones',
  'feedItems',
  'alerts',
  'chat',
] as const;

interface PruneResult {
  runId: string;
  locationsDeleted: number;
  photoUrlsCleared: number;
  consentCleared: number;
  /** Recorded answers destroyed here (change: post-run-player-report). Normally 0 —
   *  the 30-day answer-log sweep gets to them first; this is the backstop. */
  answerLogsCleared: number;
  storagePurged: boolean;
}

// Core: strip raw PII from a single finished run. Idempotent.
export async function pruneRunPII({ ownerUid, gameId, runId }: RunRef): Promise<PruneResult> {
  const runPath = `users/${ownerUid}/games/${gameId}/runs/${runId}`;

  // 1) Delete every wholesale-purged raw-PII subcollection (GPS pings + names/URLs).
  //    These can run to thousands of docs, so they're deleted in batch-sized chunks.
  //    PII_BULK_SUBCOLLECTIONS covers teamLocations, the append-only movement track
  //    (locationTrack), capture zones, the live photo feed, and — critically — the
  //    `alerts` subcollection whose SOS/safe_zone_breach docs carry raw lat/lng.
  //    The same track is ALSO purged from the VPS's local disk when that is where it was
  //    recorded. Called unconditionally and best-effort: for a Firestore-mode run it resolves
  //    to "no such file" and costs nothing, so retention does not have to know which mode
  //    recorded the run — and cannot get that judgement wrong.
  await trackStore.delete({ ownerUid, gameId, runId });

  const bulkRefs: FirebaseFirestore.DocumentReference[] = [];
  for (const sub of PII_BULK_SUBCOLLECTIONS) {
    const snap = await db.collection(`${runPath}/${sub}`).get();
    for (const d of snap.docs) bulkRefs.push(d.ref);
  }
  // Trackable travel-log entries name teams (PII) — purge them (keep the trackable docs).
  const trackablesSnap = await db.collection(`${runPath}/trackables`).get();
  for (const td of trackablesSnap.docs) {
    const logSnap = await td.ref.collection('log').get();
    for (const ld of logSnap.docs) bulkRefs.push(ld.ref);
  }
  const locationsDeleted = await deleteDocsInChunks(bulkRefs);

  // 2) Clear photo URLs from each team's submissions (keep scores/answers), and
  //    clear any guardian-consent PII (the guardian's name).
  const teamsSnap = await db.collection(`${runPath}/teams`).get();
  let photoUrlsCleared = 0;
  let consentCleared = 0;
  let answerLogsCleared = 0;
  for (const teamDoc of teamsSnap.docs) {
    const data = teamDoc.data() as {
      taskSubmissions?: Record<string, { photoUrl?: string }>;
      guardianConsent?: { guardianName?: string | null; grantedAt?: string };
      stages?: RunStageRecord[];
    };
    const subs = data.taskSubmissions;
    const cleared: Record<string, { photoUrl: null; pruned: true }> = {};
    let touched = false;
    if (subs) {
      for (const [taskId, sub] of Object.entries(subs)) {
        if (sub && sub.photoUrl) { cleared[taskId] = { photoUrl: null, pruned: true }; photoUrlsCleared++; touched = true; }
      }
    }
    const patch: Record<string, unknown> = {};
    if (touched) patch.taskSubmissions = cleared;
    if (data.guardianConsent?.guardianName) {
      // Keep the grantedAt fact (aggregate), drop the name (PII).
      patch.guardianConsent = { guardianName: null, grantedAt: data.guardianConsent.grantedAt ?? null, pruned: true };
      consentCleared++;
    }
    // Recorded answers (change: post-run-player-report). Their own sweep runs at
    // 30 days, so by 90 they are normally long gone — this makes the PII prune a
    // strict SUPERSET rather than assuming the earlier sweep succeeded, because
    // "we promised to delete it and something skipped it" is not a failure mode
    // worth leaving open. Scores, verdicts and timings survive the strip.
    const strippedStages = stripAnswerLogsFromStages(data.stages);
    if (strippedStages.removed > 0) {
      // A whole-ARRAY rewrite (never a dotted array path). `set({merge:true})`
      // replaces an array field wholesale, which is what is wanted here.
      patch.stages = strippedStages.stages;
      answerLogsCleared += strippedStages.removed;
    }
    if (Object.keys(patch).length > 0) {
      await teamDoc.ref.set(patch, { merge: true });
    }
  }

  // 2b) Delete the single-use consent tokens (they carry team identifiers).
  const tokSnap = await db.collection(`${runPath}/consentTokens`).get();
  consentCleared += await deleteDocsInChunks(tokSnap.docs.map((d) => d.ref));

  // 3) Delete uploaded photo objects under this run's Storage prefix.
  let storagePurged = false;
  try {
    // Pure, unit-tested prefix derivation (change: storage-rules-hardening): a
    // blank runId here would widen to `runs/` and purge every run in the bucket.
    await storage.bucket().deleteFiles({ prefix: runPhotoPrefix(runId) });
    storagePurged = true;
  } catch (e) {
    functions.logger.warn(`pruneRunPII: storage purge failed for run ${runId}`, e);
  }

  // 4) Stamp the run so the scheduled sweep skips it next time. `answerLogPrunedAt`
  //    is stamped too: this prune is a superset of the 30-day answer sweep, so the
  //    shorter sweep must not come back and re-scan a run that is already clean.
  const prunedAt = new Date().toISOString();
  await db.doc(runPath).set({ piiPrunedAt: prunedAt, answerLogPrunedAt: prunedAt }, { merge: true });

  return { runId, locationsDeleted, photoUrlsCleared, consentCleared, answerLogsCleared, storagePurged };
}

// Finds runs past the retention window that have not yet been pruned, and prunes
// each. Collection-group queries over `runs`.
//
// TWO doors, not one (change: run-retention-completeness). This sweep used to
// select on `status == 'finished'` alone — and that status is written in exactly
// one place, `finalizeRun`, i.e. it records a CREATOR CLICKING A BUTTON, not the
// fact that a game ended. An ABANDONED run (group goes home, tab gets closed,
// nobody finalizes) matched nothing and was therefore retained FOREVER: GPS
// pings, photos, audio, chat, SOS coordinates, guardian names — against a Privacy
// Policy that promises 90-day auto-deletion. So there is now a second query for
// non-finished runs.
//
// THE QUERIES ARE A FILTER; `evaluateRunPrune` IS THE AUTHORITY. Nothing is
// destroyed because a query returned it — the pure predicate re-decides from the
// document's own fields, biases every ambiguity toward keep, and anchors an
// unfinalized run on the MAXIMUM of all its timestamps so one recent write vetoes
// the prune. `createdAt < cutoff` is a strict necessary condition of that anchor
// (the max includes createdAt), so query B cannot hide a run the predicate would
// have pruned.
//
// ⚠ Query B needs the `runs` COLLECTION_GROUP composite index (status, createdAt)
// in firestore.indexes.json — deploy indexes BEFORE functions.
export const RUN_SWEEP_MAX_RUNS = 100;

export async function sweepExpiredRuns(
  now = new Date(),
  maxRuns: number = RUN_SWEEP_MAX_RUNS,
): Promise<PruneResult[]> {
  const cutoff = new Date(now.getTime() - RUN_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // A: finalized runs — unchanged rule, unchanged index.
  const finishedSnap = await db
    .collectionGroup('runs')
    .where('status', '==', 'finished')
    .where('finishedAt', '<', cutoff)
    .get();

  // B: abandoned/stale runs — oldest first, so a capped sweep drains the backlog
  // deterministically instead of revisiting the same head every day.
  const abandonedSnap = await db
    .collectionGroup('runs')
    .where('status', 'in', [...ABANDONABLE_RUN_STATUSES])
    .where('createdAt', '<', cutoff)
    .orderBy('createdAt', 'asc')
    .get();

  const results: PruneResult[] = [];
  const seen = new Set<string>();
  for (const runDoc of [...finishedSnap.docs, ...abandonedSnap.docs]) {
    if (seen.has(runDoc.ref.path)) continue;
    seen.add(runDoc.ref.path);

    const decision = evaluateRunPrune(runDoc.data() as RunRetentionFacts, now);
    if (!decision.prune) continue;

    // Never derive an id from a path we do not recognise: a blank runId would
    // widen the Storage prefix to `runs/` (every run in the bucket).
    const ref = parseRunPath(runDoc.ref.path);
    if (!ref) {
      functions.logger.warn('sweepExpiredRuns: skipping unrecognised run path', { path: runDoc.ref.path });
      continue;
    }
    if (results.length >= maxRuns) {
      functions.logger.warn(
        `sweepExpiredRuns: stopped early at the ${maxRuns}-run cap; the rest resume next sweep`,
      );
      break;
    }
    results.push(await pruneRunPII(ref));
  }
  return results;
}


// ─── Answer-log sweep (change: post-run-player-report) ───────────────────────
//
// Recorded answers are the free-typed text a participant submitted — the most
// sensitive thing a run captures after location — and the creator's stated need
// for it is "read the report after the event", not "keep it forever". So it has
// its OWN, SHORTER window: ANSWER_LOG_RETENTION_DAYS (30) against the 90 days the
// PII prune above runs on.
//
// It reuses `evaluateRunPrune` rather than re-deciding eligibility, by passing
// `answerLogPrunedAt` into the tombstone slot and 30 as the window. That is the
// whole point: every fail-closed rule that predicate already encodes — a finalized
// run anchors on `finishedAt`, an UNFINALIZED one anchors on the MAXIMUM of all
// its timestamps so a single recent write vetoes destruction, clock skew refuses,
// an unparseable timestamp refuses — is inherited, not reimplemented. A second
// implementation of "is this run old enough to destroy data from" is exactly how
// the two windows would drift apart, and the failure mode is wiping a game that is
// still being played.
//
// The queries are a cheap FILTER; the predicate is the authority. No new index:
// these are the same two collection-group queries the PII sweep runs, widened to
// the shorter cutoff.

/** Strip every recorded answer from one run's teams. Idempotent. */
export async function pruneRunAnswerLogs(
  { ownerUid, gameId, runId }: RunRef,
): Promise<{ runId: string; teamsTouched: number; logsRemoved: number }> {
  const path = `users/${ownerUid}/games/${gameId}/runs/${runId}`;
  const teamsSnap = await db.collection(`${path}/teams`).get();
  let teamsTouched = 0;
  let logsRemoved = 0;
  for (const teamDoc of teamsSnap.docs) {
    const { stages, removed } = stripAnswerLogsFromStages(
      (teamDoc.data() as { stages?: RunStageRecord[] }).stages,
    );
    if (removed === 0) continue;
    // The whole stages ARRAY is rewritten — a dotted path into an array element
    // would coerce it to a map and destroy the team's progress, which is a far
    // worse outcome than keeping the text one more day.
    await teamDoc.ref.update({ stages, updatedAt: new Date().toISOString() });
    teamsTouched++;
    logsRemoved += removed;
  }
  // Stamp regardless of whether anything was found, so a run with no recorded
  // answers is not re-scanned every night for the rest of its life.
  await db.doc(path).set({ answerLogPrunedAt: new Date().toISOString() }, { merge: true });
  return { runId, teamsTouched, logsRemoved };
}

export async function sweepExpiredAnswerLogs(
  now = new Date(),
  maxRuns: number = RUN_SWEEP_MAX_RUNS,
): Promise<Array<{ runId: string; teamsTouched: number; logsRemoved: number }>> {
  const cutoff = new Date(now.getTime() - ANSWER_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [finishedSnap, abandonedSnap] = await Promise.all([
    db.collectionGroup('runs').where('status', '==', 'finished').where('finishedAt', '<', cutoff).get(),
    db.collectionGroup('runs')
      .where('status', 'in', [...ABANDONABLE_RUN_STATUSES])
      .where('createdAt', '<', cutoff)
      .orderBy('createdAt', 'asc')
      .get(),
  ]);

  const results: Array<{ runId: string; teamsTouched: number; logsRemoved: number }> = [];
  const seen = new Set<string>();
  for (const runDoc of [...finishedSnap.docs, ...abandonedSnap.docs]) {
    if (seen.has(runDoc.ref.path)) continue;
    seen.add(runDoc.ref.path);

    const facts = runDoc.data() as RunRetentionFacts & { answerLogPrunedAt?: string | null };
    // The tombstone SUBSTITUTION described above — this sweep's own idempotence
    // marker, judged by the same predicate.
    const decision = evaluateRunPrune(
      { ...facts, piiPrunedAt: facts.answerLogPrunedAt ?? null },
      now,
      ANSWER_LOG_RETENTION_DAYS,
    );
    if (!decision.prune) continue;

    const ref = parseRunPath(runDoc.ref.path);
    if (!ref) {
      functions.logger.warn('sweepExpiredAnswerLogs: skipping unrecognised run path', { path: runDoc.ref.path });
      continue;
    }
    if (results.length >= maxRuns) {
      functions.logger.warn(
        `sweepExpiredAnswerLogs: stopped early at the ${maxRuns}-run cap; the rest resume next sweep`,
      );
      break;
    }
    results.push(await pruneRunAnswerLogs(ref));
  }
  return results;
}


// ─── Game trash purge sweep (change: recoverable-game-deletion) ──────────────
//
// deleteGame no longer destroys anything: it writes a `deletedAt` tombstone and
// the game stays recoverable for GAME_TRASH_RETENTION_DAYS. This is the other end
// of that contract — the sweep that actually destroys a game once its grace
// period has elapsed.
//
// It DELIBERATELY reuses the existing daily retention schedule below instead of
// adding a second scheduler: same cadence, same timezone, one job to reason about.
//
// The query is an inequality on a COLLECTION-GROUP scope, which Firestore does not
// auto-index — see the `games.deletedAt` COLLECTION_GROUP fieldOverride in
// firestore.indexes.json. `isPurgeDue` (shared, pure) makes the final call, so a
// corrupt/unparseable tombstone is never destroyed.

// `operatorId` DEFAULTS to the system identity so the scheduled job's call site is
// unchanged and keeps attributing to the system — it genuinely is the system.
// Only the on-demand admin callable overrides it (change:
// callable-hardening-consistency). Before this, both callers hard-coded
// AUDIT_SYSTEM_OPERATOR, so an admin forcing a purge with `graceDays: 0` produced
// `game_purged` records claiming `system:purge-sweep` did it. That is worse than a
// missing record: the audit trail answered the one question it exists for — "the
// nightly job, or a person?" — incorrectly.
export async function sweepPurgeableGames(
  now = new Date(),
  days: number = GAME_TRASH_RETENTION_DAYS,
  operatorId: string = AUDIT_SYSTEM_OPERATOR,
): Promise<Array<{ ownerUid: string; gameId: string }>> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const snap = await db
    .collectionGroup('games')
    .where('deletedAt', '<=', cutoff)
    .get();

  const purged: Array<{ ownerUid: string; gameId: string }> = [];
  for (const gameDoc of snap.docs) {
    const game = gameDoc.data() as Game;
    // Re-check with the shared predicate: the query is the cheap filter, this is
    // the authority (and it fails closed on an unparseable timestamp).
    if (!isPurgeDue(game.deletedAt, now, days)) continue;
    // path: users/{ownerUid}/games/{gameId}
    const parts = gameDoc.ref.path.split('/');
    const ownerUid = parts[1];
    const gameId = parts[3];
    await purgeGameTree(ownerUid, gameId, operatorId);
    purged.push({ ownerUid, gameId });
  }
  return purged;
}


// ─── Scheduled daily sweep ──────────────────────────────────────────────────
export const pruneExpiredRunData = functions.pubsub
  .schedule('every 24 hours')
  .timeZone('Asia/Jerusalem')
  .onRun(async () => {
    // Recorded answers first, on their own 30-day window (change:
    // post-run-player-report). Before the 90-day PII prune on purpose: the runs it
    // covers are a SUPERSET, and doing it first means the PII prune below usually
    // finds nothing left to strip.
    const answerResults = await sweepExpiredAnswerLogs();
    functions.logger.info(
      `pruneExpiredRunData: cleared recorded answers on ${answerResults.length} run(s)`,
      { answerResults, stoppedEarly: answerResults.length >= RUN_SWEEP_MAX_RUNS },
    );
    const results = await sweepExpiredRuns();
    functions.logger.info(
      `pruneExpiredRunData: pruned ${results.length} run(s)`,
      { results, stoppedEarly: results.length >= RUN_SWEEP_MAX_RUNS },
    );
    // Same daily job destroys games whose 30-day trash window has elapsed.
    const purgedGames = await sweepPurgeableGames();
    functions.logger.info(`pruneExpiredRunData: purged ${purgedGames.length} deleted game(s)`, { purgedGames });
    return null;
  });


// ─── On-demand admin callables (testable) ─────────────────────────────────────
export const pruneExpiredRunDataNow = loggedCallable('pruneExpiredRunDataNow', async (_data, context) => {
  const operatorId = assertAdmin(context);
  // The 30-day recorded-answer sweep runs here too, so the on-demand callable and
  // the nightly schedule do the SAME work — a divergence between them is how an
  // operator proves a retention promise against a code path nobody actually runs.
  const answerResults = await sweepExpiredAnswerLogs();
  const results = await sweepExpiredRuns();
  // ONE record per invocation, not per run: this can prune 100 runs in a call, and
  // a row each would bury the actual event in the collection listAuditLogs reads.
  // After the sweep, and best-effort — a failed audit write must never turn the
  // accountability fix into an outage (obs/audit.ts).
  await auditBestEffort({
    operatorId, actionType: AUDIT_RUN_PII_SWEEP,
    newValue: results.length,
    reason: `on-demand retention sweep; ${results.length} run(s) pruned`,
    runs: results.map((r) => r.runId),
    stoppedEarly: results.length >= RUN_SWEEP_MAX_RUNS,
  });
  // stoppedEarly tells an operator draining a historical backlog to call again.
  return {
    ok: true,
    prunedCount: results.length,
    answerLogRunsCleared: answerResults.length,
    answerLogsCleared: answerResults.reduce((n, r) => n + r.logsRemoved, 0),
    stoppedEarly: results.length >= RUN_SWEEP_MAX_RUNS,
    results,
  };
});

// Game trash purge, on demand (change: recoverable-game-deletion). Mirrors
// pruneExpiredRunDataNow: the scheduled sweep is not callable, so without this
// there is no way to exercise or force the purge path.
//
// `graceDays` is an ADMIN-ONLY override, and it is what makes the grace period
// provable in both directions without waiting a month (30 ⇒ nothing purged,
// 0 ⇒ purged). Same gate and same trust level as pruneRunNow — assertAdmin has no
// emulator bypass, and it can only ever destroy games that are ALREADY tombstoned.
export const purgeDeletedGamesNow = loggedCallable('purgeDeletedGamesNow', async (data, context) => {
  const operatorId = assertAdmin(context);
  const { graceDays } = (data ?? {}) as { graceDays?: number };
  const days = typeof graceDays === 'number' && Number.isFinite(graceDays) && graceDays >= 0
    ? graceDays
    : GAME_TRASH_RETENTION_DAYS;
  // Passing operatorId is the fix for the misattribution described on
  // sweepPurgeableGames: each per-game `game_purged` record now names the admin.
  const purged = await sweepPurgeableGames(new Date(), days, operatorId);
  // Plus one summary record at the call site, because the per-game records cannot
  // show the thing that makes this callable dangerous — the graceDays override
  // that decided how much of the trash was in scope.
  await auditBestEffort({
    operatorId, actionType: AUDIT_GAME_PURGE_SWEEP,
    previousValue: GAME_TRASH_RETENTION_DAYS,
    newValue: days,
    reason: `on-demand game trash purge with graceDays=${days}; ${purged.length} game(s) destroyed`,
    games: purged.map((p) => p.gameId),
  });
  return { ok: true, purgedCount: purged.length, graceDays: days, purged };
});

// publicTasks legacy-coordinate backfill (change: public-task-coordinates-backfill).
// Admin-only and paged: `startAfter` continues from a previous call's `cursor`,
// so a large library is swept in bounded chunks instead of one timeout-prone
// pass. `dryRun` reports what would change and writes nothing.
export const backfillPublicTaskCoordinatesNow = loggedCallable(
  'backfillPublicTaskCoordinatesNow',
  async (data, context) => {
    const operatorId = assertAdmin(context);
    const { limit, startAfter, dryRun } = (data ?? {}) as {
      limit?: number; startAfter?: string | null; dryRun?: boolean;
    };
    const result = await backfillPublicTaskCoordinates({ limit, startAfter, dryRun });
    // One record per PAGE, not per document (a page is up to 500 docs). A dry run
    // is recorded as a dry run rather than skipped: "an admin swept the public
    // library and it reported N pending repairs" is itself a fact worth keeping.
    await auditBestEffort({
      operatorId, actionType: AUDIT_PUBLIC_TASK_BACKFILL,
      newValue: result.repaired,
      reason: `${dryRun ? 'dry-run' : 'applied'} publicTasks coordinate backfill page`,
      dryRun: !!dryRun,
      scanned: result.scanned,
      repaired: result.repaired,
      cleared: result.cleared,
      orphaned: result.orphaned,
      cursor: result.cursor,
      done: result.done,
    });
    return { ok: true, ...result };
  },
);

export const pruneRunNow = loggedCallable('pruneRunNow', async (data, context) => {
  const operatorId = assertAdmin(context);
  const { ownerUid, gameId, runId } = data as RunRef;
  if (!ownerUid || !gameId || !runId) {
    throw new functions.https.HttpsError('invalid-argument', 'ownerUid, gameId, runId required');
  }
  const result = await pruneRunPII({ ownerUid, gameId, runId });
  // Nothing pruneRunPII destroys is recoverable — subcollections, Storage objects,
  // guardian-consent PII. Without this the only trace of who ran it was a console
  // line that ages out of Cloud Logging retention.
  await auditBestEffort({
    operatorId, actionType: AUDIT_RUN_PII_PRUNED,
    ownerUid, gameId, runId,
    newValue: result.locationsDeleted,
    reason: `on-demand PII prune: ${result.locationsDeleted} doc(s), `
      + `${result.photoUrlsCleared} photo url(s), storagePurged=${result.storagePurged}`,
    photoUrlsCleared: result.photoUrlsCleared,
    consentCleared: result.consentCleared,
    storagePurged: result.storagePurged,
  });
  return { ok: true, ...result };
});

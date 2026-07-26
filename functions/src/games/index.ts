// ─── Game CRUD callables ──────────────────────────────────────────────────────
//
// All callables require the caller to be authenticated (Firebase Auth).
// Ownership is enforced: only the creator (ownerUid === context.auth.uid)
// may update/delete their own games.

import * as functions from 'firebase-functions';
import { loggedCallable, logBestEffort } from '../obs/log';
import { db } from '../firebase';
import * as admin from 'firebase-admin';
import {
  type Game,
  type Stage,
  type Task,
  type CreateGamePayload,
  type UpdateGamePayload,
  type PublicGame,
  type PublicTask,
  DEFAULT_REGISTRATION_FIELDS,
  DEFAULT_SCORING_PRESET,
  describeGameRequirements,
  matchesTaskAnswer,
  collectTranslatableFields,
  applyTranslations,
  normalizeTaskMedia,
  type TaskMedia,
  isAllowedWebhookUrl,
  detectPlatform,
  validateUnlockGraph,
  requiredTaskCountProblem,
  validateAvailabilityWindow,
  validateOrderItems,
  validateSurveyChoices,
  sumEstimatedMinutes,
  gameStructureProblems,
  // What a PUBLIC task may say about where it is (change: task-library-map-view).
  publicTaskLocation,
  stripUnsafeDisplayChars,
  // THE one definition of a tag list (change: game-task-tags). The client parses
  // with the same function, so what the creator sees and what we store cannot
  // diverge — and a client that skips it (or is hostile) still cannot store an
  // unbounded list, because every write path below runs it server-side.
  normalizeTags,
  propagateGameTagsToTasks,
  cleanGameInstructions,
  FIRESTORE_PATHS,
  // Game trash / tombstone lifecycle (change: recoverable-game-deletion).
  type Run,
  type AccessCode,
  GAME_TRASH_RETENTION_DAYS,
  isGameDeleted,
  visibleGames,
  deletedGames,
  gamePurgeDueAt,
  // Creator-owned portable game file (change: game-file-export-import).
  serializeGameToFile,
  parseGameFile,
  // Server-enforced settings validated at the door (change: expose-enforced-settings).
  validateSafeZone,
  validateMinAge,
  validateConsentFlag,
} from '@rushpoint/shared';
import { assertGameNotDeleted, loadOwnedLiveGame, loadOwnedTrashedGame } from './lifecycle';
// What a PUBLIC GAME may say about where it is (change: surface-invisible-fields).
// The gallery map plots publicGames by approxLocation and nothing ever wrote one, so
// the map was permanently blank; this derives a coarse area from the game's own
// publicly-locatable tasks when the creator authored none.
import { resolveGameArea } from './gameArea';
import {
  auditBestEffort, AUDIT_GAME_DELETED, AUDIT_GAME_RESTORED, AUDIT_GAME_PURGED,
} from '../obs/audit';
// Gallery ranking signals (change: gallery-popularity-ranking) — the single
// transactional writer, so a counter can never move without its score.
import { bumpPublicSignals, scoreFor } from '../gallery/popularityStore';
import { deleteRunsPhotos, deleteGameMedia } from '../storageUtil';
import { deleteDocsInChunks } from '../batchUtil';

const APP_ID = process.env.RUSHPOINT_APP_ID ?? 'rushpoint-pwa-7daaa';

function gamesCol(uid: string) {
  return `users/${uid}/games`;
}
function gamePath(uid: string, gameId: string) {
  return `users/${uid}/games/${gameId}`;
}

import { requireAuth } from '../auth';

// Enforce the task-media trust boundary on every write: run each task's `media`
// through normalizeTaskMedia so a client can never persist an off-origin image/video
// URL or an unparseable YouTube link, and YouTube URLs are stored canonically. Returns
// a NEW stages array (never dotted-update an array element — coerces it to a map).
function normalizeStagesMedia(stages: Stage[] | undefined): Stage[] | undefined {
  if (!Array.isArray(stages)) return stages;
  return stages.map((stage) => ({
    ...stage,
    tasks: (stage.tasks ?? []).map((task) => {
      if (task.media === undefined) return task;
      // wave-c: same emulator-origin defect as submitStationPhoto — locally a
      // creator-uploaded image/video gets an emulator-hosted download URL, which the
      // production-origin gate silently DROPPED on every save. FUNCTIONS_EMULATOR is
      // absent in deployed functions, so production behaviour is unchanged.
      const media = normalizeTaskMedia(task.media, {
        allowLocalEmulator: process.env.FUNCTIONS_EMULATOR === 'true',
      }) as TaskMedia[];
      // Drop the field entirely when it normalizes to empty (avoid persisting []).
      if (media.length === 0) {
        const { media: _omit, ...rest } = task;
        return rest as Task;
      }
      return { ...task, media };
    }),
  }));
}

// Strip control / bidi-override / zero-width spoofing chars from every authored
// stage + task title/description (wave-j J6) before persisting. Returns a NEW
// stages array (never dotted-update an array element — coerces it to a map).
// Only display text is touched; answer keys, coordinates, and types are untouched.
//
// `gameTags` (feature: game-tags-propagate): when the EFFECTIVE game tags are known,
// they are UNIONED into every task's tags so tagging the game once makes its missions
// inherit those tags (the foundation for gallery tag-search). The union runs on the
// same NEW array this pass already builds; `propagateGameTagsToTasks` is idempotent
// and delegates dedup/cap/casing to `normalizeTags`, so the per-task `normalizeTags`
// below and this call cannot disagree. When `gameTags` is omitted the behaviour is
// exactly the prior per-task normalize.
function sanitizeStagesText(stages: Stage[] | undefined, gameTags?: string[]): Stage[] | undefined {
  if (!Array.isArray(stages)) return stages;
  const clean = (s: string | undefined): string | undefined =>
    s === undefined ? undefined : stripUnsafeDisplayChars(s);
  const sanitized = stages.map((stage) => ({
    ...stage,
    title: clean(stage.title) ?? stage.title,
    tasks: (stage.tasks ?? []).map((task) => ({
      ...task,
      title: clean(task.title) ?? task.title,
      ...(task.description !== undefined ? { description: clean(task.description) } : {}),
      // Task tags (change: game-task-tags) — bounded here rather than trusted, and
      // done inside this pass on purpose: it rebuilds a NEW stages array, and this
      // repo's hard rule is never to dotted-update an element of a stored array.
      ...(task.tags !== undefined ? { tags: normalizeTags(task.tags) } : {}),
    })),
  }));
  // Union the effective game tags into every task (feature: game-tags-propagate).
  // Only when the caller supplied them — a caller that does not know the game's tags
  // must not blank the inherited ones away.
  return gameTags === undefined
    ? sanitized
    : (propagateGameTagsToTasks(gameTags, sanitized) as Stage[]);
}

/**
 * Every save-blocking problem with an authored `stages` array. THE SINGLE SOURCE
 * shared by updateGame (Builder save) and importGameFile (restore from a creator's
 * own file), so a game restored from a file can never be accepted on terms an
 * authored one would be refused — and vice versa.
 *
 * Covers: structural winnability (empty-task stage, uncompletable task, negative
 * pointValue/difficulty/estimatedMinutes — shared with publishGame), the per-stage
 * unlock prerequisite graph (no self-reference, no cross-stage/unknown ids, no
 * cycles), availability windows (an expiry at or before its release can never be
 * played), ordering-quiz rules (quiz-only, one grading mode per task, 3–10 valid
 * items), survey-choice rules (2–8 non-empty options) and stage winnability (a
 * `requiredTaskCount` above what the stage's exclusive groups can ever yield).
 */
function stagesProblems(stages: Stage[] | undefined): string[] {
  const problems: string[] = [];
  problems.push(...gameStructureProblems(stages));
  for (const stage of stages ?? []) {
    problems.push(...validateUnlockGraph(stage).errors);
    // Stage winnability (change: stage-winnability). Exclusive groups yield ONE
    // completion each, so a stage of three alternative pairs can never yield six.
    // REJECTED, never clamped: silently lowering the count would change the design
    // of the event and leave the creator looking at a number the server does not
    // hold. The Builder can no longer produce such a value, so this only ever fires
    // against a stale tab, a hand edited game file or a direct callable call.
    const winnability = requiredTaskCountProblem(
      stage as unknown as Parameters<typeof requiredTaskCountProblem>[0],
      `Stage "${stage.title || stage.id}"`,
    );
    if (winnability) problems.push(winnability);
    for (const task of stage.tasks ?? []) {
      const windowError = validateAvailabilityWindow(task);
      if (windowError) problems.push(`Task "${task.title || task.id}": ${windowError}`);
      if (task.orderItems !== undefined) {
        const label = `Task "${task.title || task.id}"`;
        if (task.type !== 'quiz') {
          problems.push(`${label}: ordering items are only valid on a quiz task`);
        } else if ((task.choices?.length ?? 0) > 0 || (task.answers?.length ?? 0) > 0) {
          problems.push(`${label}: a quiz cannot mix ordering items with choices or typed answers`);
        }
        const orderError = validateOrderItems(task.orderItems);
        if (orderError) problems.push(`${label}: ${orderError}`);
      }
      if (task.surveyChoices !== undefined) {
        const choiceError = validateSurveyChoices(task.surveyChoices);
        if (choiceError) problems.push(`Task "${task.title || task.id}": ${choiceError}`);
      }
    }
  }
  return problems;
}


// ─── createGame ───────────────────────────────────────────────────────────────

export const createGame = loggedCallable('createGame', async (data, context) => {
  const uid = requireAuth(context);
  const { title, description, mode = 'individual', tags = [] } = data as CreateGamePayload;

  if (!title?.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'title is required');
  }

  const now = new Date().toISOString();
  const ref = db.collection(gamesCol(uid)).doc();

  const game: Game = {
    id: ref.id,
    ownerUid: uid,
    // Strip control / bidi-override / zero-width spoofing chars from authored text
    // (wave-j J6) so a title/description can't impersonate another name in the
    // creator, play, or staff console — mirrors requireString on the callables.
    title: stripUnsafeDisplayChars(title).trim(),
    description: description ? stripUnsafeDisplayChars(description).trim() : description,
    mode,
    stages: [],
    scoringPreset: DEFAULT_SCORING_PRESET,
    registrationFields: DEFAULT_REGISTRATION_FIELDS,
    visibility: 'private',
    // Bounded, never trusted (change: game-task-tags).
    tags: normalizeTags(tags),
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(game);
  return { gameId: ref.id };
});


// ─── updateGame ───────────────────────────────────────────────────────────────

export const updateGame = loggedCallable('updateGame', async (data, context) => {
  const uid = requireAuth(context);
  const {
    gameId,
    title, description, mode, stages, scoringPreset, scoringOptions,
    registrationFields, branding, tags, coverImage, approxLocation,
    requiresGuardianConsent, minAge, safeZone, benchmarkOptOut,
    integrationWebhookUrl, allowInstantPlay, photoFeedEnabled, powerUpsEnabled,
    instructions,
  } = data as UpdateGamePayload;
  // Staged leaderboard reveal (change: manual-leaderboard-reveal). Read off the
  // raw payload with a narrow cast rather than the UpdateGamePayload destructure
  // — the shared payload type does not carry the field yet (see
  // docs/wave-b/leaderboard-reveal.md); adding it there is a pure type widening
  // and this stays correct either way.
  const { manualLeaderboardReveal } = data as { manualLeaderboardReveal?: boolean };

  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const ref = db.doc(gamePath(uid, gameId));
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  if ((snap.data() as Game).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }
  // A game in the trash is not editable (change: recoverable-game-deletion) —
  // otherwise a stale Builder tab could keep writing to a "deleted" game.
  assertGameNotDeleted(snap.data() as Game);

  const updates: Partial<Game> & { updatedAt: string } = { updatedAt: new Date().toISOString() };
  if (title !== undefined)              updates.title = stripUnsafeDisplayChars(title).trim();
  if (description !== undefined)        updates.description = description ? stripUnsafeDisplayChars(description).trim() : description;
  if (mode !== undefined)               updates.mode = mode;
  if (stages !== undefined) {
    // Save-time validation. Unlockable tasks (change: unlockable-tasks): the
    // per-stage prerequisite graph must be sound — no self-reference, no
    // cross-stage/unknown ids, no cycles (a cycle-free graph always leaves at
    // least one prerequisite-free task, so the stage stays routable). Task
    // expiry (change: task-expiry): a relative expiry at or before a relative
    // release is an empty availability window and can never be played.
    // Save-time validation, shared verbatim with importGameFile (stagesProblems
    // above) so the Builder save path and the file-restore path can never drift.
    const problems = stagesProblems(stages);
    if (problems.length > 0) {
      throw new functions.https.HttpsError('invalid-argument', problems.join(' · '));
    }
    // Strip control / bidi-override / zero-width spoofing chars from every authored
    // title/description (game handled below; stage + task here) before persisting
    // (wave-j J6). Returns a NEW stages array (never dotted-update an array element).
    // Effective game tags for propagation (feature: game-tags-propagate): the payload's
    // tags when this save carries them, else the tags already stored on the game — so
    // saving stages alone still inherits the game's existing tags onto every task, and
    // renaming the tags in the same save propagates the NEW set. Normalized here so the
    // union is against the same bounded list the game itself stores.
    const effectiveTags = normalizeTags(tags ?? (snap.data() as Game).tags);
    updates.stages = normalizeStagesMedia(sanitizeStagesText(stages, effectiveTags));
  }
  if (scoringPreset !== undefined)      updates.scoringPreset = scoringPreset;
  if (scoringOptions !== undefined)     updates.scoringOptions = scoringOptions;
  if (registrationFields !== undefined) updates.registrationFields = registrationFields;
  if (branding !== undefined)           updates.branding = branding;
  // Never trusted (change: game-task-tags). This line used to be a bare
  // `updates.tags = tags`, so a client could store 10 000 tags — or one a megabyte
  // long — which then rode into world-readable publicGames below.
  if (tags !== undefined)               updates.tags = normalizeTags(tags);
  if (coverImage !== undefined)         updates.coverImage = coverImage;
  if (approxLocation !== undefined)     updates.approxLocation = approxLocation;
  // Enforced settings are validated, never trusted (change: expose-enforced-settings).
  // All three used to be bare assignments onto fields the SERVER gates behavior on:
  // `safeZone` is read by updateLocation and by the routing soft-pause, and
  // `requiresGuardianConsent` decides whether a team may start at all. `undefined`
  // still means "not sent"; a present-but-malformed value is now refused loudly
  // rather than persisted into a safety path.
  const consentFlagCheck = validateConsentFlag(requiresGuardianConsent);
  if (!consentFlagCheck.ok) throw new functions.https.HttpsError('invalid-argument', consentFlagCheck.error);
  const minAgeCheck = validateMinAge(minAge);
  if (!minAgeCheck.ok) throw new functions.https.HttpsError('invalid-argument', minAgeCheck.error);
  const safeZoneCheck = validateSafeZone(safeZone);
  if (!safeZoneCheck.ok) throw new functions.https.HttpsError('invalid-argument', safeZoneCheck.error);

  if (requiresGuardianConsent !== undefined) updates.requiresGuardianConsent = requiresGuardianConsent;
  if (minAge !== undefined)             updates.minAge = minAge;
  // `safeZone: null` is an explicit clear and validates to `undefined`. It has to be
  // written as an explicit field DELETE: `db.settings({ ignoreUndefinedProperties:
  // true })` (functions/src/firebase.ts:10) makes `updates.safeZone = undefined` a
  // silent no-op, so "remove the play-area boundary" would leave the boundary in
  // place and the enforcement path would keep flagging teams (change:
  // expose-enforced-settings). Mirrors how `instructions` clears, below.
  if (safeZone !== undefined) {
    updates.safeZone = safeZoneCheck.value
      ?? (admin.firestore.FieldValue.delete() as unknown as undefined);
  }
  if (benchmarkOptOut !== undefined)    updates.benchmarkOptOut = benchmarkOptOut;
  if (allowInstantPlay !== undefined)   updates.allowInstantPlay = allowInstantPlay;
  if (photoFeedEnabled !== undefined)   updates.photoFeedEnabled = photoFeedEnabled;
  if (powerUpsEnabled !== undefined)    updates.powerUpsEnabled = powerUpsEnabled;
  // Organizer-only control: gates whether finalizeRun publishes the final board to
  // participants. Deliberately NOT mirrored into publicGames (below) — it is a run
  // control, not gallery data.
  if (manualLeaderboardReveal !== undefined) updates.manualLeaderboardReveal = manualLeaderboardReveal;
  // Game intro primer (change: game-intro-instructions): clean-or-clear, mirroring
  // integrationWebhookUrl. A defined primer with content is stored cleaned (https
  // image guard lives in cleanGameInstructions); defined + empty ⇒ delete the field.
  if (instructions !== undefined) {
    const cleaned = cleanGameInstructions(instructions);
    updates.instructions = cleaned ?? (admin.firestore.FieldValue.delete() as unknown as undefined);
  }
  // Chat integration (change: chat-integrations): validate the owner-supplied
  // webhook URL against the SSRF allow-list. An empty string clears it; a non-empty
  // off-allowlist URL is rejected loud (never silently persisted).
  if (integrationWebhookUrl !== undefined) {
    const raw = (integrationWebhookUrl ?? '').trim();
    if (raw === '') {
      updates.integrationWebhookUrl = admin.firestore.FieldValue.delete() as unknown as undefined;
      updates.integrationPlatform = admin.firestore.FieldValue.delete() as unknown as undefined;
    } else if (isAllowedWebhookUrl(raw)) {
      updates.integrationWebhookUrl = raw;
      updates.integrationPlatform = detectPlatform(raw);
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Webhook URL must be a Slack or Microsoft Teams incoming-webhook URL');
    }
  }

  await ref.update(updates);

  // Consistency (consistency sweep C2): if the game is PUBLISHED, keep its
  // gallery summary in sync with this edit so the public card can't drift from
  // the live Dashboard. Best-effort PARTIAL update — never touches playCount (a
  // live counter maintained by launchRun) or the publicTasks copyCount, and
  // skips the auth lookup (ownerDisplayName doesn't change on a content edit).
  const existing = snap.data() as Game;
  if (existing.visibility === 'public') {
    const merged = { ...existing, ...updates } as Game;
    const allTasks = merged.stages.flatMap((s) => s.tasks);
    db.doc(`publicGames/${gameId}`).update({
      title: merged.title,
      description: merged.description,
      mode: merged.mode,
      scoringPreset: merged.scoringPreset,
      // Already normalized by the `updates.tags` line above (or already stored
      // normalized) — normalizeTags is idempotent, so no second call is needed here.
      tags: merged.tags,
      coverImage: merged.coverImage,
      // Recomputed from the tasks as just saved (change: surface-invisible-fields), so
      // a published game's map pin can never describe a layout that no longer exists.
      // An authored area still wins; undefined leaves the stored value untouched.
      approxLocation: resolveGameArea(merged.approxLocation, merged.stages),
      stageCount: merged.stages.length,
      taskCount: allTasks.length,
      estimatedTotalMinutes: sumEstimatedMinutes(allTasks),
      allowInstantPlay: merged.allowInstantPlay ?? false,
      // Game intro primer (change: game-intro-instructions): keep the public teaser
      // in sync — write the cleaned primer or delete it so it can't drift from the
      // live game. (merged.instructions is the delete sentinel when this edit cleared it.)
      instructions: merged.instructions ?? admin.firestore.FieldValue.delete(),
      requirement: describeGameRequirements(merged),
      updatedAt: updates.updatedAt,
    }).catch((e) => logBestEffort('publicGames.resync', { gameId }, e));
  }

  return { ok: true };
});


// ─── Game trash: soft delete · restore · permanent purge ──────────────────────
//
// THE INCIDENT (change: recoverable-game-deletion): deleteGame used to end in
// `db.recursiveDelete(ref)`, which destroys the game document AND every run, team,
// feed item, feedback response and location-track document beneath it. A creator
// clicked Delete on a game card and a real game with a finished run, a team and
// its whole history ceased to exist. There was no soft delete, no undo, no audit
// record — and no accessCodes cleanup, so the run's join code stayed behind
// pointing at nothing (a participant typing it hit a dangling reference).
//
// Deletion is now a TOMBSTONE. Destruction happens only after the grace period or
// on an explicit, separate request, and lives in exactly one function
// (purgeGameTree) shared by all three destruction entry points.

/** Remove the game's public gallery index (doc + its task rows). Idempotent. */
async function removeGalleryIndex(gameId: string): Promise<void> {
  await db.doc(`publicGames/${gameId}`).delete().catch((e) => logBestEffort('publicGames.delete', { gameId }, e));
  // Chunked: a large game can have >500 public tasks, past the per-batch cap.
  const publicTasksSnap = await db.collection('publicTasks')
    .where('sourceGameId', '==', gameId).get();
  await deleteDocsInChunks(publicTasksSnap.docs.map((d) => d.ref));
}

/** Every access code pointing at a run of this game. Needs the ownerUid+gameId index. */
async function gameAccessCodes(ownerUid: string, gameId: string) {
  const snap = await db.collection('accessCodes')
    .where('ownerUid', '==', ownerUid)
    .where('gameId', '==', gameId)
    .get();
  return snap.docs;
}

/**
 * PERMANENT destruction. The old deleteGame body, plus the accessCodes cleanup it
 * was missing. Only ever reached from purgeGameNow (owner, explicit) or the
 * scheduled sweep (grace period elapsed) — never from a single creator click.
 */
export async function purgeGameTree(ownerUid: string, gameId: string, operatorId: string): Promise<void> {
  const ref = db.doc(gamePath(ownerUid, gameId));
  const snap = await ref.get();
  if (!snap.exists) return; // already gone — purge is idempotent
  const game = snap.data() as Game;

  await removeGalleryIndex(gameId);

  // Purge uploaded photos for every run of this game BEFORE the Firestore tree
  // (which holds the runIds) goes away — otherwise they orphan in Storage.
  const runsSnap = await db.collection(`${gamePath(ownerUid, gameId)}/runs`).get();
  await deleteRunsPhotos(runsSnap.docs.map((d) => d.id));
  // Creator-authored task media (gameMedia/{uid}/games/{gameId}/…) would
  // otherwise orphan in Storage forever once the game doc is gone.
  await deleteGameMedia(ownerUid, gameId);

  // THE ORPHAN BUG: the original deleteGame never touched accessCodes, so a code
  // survived its destroyed game and a participant entering it hit a dangling
  // reference. deleteMyAccount always did this; deleteGame now does too.
  const codes = await gameAccessCodes(ownerUid, gameId);
  await deleteDocsInChunks(codes.map((d) => d.ref))
    .catch((e) => logBestEffort('accessCodes.purge', { ownerUid, gameId }, e));

  await db.recursiveDelete(ref);

  await auditBestEffort({
    operatorId, actionType: AUDIT_GAME_PURGED, gameId,
    gameTitle: game.title, reason: 'permanent destruction after soft delete',
  });
}


// ─── deleteGame (SOFT) ────────────────────────────────────────────────────────

export const deleteGame = loggedCallable('deleteGame', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = data as { gameId: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  // Loads + owner check + refuses a game that is ALREADY in the trash, so a
  // second delete is not-found and can never overwrite the original deletedAt
  // (which would silently restart the grace-period clock).
  const game = await loadOwnedLiveGame(uid, gameId);
  const ref = db.doc(gamePath(uid, gameId));

  // A run that is not finished is participants physically standing in a street
  // holding phones. The old code deleted it out from under them. Refuse outright
  // rather than soft-delete: every play/staff path reaches the run THROUGH this
  // game doc, so a "deleted" game with a live run is an incoherent state.
  const runsSnap = await db.collection(`${gamePath(uid, gameId)}/runs`).get();
  const liveRun = runsSnap.docs
    .map((d) => d.data() as Run)
    .find((r) => r.status !== 'finished');
  if (liveRun) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `This game has a run in progress (code ${liveRun.accessCode}). Finalize it before deleting the game.`,
    );
  }

  const now = new Date().toISOString();

  // Unconditional (not only when visibility === 'public'): a stale gallery row
  // from an earlier publish must not outlive the game either.
  await removeGalleryIndex(gameId);

  // Revoke, do NOT delete, the join codes. A released code could be handed to a
  // different creator's run by uniqueCode() inside the 30-day window, so restore
  // would return a game whose shared links are dead or point somewhere else.
  // 'revoked' is an already-supported AccessCodeStatus that getJoinInfo / joinRun
  // already refuse with a clear message — the honest answer the dangling code
  // never gave. Stamped with THIS deletion so restore reinstates only these.
  const codes = await gameAccessCodes(uid, gameId);
  if (codes.length > 0) {
    const batch = db.batch();
    for (const d of codes) {
      const c = d.data() as AccessCode;
      if (c.status === 'revoked') continue; // already revoked for another reason — leave it alone
      batch.update(d.ref, {
        status: 'revoked',
        revokedByGameDeletionAt: now,
        revokedFromStatus: c.status,
      });
    }
    await batch.commit().catch((e) => logBestEffort('accessCodes.revoke', { gameId }, e));
  }

  // The tombstone itself. Nothing beneath the game is touched — that is what
  // makes restore complete.
  await ref.update({ deletedAt: now, deletedBy: uid, updatedAt: now });

  await auditBestEffort({
    operatorId: uid, actionType: AUDIT_GAME_DELETED, gameId,
    gameTitle: game.title, newValue: now,
    reason: `soft delete, recoverable for ${GAME_TRASH_RETENTION_DAYS} days`,
  });

  return { ok: true, deletedAt: now, purgeDueAt: gamePurgeDueAt(now) };
});


// ─── listDeletedGames ─────────────────────────────────────────────────────────
// The "recently deleted" view. Same query shape as listGames, opposite filter.

export const listDeletedGames = loggedCallable('listDeletedGames', async (_data, context) => {
  const uid = requireAuth(context);
  const snap = await db.collection(gamesCol(uid))
    .orderBy('updatedAt', 'desc')
    .limit(200)
    .get();
  const games = deletedGames(snap.docs.map((d) => d.data() as Game)).map((g) => ({
    ...g,
    // Derived, never stored: a persisted purge date would go stale the moment the
    // retention constant changed.
    purgeDueAt: gamePurgeDueAt(g.deletedAt),
  }));
  return { games, retentionDays: GAME_TRASH_RETENTION_DAYS };
});


// ─── restoreGame ──────────────────────────────────────────────────────────────

export const restoreGame = loggedCallable('restoreGame', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = data as { gameId: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const ref = db.doc(gamePath(uid, gameId));
  const snap = await ref.get();
  // Purged (or never existed) — the console tells the creator it is gone for good
  // rather than promising a recovery it cannot deliver.
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = snap.data() as Game;
  if (game.ownerUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your game');

  // Idempotent: restoring a game that is not in the trash (a double click, two
  // open tabs) is a no-op success, never an error the creator has to interpret.
  if (!isGameDeleted(game)) return { ok: true, alreadyRestored: true };

  const tombstone = game.deletedAt!;
  const now = new Date().toISOString();

  await ref.update({
    deletedAt: admin.firestore.FieldValue.delete(),
    deletedBy: admin.firestore.FieldValue.delete(),
    // Deliberately NOT re-published: re-indexing into the public gallery must go
    // back through publishGame, which re-runs the structural winnability guard.
    visibility: 'private',
    updatedAt: now,
  });

  // Reinstate ONLY the codes this deletion revoked. A code the owner revoked for
  // an unrelated reason carries no revokedByGameDeletionAt and stays revoked.
  const codes = await gameAccessCodes(uid, gameId);
  const mine = codes.filter((d) => (d.data() as AccessCode).revokedByGameDeletionAt === tombstone);
  if (mine.length > 0) {
    const batch = db.batch();
    for (const d of mine) {
      const c = d.data() as AccessCode;
      batch.update(d.ref, {
        status: c.revokedFromStatus ?? 'unused',
        revokedByGameDeletionAt: admin.firestore.FieldValue.delete(),
        revokedFromStatus: admin.firestore.FieldValue.delete(),
      });
    }
    await batch.commit().catch((e) => logBestEffort('accessCodes.unrevoke', { gameId }, e));
  }

  await auditBestEffort({
    operatorId: uid, actionType: AUDIT_GAME_RESTORED, gameId,
    gameTitle: game.title, previousValue: tombstone,
    reason: 'restored from trash',
  });

  return { ok: true, restoredCodes: mine.length };
});


// ─── purgeGameNow (owner: "delete permanently") ───────────────────────────────

export const purgeGameNow = loggedCallable('purgeGameNow', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = data as { gameId: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  // Requires an existing tombstone (failed-precondition otherwise) so this can
  // never be used as a one-call hard delete — the exact defect being fixed.
  await loadOwnedTrashedGame(uid, gameId);
  await purgeGameTree(uid, gameId, uid);
  return { ok: true };
});


// ─── duplicateGame ────────────────────────────────────────────────────────────

export const duplicateGame = loggedCallable('duplicateGame', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, sourceOwnerUid } = data as { gameId: string; sourceOwnerUid?: string };

  // Can duplicate own private games OR any public game by any creator
  const ownerUid = sourceOwnerUid ?? uid;
  const sourceRef = db.doc(gamePath(ownerUid, gameId));
  const sourceSnap = await sourceRef.get();

  if (!sourceSnap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const sourceGame = sourceSnap.data() as Game;
  // A trashed game cannot be duplicated by anyone, including its owner
  // (change: recoverable-game-deletion) — a copy would resurrect content the
  // creator asked to delete, and would survive the purge of the original.
  assertGameNotDeleted(sourceGame);

  // Enforce: can only copy public games from other creators
  if (ownerUid !== uid && sourceGame.visibility !== 'public') {
    throw new functions.https.HttpsError('permission-denied', 'Game is not public');
  }

  const now = new Date().toISOString();
  const newRef = db.collection(gamesCol(uid)).doc();
  // SECURITY: never carry the source owner's private Slack/Teams webhook secret into
  // the copy (esp. when duplicating ANOTHER creator's public game). Also reset
  // marketplace opt-in so a copy isn't silently exposed. (change: chat-integrations /
  // marketplace-instant-play).
  const { integrationWebhookUrl: _wh, integrationPlatform: _wp, ...safeSource } = sourceGame;
  const copy: Game = {
    ...safeSource,
    id: newRef.id,
    ownerUid: uid,
    title: `${sourceGame.title} (copy)`,
    visibility: 'private',
    allowInstantPlay: false,
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await newRef.set(copy);

  // Increment original's playCount (best-effort). The PUBLIC bump goes through
  // bumpPublicSignals so the gallery's ranking score is recomputed with the
  // counter, never after it (change: gallery-popularity-ranking).
  if (ownerUid !== uid) {
    sourceRef.update({ playCount: admin.firestore.FieldValue.increment(1) }).catch((e) => logBestEffort('game.playCount.increment', { gameId }, e));
    bumpPublicSignals('game', gameId, { uses: 1 }).catch((e) => logBestEffort('publicGames.playCount.increment', { gameId }, e));
  }

  return { gameId: newRef.id };
});


// ─── publishGame ─────────────────────────────────────────────────────────────
// Toggles game visibility and syncs/removes the publicGames + publicTasks index.

export const publishGame = loggedCallable('publishGame', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, visibility } = data as { gameId: string; visibility: 'public' | 'private' };

  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');
  if (visibility !== 'public' && visibility !== 'private') {
    throw new functions.https.HttpsError('invalid-argument', 'visibility must be "public" or "private"');
  }

  const ref = db.doc(gamePath(uid, gameId));
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  if ((snap.data() as Game).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }

  const game = snap.data() as Game;
  // A trashed game can never be (re-)listed in the public gallery
  // (change: recoverable-game-deletion).
  assertGameNotDeleted(game);
  const now = new Date().toISOString();

  if (visibility === 'public') {
    // Winnability guard (wave-j J2): publishing indexes the game into the public
    // gallery where it can be duplicated and (with allowInstantPlay) played from a
    // "Play now" link — so an empty game, a 0-task stage, an uncompletable task, or a
    // negative-value task would pollute the gallery and dead-end a first-time player.
    // Run the SAME structural guard launchRun runs, BEFORE indexing. failed-precondition
    // matches launchRun's sibling style.
    if (game.stages.length === 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Game has no stages — add at least one stage before publishing');
    }
    const problems = gameStructureProblems(game.stages);
    if (problems.length > 0) {
      throw new functions.https.HttpsError('failed-precondition', problems.join(' · '));
    }
    // Compute summary stats
    const allTasks = game.stages.flatMap((s) => s.tasks);
    const estimatedTotalMinutes = sumEstimatedMinutes(allTasks);

    // Get creator display name
    const creatorSnap = await admin.auth().getUser(uid).catch((e) => { logBestEffort('auth.getUser', { uid }, e); return null; });
    const ownerDisplayName = creatorSnap?.displayName ?? undefined;

    // Re-publish must PRESERVE accumulated ranking signals (change:
    // gallery-popularity-ranking). This path `set`s the gallery documents whole,
    // so before this fix editing-and-republishing a game silently reset every
    // task's copyCount to 0 — and would have wiped every like too. Read what is
    // already there and carry the counters forward.
    const priorGameSnap = await db.doc(FIRESTORE_PATHS.publicGame(gameId)).get()
      .catch((e) => { logBestEffort('publicGames.readPrior', { gameId }, e); return null; });
    const priorGame = (priorGameSnap?.data() ?? {}) as Partial<PublicGame>;
    const priorTasksSnap = await db.collection('publicTasks')
      .where('sourceGameId', '==', gameId).get()
      .catch((e) => { logBestEffort('publicTasks.readPrior', { gameId }, e); return null; });
    const priorTasks = new Map<string, Partial<PublicTask>>(
      (priorTasksSnap?.docs ?? []).map((d) => [d.id, d.data() as Partial<PublicTask>]),
    );

    const publicGame: PublicGame = {
      id: gameId,
      ownerUid: uid,
      ownerDisplayName,
      title: game.title,
      description: game.description,
      mode: game.mode,
      scoringPreset: game.scoringPreset,
      // Normalized on the way into the WORLD-READABLE collection (change:
      // game-task-tags), so a game whose tags were stored before the server guard
      // existed is cleaned by its next publish instead of serving forever.
      tags: normalizeTags(game.tags),
      coverImage: game.coverImage,
      // An authored area wins verbatim; otherwise derive one from this game's own
      // publicly-locatable tasks so the gallery map is not blank for every game
      // nobody hand-placed (change: surface-invisible-fields). Undefined is dropped
      // by ignoreUndefinedProperties, so a game with nothing to say says nothing.
      approxLocation: resolveGameArea(game.approxLocation, game.stages),
      playCount: game.playCount,
      stageCount: game.stages.length,
      taskCount: allTasks.length,
      estimatedTotalMinutes,
      // Marketplace instant play (marketplace-instant-play): surfaced so the public
      // promo can show a "Play now" entry point. Never carries the webhook secret.
      allowInstantPlay: game.allowInstantPlay ?? false,
      // Accurate GPS requirement derived from task trigger modes at publish time,
      // so the welcome screen never trusts free-text "no GPS" claims in copy.
      requirement: describeGameRequirements(game),
      // Ranking signals survive a re-publish; the score is recomputed from them
      // below so the stored ordering field can never lag its own counters.
      likeCount: priorGame.likeCount ?? 0,
      createdAt: game.createdAt,
      updatedAt: now,
    };
    publicGame.popularity = scoreFor('game', publicGame);

    const batch = db.batch();
    batch.set(db.doc(`publicGames/${gameId}`), publicGame);

    // Index each task individually for the task library
    for (const task of allTasks) {
      const publicTaskId = `${gameId}_${task.id}`;
      const publicTaskRef = db.doc(FIRESTORE_PATHS.publicTask(publicTaskId));
      const prior = priorTasks.get(publicTaskId) ?? {};
      // Location contract (change: task-library-map-view): publicTasks is
      // world-readable, so it gets a coarse ~1 km AREA and never the authored
      // point — and a locationless / unplaced task gets NOTHING. A hidden-location
      // task gets the same area as any other (change: hidden-location-map-
      // visibility); the player-facing secrecy is enforced by the participant
      // sanitizer, not by this projection.
      // The rule is applied here, at the write, because a renderer-side
      // filter protects only readers who use our renderer. The deprecated
      // `coordinates` key is deliberately not written at all, so re-publishing
      // also erases it from a document written by the old code.
      const approxLocation = publicTaskLocation(task);
      const publicTask: PublicTask = {
        id: publicTaskId,
        sourceGameId: gameId,
        sourceGameTitle: game.title,
        ownerUid: uid,
        ownerDisplayName,
        title: task.title,
        description: task.description,
        type: task.type,
        ...(approxLocation ? { approxLocation } : {}),
        difficulty: task.difficulty,
        estimatedMinutes: task.estimatedMinutes,
        pointValue: task.pointValue,
        tags: normalizeTags(task.tags),
        // Preserved across a re-publish, along with createdAt — the newness term
        // of the score must date from FIRST publication, otherwise re-publishing
        // would be a way to permanently refresh your own ranking.
        copyCount: prior.copyCount ?? 0,
        likeCount: prior.likeCount ?? 0,
        createdAt: prior.createdAt ?? now,
      };
      publicTask.popularity = scoreFor('task', publicTask);
      batch.set(publicTaskRef, publicTask);
    }
    await batch.commit();
  } else {
    // Remove from public index
    const batch = db.batch();
    batch.delete(db.doc(`publicGames/${gameId}`));
    const publicTasksSnap = await db.collection('publicTasks')
      .where('sourceGameId', '==', gameId).get();
    for (const d of publicTasksSnap.docs) batch.delete(d.ref);
    await batch.commit();
  }

  await ref.update({ visibility, updatedAt: now });
  return { ok: true, visibility };
});


// ─── getGame ──────────────────────────────────────────────────────────────────

export const getGame = loggedCallable('getGame', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = data as { gameId: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const snap = await db.doc(gamePath(uid, gameId)).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = snap.data() as Game;
  if (game.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }
  // A game in the trash reads as gone (change: recoverable-game-deletion).
  assertGameNotDeleted(game);
  return { game };
});


// ─── listGames ────────────────────────────────────────────────────────────────

export const listGames = loggedCallable('listGames', async (_data, context) => {
  const uid = requireAuth(context);
  const snap = await db.collection(gamesCol(uid))
    .orderBy('updatedAt', 'desc')
    .limit(200) // bound the read — a creator's game list is not unbounded in the UI
    .get();
  // Trashed games are filtered IN MEMORY, not in the query: Firestore's
  // `where('deletedAt','==',null)` does NOT match documents that lack the field,
  // so a server-side filter would require backfilling `deletedAt: null` onto
  // every existing game. Absence of the field stays the normal state.
  const games = visibleGames(snap.docs.map((d) => d.data() as Game));
  return { games };
});


// ─── checkChallengeAnswer ─────────────────────────────────────────────────────
// Public, non-scoring "challenge a friend" teaser check. Resolves the owner from
// the published publicGames index (so ONLY published games are challengeable —
// an unpublished game has no publicGames doc), loads the secret task, and returns
// ONLY { correct }. The answer key never leaves the server. No auth required —
// this is an external acquisition surface for brand-new (signed-out) viewers.
export const checkChallengeAnswer = loggedCallable('checkChallengeAnswer', async (data) => {
  const { gameId, taskId, answer } = (data ?? {}) as {
    gameId?: string; taskId?: string; answer?: string;
  };
  if (!gameId || !taskId) {
    throw new functions.https.HttpsError('invalid-argument', 'gameId and taskId required');
  }

  // Published gate: only games indexed in publicGames can be challenged.
  const pubSnap = await db.doc(`publicGames/${gameId}`).get();
  if (!pubSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Challenge not available');
  }
  const ownerUid = (pubSnap.data() as PublicGame).ownerUid;

  const gameSnap = await db.doc(gamePath(ownerUid, gameId)).get();
  if (!gameSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Challenge not available');
  }
  const game = gameSnap.data() as Game;
  // Defense in depth (change: recoverable-game-deletion): soft-delete already
  // removes the publicGames row above, but a stale index row must never keep a
  // trashed game's answer key checkable from an unauthenticated surface.
  if (isGameDeleted(game)) {
    throw new functions.https.HttpsError('not-found', 'Challenge not available');
  }
  const task = game.stages.flatMap((s) => s.tasks).find((t) => t.id === taskId);
  if (!task) {
    throw new functions.https.HttpsError('not-found', 'Task not found');
  }

  return { correct: matchesTaskAnswer(task, String(answer ?? '')) };
});


// ─── translateGame (duplicate-translate-game) ─────────────────────────────────
// Duplicates an owner's game and machine-translates its user-facing text into a
// target language, preserving coordinates / types / scoring verbatim. Free-text
// answers are translated but the ORIGINAL is kept as an accepted alias so the
// translated game still accepts the original answer.
//
// Real translation requires TRANSLATE_API_KEY (server-only, functions/.env). When
// absent (dev / emulator), a deterministic mock prefixes each string with the
// target language tag so the pipeline + e2e are exercised without an external call.
async function translateTexts(texts: string[], lang: string): Promise<string[]> {
  // TODO(billing/infra): call the real translation API when TRANSLATE_API_KEY is
  // configured. Until then the mock makes translation observable + deterministic.
  return texts.map((t) => `[${lang}] ${t}`);
}

export const translateGame = loggedCallable('translateGame', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId, targetLang } = data as { gameId: string; targetLang: string };
  if (!gameId || !targetLang?.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'gameId and targetLang required');
  }
  if (targetLang.trim().length > 16) {
    throw new functions.https.HttpsError('invalid-argument', 'targetLang is not a valid language code');
  }

  const snap = await db.doc(gamePath(uid, gameId)).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = snap.data() as Game;
  if (game.ownerUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your game');
  // A trashed game cannot be translated into a fresh copy
  // (change: recoverable-game-deletion) — same reasoning as duplicateGame.
  assertGameNotDeleted(game);

  const lang = targetLang.trim();

  // Translate display text via collect → translate → re-inject.
  const fields = collectTranslatableFields(game);
  const translatedText = await translateTexts(fields.map((f) => f.text), lang);
  const map: Record<string, string> = {};
  fields.forEach((f, i) => { map[f.path] = translatedText[i]; });
  const newGame = applyTranslations(game, map);

  // Translate free-text answers but keep the originals as accepted aliases.
  for (const stage of newGame.stages ?? []) {
    for (const task of stage.tasks ?? []) {
      if (Array.isArray(task.answers) && task.answers.length > 0) {
        const ta = await translateTexts(task.answers, lang);
        task.answers = Array.from(new Set([...task.answers, ...ta]));
      }
    }
  }

  const now = new Date().toISOString();
  const newRef = db.collection(gamesCol(uid)).doc();
  // SECURITY (wave-j J7): mirror duplicateGame — never carry the source's private
  // Slack/Teams webhook secret into the copy, and reset marketplace opt-in so a
  // translated copy isn't silently instant-playable/published. (Own-game-only today,
  // but keeps translateGame consistent with duplicateGame's security posture.)
  const { integrationWebhookUrl: _wh, integrationPlatform: _wp, ...safeNewGame } = newGame;
  const copy: Game = {
    ...safeNewGame,
    id: newRef.id,
    ownerUid: uid,
    visibility: 'private',
    allowInstantPlay: false,
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await newRef.set(copy);
  return { gameId: newRef.id, targetLang: lang };
});


// ─── exportGameFile / importGameFile (change: game-file-export-import) ─────────
//
// THE INCIDENT: a creator's real game was destroyed and could not be recovered,
// because it existed in exactly ONE place and the creator had no copy of their
// own. Trash/restore and platform backups all live on infrastructure the creator
// neither controls nor can inspect. These two callables give the creator a FILE.
//
// ⚠️ SECURITY — the exported document CONTAINS server-secret material (quiz
// `answers`, the authored `orderItems` order, `numericAnswer`, `steps[].answer`,
// the paid `hint` text, `smart.secretCode`, and the real coordinates of
// `hideLocation` tasks). That is deliberate: an export without the answer keys
// restores an UNPLAYABLE game. It therefore may only ever be produced for the
// authenticated OWNER of that game:
//   • there is NO `sourceOwnerUid` parameter (unlike duplicateGame) and NO
//     public-game path — publishing exposes the sanitized publicTasks projection,
//     never the answer key, so a published game is not exportable by strangers;
//   • a trashed game reads as not-found, exactly like getGame;
//   • nothing here is reachable from a participant/staff callable, and no part of
//     the document is copied into publicGames / publicTasks / any run document.

export const exportGameFile = loggedCallable('exportGameFile', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = (data ?? {}) as { gameId?: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const snap = await db.doc(gamePath(uid, gameId)).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  const game = snap.data() as Game;
  if (game.ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }
  assertGameNotDeleted(game);

  return { file: serializeGameToFile(game) };
});


export const importGameFile = loggedCallable('importGameFile', async (data, context) => {
  const uid = requireAuth(context);
  const { file } = (data ?? {}) as { file?: unknown };

  // Layer 1+2 — envelope (format · schema version · size caps) and shape. Pure,
  // never throws, and returns NO game unless every check passed, so a malformed
  // file can never leave half a game behind.
  const { game: parsed, errors } = parseGameFile(file);
  if (errors.length > 0 || !parsed) {
    throw new functions.https.HttpsError('invalid-argument', errors.join(' · ') || 'Invalid game file');
  }

  // Layer 3 — the SAME semantic guards updateGame runs, from the same helper, so
  // an imported game can never be accepted on terms an authored one would not be.
  const stages = (parsed.stages ?? []) as Stage[];
  const problems = stagesProblems(stages);
  if (problems.length > 0) {
    throw new functions.https.HttpsError('invalid-argument', problems.join(' · '));
  }

  // Layer 3b — the SAME enforced-settings validators updateGame runs (change:
  // expose-enforced-settings). Without this, the file door was the ONLY way these
  // fields were ever set and the only door that checked nothing: `parsed` is spread
  // wholesale into the new game below, so a hand-edited file could write a NaN centre
  // or a negative radius straight onto the field `updateLocation` and the routing
  // soft-pause read. Same helper, same terms, no drift between the two doors.
  const importedZone = validateSafeZone(parsed.safeZone);
  if (!importedZone.ok) throw new functions.https.HttpsError('invalid-argument', importedZone.error);
  const importedFlag = validateConsentFlag(parsed.requiresGuardianConsent);
  if (!importedFlag.ok) throw new functions.https.HttpsError('invalid-argument', importedFlag.error);
  const importedAge = validateMinAge(parsed.minAge);
  if (!importedAge.ok) throw new functions.https.HttpsError('invalid-argument', importedAge.error);
  // A guardian-consent requirement is REFUSED at this door, not stripped, because
  // arming it produces a game nobody can play: `startTeams` holds every team until a
  // consent record exists, `startInstantPlay` refuses outright, and no participant
  // surface calls `requestGuardianConsent`/`grantGuardianConsent`, so there is no way
  // to create that record. Importing the flag would hand a creator a run that cannot
  // start, with no action available to anyone. This is a MECHANISM guard on an
  // unsatisfiable state, not a decision about what consent should mean or require —
  // that is a product decision, and this message is what escalates it.
  if (parsed.requiresGuardianConsent === true) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'This file requires guardian consent, which cannot be collected yet: teams on such a game can never be started. Remove requiresGuardianConsent from the file to import it.',
    );
  }

  // Layer 4 — the same normalizers/trust boundaries: display-char stripping on
  // authored titles/descriptions, and the task-media origin gate (a media
  // reference whose Storage object is gone is dropped here rather than persisted
  // as a dead pointer). Both return NEW arrays — never dotted-update an array
  // element, it coerces the array to a map.
  // The imported game's own tags are unioned into every task (feature:
  // game-tags-propagate), using the SAME normalized list the game will store below.
  const importedTags = normalizeTags(parsed.tags);
  const safeStages = normalizeStagesMedia(sanitizeStagesText(stages, importedTags)) ?? [];
  const instructions = parsed.instructions ? cleanGameInstructions(parsed.instructions) : undefined;

  const now = new Date().toISOString();
  const ref = db.collection(gamesCol(uid)).doc();

  // Server-owned identity is assigned HERE, never honoured from the file: an
  // `ownerUid` in a document must not be an account-transfer primitive, and
  // `visibility` may only ever change through publishGame (which re-runs the
  // structural winnability guard before indexing into the public gallery).
  const game: Game = {
    ...(parsed as Partial<Game>),
    id: ref.id,
    ownerUid: uid,
    title: stripUnsafeDisplayChars(parsed.title).trim(),
    stages: safeStages,
    scoringPreset: parsed.scoringPreset ?? DEFAULT_SCORING_PRESET,
    registrationFields: parsed.registrationFields ?? DEFAULT_REGISTRATION_FIELDS,
    mode: parsed.mode ?? 'individual',
    // A creator's own game file is still client-supplied bytes (change: game-task-tags).
    tags: normalizeTags(parsed.tags),
    visibility: 'private',
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (instructions) game.instructions = instructions; else delete game.instructions;
  // Store the NORMALIZED boundary (centre + radius only), never the file's object —
  // the spread above would otherwise carry any extra key straight onto a field the
  // safety path reads.
  if (importedZone.value) game.safeZone = importedZone.value; else delete game.safeZone;

  // ONE write. Deliberately not createGame + updateGame (two writes, which can
  // strand an empty game if the second fails) — and deliberately a fresh document
  // rather than an overwrite: an overwrite's failure mode is losing a game, which
  // is the exact thing this change exists to prevent.
  await ref.set(game);

  return { gameId: ref.id, stageCount: safeStages.length };
});

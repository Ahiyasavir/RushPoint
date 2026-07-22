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
  validateAvailabilityWindow,
  validateOrderItems,
  validateSurveyChoices,
  sumEstimatedMinutes,
  gameStructureProblems,
  stripUnsafeDisplayChars,
  cleanGameInstructions,
} from '@rushpoint/shared';
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
function sanitizeStagesText(stages: Stage[] | undefined): Stage[] | undefined {
  if (!Array.isArray(stages)) return stages;
  const clean = (s: string | undefined): string | undefined =>
    s === undefined ? undefined : stripUnsafeDisplayChars(s);
  return stages.map((stage) => ({
    ...stage,
    title: clean(stage.title) ?? stage.title,
    tasks: (stage.tasks ?? []).map((task) => ({
      ...task,
      title: clean(task.title) ?? task.title,
      ...(task.description !== undefined ? { description: clean(task.description) } : {}),
    })),
  }));
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
    tags,
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
    const problems: string[] = [];
    // Structural winnability (wave-j J2/J3/J4): empty-task stage + uncompletable
    // task + negative pointValue/difficulty/estimatedMinutes — the same rule
    // launchRun enforces at launch, applied at save so a broken shape never persists
    // and never reaches publishGame / the gallery. Shared SOURCE with publishGame.
    problems.push(...gameStructureProblems(stages));
    for (const stage of stages ?? []) {
      problems.push(...validateUnlockGraph(stage).errors);
      for (const task of stage.tasks ?? []) {
        const windowError = validateAvailabilityWindow(task);
        if (windowError) problems.push(`Task "${task.title || task.id}": ${windowError}`);
        // Ordering quiz (change: quiz-ordering): orderItems only on a quiz task,
        // never mixed with choices/typed answers (one grading mode per task), and
        // the item list itself must be valid (3 to 10 non-empty distinct items).
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
        // Survey (change: survey-tasks): surveyChoices, when present, must be a
        // 2–8 non-empty-string list (absent ⇒ a free-text survey).
        if (task.surveyChoices !== undefined) {
          const choiceError = validateSurveyChoices(task.surveyChoices);
          if (choiceError) problems.push(`Task "${task.title || task.id}": ${choiceError}`);
        }
        // Unwinnable-task + negative-value guards live in gameStructureProblems
        // above (shared with publishGame): a quiz with no answer, numeric with no
        // numericAnswer, smart_station with no secretCode, sequence with no steps,
        // an empty-task stage, or a negative pointValue/difficulty are all rejected
        // there so a direct callable (bypassing the Wizard) can't persist them.
      }
    }
    if (problems.length > 0) {
      throw new functions.https.HttpsError('invalid-argument', problems.join(' · '));
    }
    // Strip control / bidi-override / zero-width spoofing chars from every authored
    // title/description (game handled below; stage + task here) before persisting
    // (wave-j J6). Returns a NEW stages array (never dotted-update an array element).
    updates.stages = normalizeStagesMedia(sanitizeStagesText(stages));
  }
  if (scoringPreset !== undefined)      updates.scoringPreset = scoringPreset;
  if (scoringOptions !== undefined)     updates.scoringOptions = scoringOptions;
  if (registrationFields !== undefined) updates.registrationFields = registrationFields;
  if (branding !== undefined)           updates.branding = branding;
  if (tags !== undefined)               updates.tags = tags;
  if (coverImage !== undefined)         updates.coverImage = coverImage;
  if (approxLocation !== undefined)     updates.approxLocation = approxLocation;
  if (requiresGuardianConsent !== undefined) updates.requiresGuardianConsent = requiresGuardianConsent;
  if (minAge !== undefined)             updates.minAge = minAge;
  if (safeZone !== undefined)           updates.safeZone = safeZone ?? undefined;
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
      tags: merged.tags,
      coverImage: merged.coverImage,
      approxLocation: merged.approxLocation,
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


// ─── deleteGame ───────────────────────────────────────────────────────────────

export const deleteGame = loggedCallable('deleteGame', async (data, context) => {
  const uid = requireAuth(context);
  const { gameId } = data as { gameId: string };
  if (!gameId) throw new functions.https.HttpsError('invalid-argument', 'gameId required');

  const ref = db.doc(gamePath(uid, gameId));
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Game not found');
  if ((snap.data() as Game).ownerUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your game');
  }

  // Remove the public index if the game was public
  const game = snap.data() as Game;
  if (game.visibility === 'public') {
    await db.doc(`publicGames/${gameId}`).delete().catch((e) => logBestEffort('publicGames.delete', { gameId }, e));
    // Remove public tasks from this game (chunked: a large game can have >500).
    const publicTasksSnap = await db.collection('publicTasks')
      .where('sourceGameId', '==', gameId).get();
    await deleteDocsInChunks(publicTasksSnap.docs.map((d) => d.ref));
  }

  // Purge uploaded photos for every run of this game, then recursively delete
  // the game and all its subcollections (runs → teams → locations …). A plain
  // doc delete would orphan those subcollections in Firestore.
  const runsSnap = await db.collection(`${gamePath(uid, gameId)}/runs`).get();
  await deleteRunsPhotos(runsSnap.docs.map((d) => d.id));
  // Creator-authored task media (gameMedia/{uid}/games/{gameId}/…) would
  // otherwise orphan in Storage forever once the game doc is gone.
  await deleteGameMedia(uid, gameId);

  await db.recursiveDelete(ref);
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

  // Increment original's playCount (best-effort)
  if (ownerUid !== uid) {
    sourceRef.update({ playCount: admin.firestore.FieldValue.increment(1) }).catch((e) => logBestEffort('game.playCount.increment', { gameId }, e));
    db.doc(`publicGames/${gameId}`).update({ playCount: admin.firestore.FieldValue.increment(1) }).catch((e) => logBestEffort('publicGames.playCount.increment', { gameId }, e));
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

    const publicGame: PublicGame = {
      id: gameId,
      ownerUid: uid,
      ownerDisplayName,
      title: game.title,
      description: game.description,
      mode: game.mode,
      scoringPreset: game.scoringPreset,
      tags: game.tags,
      coverImage: game.coverImage,
      approxLocation: game.approxLocation,
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
      createdAt: game.createdAt,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(db.doc(`publicGames/${gameId}`), publicGame);

    // Index each task individually for the task library
    for (const task of allTasks) {
      const publicTaskRef = db.doc(`publicTasks/${gameId}_${task.id}`);
      const publicTask: PublicTask = {
        id: `${gameId}_${task.id}`,
        sourceGameId: gameId,
        sourceGameTitle: game.title,
        ownerUid: uid,
        ownerDisplayName,
        title: task.title,
        description: task.description,
        type: task.type,
        coordinates: task.coordinates,
        difficulty: task.difficulty,
        estimatedMinutes: task.estimatedMinutes,
        pointValue: task.pointValue,
        tags: task.tags,
        copyCount: 0,
        createdAt: now,
      };
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
  return { game };
});


// ─── listGames ────────────────────────────────────────────────────────────────

export const listGames = loggedCallable('listGames', async (_data, context) => {
  const uid = requireAuth(context);
  const snap = await db.collection(gamesCol(uid))
    .orderBy('updatedAt', 'desc')
    .limit(200) // bound the read — a creator's game list is not unbounded in the UI
    .get();
  const games = snap.docs.map((d) => d.data() as Game);
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

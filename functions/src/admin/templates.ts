// ─── Admin-managed game templates (change: admin-manage-game-templates) ────────
//
// A template is an ORDINARY Game document, owned by whichever admin authored it,
// flagged isTemplate: true. The admin edits it with the same Builder/updateGame
// every creator uses — no parallel data model, no parallel editor. These three
// callables are the only new surface: flag/unflag a game as a template
// (admin-only), list templates for the creator-facing picker (any authenticated
// user, sanitized projection, grouped by language sibling), and instantiate a
// copy of a template into the calling creator's own account.

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { loggedCallable } from '../obs/log';
import { db } from '../firebase';
import { requireAuth, assertAdmin } from '../auth';
import { enforceRateLimit } from '../rateLimitStore';
import { loadOwnedLiveGame } from '../games/lifecycle';
import { cloneTemplateStagesWithMap } from '../lib/cloneTemplateStages';
import { countStagesAndTasks } from '../lib/templateCounts';
import {
  FIRESTORE_PATHS,
  isGameDeleted,
  stripUnsafeDisplayChars,
  templateGroupSiblingMatches,
  remapWizardStepIds,
  pruneWizardSteps,
  DEFAULT_REGISTRATION_FIELDS,
  DEFAULT_SCORING_PRESET,
  // Template personalization (change: guided-new-game-wizard) — the structural
  // rules the wizard's answers produce. Pure and shared, so the client can
  // preview the same outcome the server applies.
  estimatedTeamCount,
  scaleTaskCapacity,
  defaultModeForGroupSize,
  consentSettingsForAge,
  planDurationFit,
  mergePersonalizedTags,
  type PersonalizationStage,
  type Game,
  type ScoringPreset,
  type TemplateGenre,
} from '@rushpoint/shared';

const KNOWN_TEMPLATE_LANGS = new Set(['he', 'en']);
/** The genres the wizard can ask for (change: guided-new-game-wizard). */
const KNOWN_TEMPLATE_GENRES = new Set<string>(['story', 'missions']);

/** Every isTemplate:true, non-tombstoned game across every owner. Small dataset
 *  (dozens, not thousands) — no pagination, matches the publicTasks/gallery
 *  denormalization precedent already used elsewhere in this codebase. */
async function loadAllTemplateGames(): Promise<Game[]> {
  const snap = await db.collectionGroup('games').where('isTemplate', '==', true).get();
  return snap.docs
    .map((d) => d.data() as Game)
    .filter((g) => !isGameDeleted(g));
}



// ─── setGameTemplateFlag ────────────────────────────────────────────────────

export const setGameTemplateFlag = loggedCallable('setGameTemplateFlag', async (data, context) => {
  const adminUid = assertAdmin(context);
  await enforceRateLimit(adminUid, 'setGameTemplateFlag');

  const {
    gameId, isTemplate, templateEmoji, templateOrder, templateGroupKey, templateLang,
    templateGenre,
  } = (data ?? {}) as {
    gameId?: unknown; isTemplate?: unknown; templateEmoji?: unknown;
    templateOrder?: unknown; templateGroupKey?: unknown; templateLang?: unknown;
    templateGenre?: unknown;
  };

  if (typeof gameId !== 'string' || !gameId.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'gameId required');
  }
  if (typeof isTemplate !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'isTemplate (boolean) required');
  }
  if (templateEmoji !== undefined && typeof templateEmoji !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'templateEmoji must be a string');
  }
  if (templateOrder !== undefined && typeof templateOrder !== 'number') {
    throw new functions.https.HttpsError('invalid-argument', 'templateOrder must be a number');
  }
  if (templateGroupKey !== undefined && typeof templateGroupKey !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'templateGroupKey must be a string');
  }
  if (templateLang !== undefined
    && (typeof templateLang !== 'string' || !KNOWN_TEMPLATE_LANGS.has(templateLang))) {
    throw new functions.https.HttpsError('invalid-argument', 'templateLang must be a known language code');
  }
  // A closed union, checked here rather than trusted: an unknown genre would make
  // the wizard silently offer a question no template can answer.
  if (templateGenre !== undefined
    && (typeof templateGenre !== 'string' || !KNOWN_TEMPLATE_GENRES.has(templateGenre))) {
    throw new functions.https.HttpsError('invalid-argument', 'templateGenre must be story or missions');
  }

  // The admin must own the game they're flagging — this is "edit it like a
  // regular game", not a way to hijack another admin's content.
  const game = await loadOwnedLiveGame(adminUid, gameId);

  if (isTemplate && typeof templateGroupKey === 'string' && templateGroupKey.trim()) {
    const siblings = (await loadAllTemplateGames()).filter(
      (g) => g.templateGroupKey === templateGroupKey && g.id !== gameId,
    );
    const ok = templateGroupSiblingMatches(
      { templateGroupKey, templateEmoji: templateEmoji as string | undefined, templateOrder: templateOrder as number | undefined },
      siblings.map((s) => ({ templateEmoji: s.templateEmoji, templateOrder: s.templateOrder })),
    );
    if (!ok) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'templateEmoji/templateOrder must match this template group\'s existing siblings',
      );
    }
  }

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString(), isTemplate };
  if (isTemplate) {
    // Stamp the picker's two counts now, so listGameTemplates never has to load
    // this game's stages to draw one menu row.
    Object.assign(update, countStagesAndTasks(game));
  }
  if (!isTemplate) {
    // Demoting a template clears the picker-only metadata too — a re-flagged
    // game starts as a fresh, ungrouped template rather than inheriting stale
    // sibling links.
    update.templateEmoji = admin.firestore.FieldValue.delete();
    update.templateOrder = admin.firestore.FieldValue.delete();
    update.templateGroupKey = admin.firestore.FieldValue.delete();
    update.templateLang = admin.firestore.FieldValue.delete();
    update.templateGenre = admin.firestore.FieldValue.delete();
  } else {
    if (templateEmoji !== undefined) update.templateEmoji = templateEmoji;
    if (templateOrder !== undefined) update.templateOrder = templateOrder;
    if (templateGroupKey !== undefined) update.templateGroupKey = templateGroupKey;
    if (templateLang !== undefined) update.templateLang = templateLang;
    if (templateGenre !== undefined) update.templateGenre = templateGenre;
  }

  await db.doc(FIRESTORE_PATHS.game(adminUid, gameId)).update(update);
  return { ok: true, gameId, isTemplate };
});

// ─── listAdminTemplates ─────────────────────────────────────────────────────
//
// The admin console's own list of the templates IT can manage. It exists because
// the console used to build this list client-side from `listGames`, which is
// `orderBy('updatedAt','desc').limit(200)` — so once an admin held more than 200
// games, every ordinary edit or import stamped a fresh `updatedAt` on a NON-template
// game and pushed real templates out of that window. They vanished from the
// templates tab while still existing and still being served to creators by
// listGameTemplates (an uncapped collectionGroup query), which reads exactly like
// "editing a game deleted my template". This query asks for what the page actually
// wants — `isTemplate == true`, no cap, no client-side filtering of a truncated list.
//
// Scoped to the CALLER's own games on purpose: every action on that page
// (setGameTemplateFlag, deleteGame, the Builder) is owner-scoped, so listing another
// admin's templates would only render buttons that cannot work.

export const listAdminTemplates = loggedCallable('listAdminTemplates', async (_data, context) => {
  const adminUid = assertAdmin(context);
  await enforceRateLimit(adminUid, 'listAdminTemplates');

  // The indexed query, with an UNINDEXED fallback. `firestore.indexes.json` carries a
  // fieldOverrides entry for games.isTemplate, and a field override REPLACES Firestore's
  // automatic single-field indexing rather than adding to it — so when that entry listed
  // COLLECTION_GROUP alone it silently disabled the ordinary collection index this query
  // had been relying on, and every call answered FAILED_PRECONDITION. The failure was
  // invisible from the outside: the collection-GROUP query behind listGameTemplates kept
  // working, so every creator still saw the templates in the new-game picker while the
  // admin console that manages them showed only a load error and no Edit button.
  // The override now declares both scopes; this fallback means an index-config gap
  // degrades to a slower read of the caller's OWN games (bounded by one admin's
  // collection) instead of taking the only management surface offline.
  let docs;
  try {
    docs = (await db.collection(`users/${adminUid}/games`).where('isTemplate', '==', true).get()).docs;
  } catch (e) {
    if ((e as { code?: unknown }).code !== 9 && (e as { code?: unknown }).code !== 'failed-precondition') throw e;
    functions.logger.warn('[listAdminTemplates] isTemplate query unindexed — falling back to a full scan of the admin own games', { adminUid });
    docs = (await db.collection(`users/${adminUid}/games`).get()).docs
      .filter((d) => (d.data() as Game).isTemplate === true);
  }
  // Tombstones are filtered in memory for the same reason listGames does it:
  // `where('deletedAt','==',null)` does NOT match documents that lack the field.
  const games = docs
    .map((d) => d.data() as Game)
    .filter((g) => !isGameDeleted(g))
    .sort((a, b) => (a.templateOrder ?? Infinity) - (b.templateOrder ?? Infinity));
  return { games };
});

// ─── listGameTemplates ──────────────────────────────────────────────────────

interface TemplateVariant {
  id: string;
  ownerUid: string;
  title: string;
  description?: string;
  mode: Game['mode'];
  scoringPreset: ScoringPreset;
  stageCount: number;
  taskCount: number;
  /** What kind of game this is, when the admin declared one. The wizard maps its
   *  "a story, or missions?" answer onto this (change: guided-new-game-wizard). */
  templateGenre?: TemplateGenre;
}

interface TemplateGroupEntry {
  groupKey: string;
  templateEmoji?: string;
  templateOrder?: number;
  variants: Record<string, TemplateVariant>;
}

function toVariant(game: Game): TemplateVariant {
  // Read the STORED counts; `listGameTemplates` guarantees they are present by
  // this point (it stamps any document that lacked them). The `?? 0` is a floor
  // for a genuinely empty template, never a silent substitute for missing data.
  const counts = storedCounts(game);
  return {
    id: game.id,
    ownerUid: game.ownerUid,
    title: game.title,
    description: game.description,
    mode: game.mode,
    scoringPreset: game.scoringPreset,
    stageCount: counts?.stageCount ?? 0,
    taskCount: counts?.taskCount ?? 0,
    // Only ever the declared value — an absent genre stays absent, so the wizard
    // offers a question only when a template can actually answer it.
    ...(game.templateGenre !== undefined ? { templateGenre: game.templateGenre } : {}),
  };
}

/**
 * The picker's menu, WITHOUT downloading a dozen whole games to draw it.
 *
 * A template document is a complete game — every stage, every mission, every
 * answer key and media url — and a finished one runs to hundreds of kilobytes.
 * The picker shows a title, a description and two counts, so the slowest thing a
 * creator hit before they had even started building was transferring all of that
 * in order to call `.length` on the stage arrays.
 *
 * `select()` asks Firestore for just the small fields, which is only possible
 * because the two counts are STORED on the document (`templateStageCount` /
 * `templateTaskCount`, stamped by every path that writes a template). A template
 * authored before those fields existed simply has no counts yet — the caller
 * falls back to reading those documents in full and stamps them on the way past,
 * so the list self-heals on first use instead of needing a migration.
 *
 * Deliberately NOT a cache: the Firebase runtime is multi-process, so an
 * in-process memo can be invalidated in one worker while another keeps serving
 * the stale menu — which is exactly what the templates scenario caught.
 */
// A Firestore field MASK: a field missing from this list is absent from every
// document the query returns, however faithfully the projection below copies it.
// Adding a field to the picker/wizard payload means adding it HERE TOO —
// `templateGenre` was copied by `toVariant` and still arrived undefined at the
// client until it was listed here, and nothing about that failure was loud.
const TEMPLATE_LIST_FIELDS = [
  'id', 'ownerUid', 'title', 'description', 'mode', 'scoringPreset',
  'templateEmoji', 'templateOrder', 'templateGroupKey', 'templateLang',
  'templateGenre',
  'templateStageCount', 'templateTaskCount', 'deletedAt',
] as const;

/** The counts as stored, or `null` when this document predates them. */
function storedCounts(g: Partial<Game>): { stageCount: number; taskCount: number } | null {
  const stageCount = (g as { templateStageCount?: unknown }).templateStageCount;
  const taskCount = (g as { templateTaskCount?: unknown }).templateTaskCount;
  if (typeof stageCount !== 'number' || typeof taskCount !== 'number') return null;
  if (!Number.isFinite(stageCount) || !Number.isFinite(taskCount)) return null;
  return { stageCount, taskCount };
}

export const listGameTemplates = loggedCallable('listGameTemplates', async (_data, context) => {
  const uid = requireAuth(context);

  // The limiter and the query run CONCURRENTLY (perf: template-picker-latency).
  // They are independent — the limiter's transaction reads a counter document the
  // query never touches — and awaiting them in sequence put a whole Firestore
  // round trip in front of every open of the new-game picker. The limit is still
  // enforced exactly as before: the query's result is thrown away unread if the
  // limiter refuses, and the refusal is what this function returns.
  //
  // `queryPromise` is caught defensively so a query failure that loses the race to
  // a rate-limit rejection cannot surface as an unhandled rejection and take the
  // process down; the same error is rethrown when it IS awaited below.
  const queryPromise = db.collectionGroup('games')
    .where('isTemplate', '==', true)
    .select(...TEMPLATE_LIST_FIELDS)
    .get();
  queryPromise.catch(() => { /* rethrown at the await below */ });

  await enforceRateLimit(uid, 'listGameTemplates');
  const snap = await queryPromise;

  // Tombstones are filtered in memory for the same reason listGames does it:
  // `where('deletedAt','==',null)` does NOT match documents that lack the field.
  const rows = snap.docs
    .map((d) => ({ ref: d.ref, data: d.data() as Partial<Game> }))
    .filter((r) => !isGameDeleted(r.data as Game));

  // Only the documents that have no stored counts are read in full, and each one
  // is stamped as we go, so this shrinks to nothing after the first call.
  const needsCounts = rows.filter((r) => storedCounts(r.data) === null);
  if (needsCounts.length > 0) {
    const full = await db.getAll(...needsCounts.map((r) => r.ref));
    for (const doc of full) {
      const game = doc.data() as Game | undefined;
      if (!game) continue;
      const counts = countStagesAndTasks(game);
      const row = rows.find((r) => r.ref.path === doc.ref.path);
      if (row) Object.assign(row.data, counts);
      // Best-effort: a failed stamp only means the next call recomputes it.
      void doc.ref.update(counts).catch((e) => functions.logger.warn(
        '[listGameTemplates] could not stamp template counts', { path: doc.ref.path, err: String(e) },
      ));
    }
  }

  const games = rows.map((r) => r.data as Game);
  const groups = new Map<string, TemplateGroupEntry>();

  for (const game of games) {
    const groupKey = game.templateGroupKey?.trim() || game.id; // ungrouped ⇒ its own group of one
    const lang = game.templateLang?.trim() || 'he'; // Hebrew is the app default authoring language
    const existing = groups.get(groupKey);
    const variant = toVariant(game);
    if (!existing) {
      groups.set(groupKey, {
        groupKey,
        templateEmoji: game.templateEmoji,
        templateOrder: game.templateOrder,
        variants: { [lang]: variant },
      });
    } else {
      existing.variants[lang] = variant;
      // The MINIMUM templateOrder across a group's siblings is authoritative —
      // setGameTemplateFlag already enforces siblings agree, this is just a
      // defensive tie-break if they ever disagree.
      if (game.templateOrder !== undefined
        && (existing.templateOrder === undefined || game.templateOrder < existing.templateOrder)) {
        existing.templateOrder = game.templateOrder;
        existing.templateEmoji = game.templateEmoji ?? existing.templateEmoji;
      }
    }
  }

  const templates = [...groups.values()].sort((a, b) => (a.templateOrder ?? Infinity) - (b.templateOrder ?? Infinity));
  return { templates };
});

// ─── createGameFromTemplate ─────────────────────────────────────────────────

/**
 * The template document, by id.
 *
 * `templateOwnerUid` is a HINT from the picker — `listGameTemplates` already told
 * the client which admin owns each template — and it turns this into a single
 * document read (perf: template-picker-latency). Without it the only way to find a
 * template by id is to download EVERY template game in full (a template is a whole
 * game: every stage, every mission, every media url), which is what stood between
 * pressing Create and the Builder opening.
 *
 * The hint is not trusted for authorization: whatever it points at still has to be
 * a live, isTemplate:true document, and a hint that misses falls back to the scan.
 * The worst a forged uid can do is address a document that fails those checks.
 */
async function loadTemplateById(templateGameId: string, templateOwnerUid?: string): Promise<Game | null> {
  if (typeof templateOwnerUid === 'string' && templateOwnerUid.trim()) {
    const snap = await db.doc(FIRESTORE_PATHS.game(templateOwnerUid, templateGameId)).get();
    const game = snap.exists ? (snap.data() as Game) : null;
    if (game && game.isTemplate === true && !isGameDeleted(game)) return game;
  }
  return (await loadAllTemplateGames()).find((g) => g.id === templateGameId) ?? null;
}

export const createGameFromTemplate = loggedCallable('createGameFromTemplate', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'createGameFromTemplate');

  const {
    templateGameId, title, scoringPreset, templateOwnerUid,
    description, tags, personalize,
  } = (data ?? {}) as {
    templateGameId?: unknown; title?: unknown; scoringPreset?: unknown; templateOwnerUid?: unknown;
    // Personalization (change: guided-new-game-wizard). All OPTIONAL, so the
    // plain picker call is byte-for-byte what it always was.
    description?: unknown; tags?: unknown;
    personalize?: { groupSize?: unknown; durationMinutes?: unknown; minAge?: unknown };
  };
  if (typeof templateGameId !== 'string' || !templateGameId.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'templateGameId required');
  }
  if (typeof title !== 'string' || !title.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'title required');
  }

  // Cross-owner read is DELIBERATE here (unlike every other game callable): a
  // template belongs to whichever admin authored it, not the calling creator.
  const template = await loadTemplateById(
    templateGameId,
    typeof templateOwnerUid === 'string' ? templateOwnerUid : undefined,
  );
  if (!template) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown or non-template templateGameId');
  }

  // The id map is what keeps the template's הקמה מהירה steps pointing at THIS copy
  // (change: quick-setup-wizard) — every stage and task was just re-idded, so steps
  // carried over verbatim would resolve to nothing and the whole quick setup would
  // vanish silently.
  const { stages: clonedStages, idMap } = cloneTemplateStagesWithMap(template.stages ?? []);
  const clonedWizardSteps = pruneWizardSteps(
    remapWizardStepIds(template.wizardSteps ?? [], idMap),
    clonedStages,
  );
  // ─── Personalization (change: guided-new-game-wizard) ─────────────────────
  // Applied HERE, inside the single atomic set(), rather than by a follow-up
  // updateGame from the client: a two-step write whose second half fails leaves a
  // half-personalized game in the creator's dashboard, which is exactly the
  // orphan class this callable was made atomic to avoid.
  //
  // The split of responsibilities is deliberate. Everything LANGUAGE-BEARING —
  // the blended description and the derived tag words — is composed client-side,
  // where the i18n dictionaries live, and arrives as finished strings. Everything
  // STRUCTURAL is decided here by the shared pure rules, so the server never has
  // to know what language the creator is working in.
  const groupSize = personalize?.groupSize;
  const durationMinutes = personalize?.durationMinutes;
  const teamCount = typeof groupSize === 'number' ? estimatedTeamCount(groupSize) : 0;

  const fit = planDurationFit(clonedStages as PersonalizationStage[], durationMinutes);
  const personalizedStages = clonedStages.map((stage) => {
    const override = fit.overrides[stage.id];
    const tasks = teamCount > 0
      ? (stage.tasks ?? []).map((t) => ({
        ...t,
        maxConcurrentTeams: scaleTaskCapacity(t.maxConcurrentTeams, teamCount),
      }))
      : stage.tasks;
    return {
      ...stage,
      tasks,
      ...(override !== undefined ? { requiredTaskCount: override } : {}),
    };
  });

  // Only ever produces `requiresGuardianConsent: true` — never `false`, which
  // would let an answered age silently switch OFF a template author's own safety
  // setting. See consentSettingsForAge.
  const consent = consentSettingsForAge(personalize?.minAge);
  const personalizedMode = typeof groupSize === 'number'
    ? defaultModeForGroupSize(groupSize, template.mode)
    : template.mode;
  const personalizedDescription = typeof description === 'string' && description.trim()
    ? stripUnsafeDisplayChars(description).trim()
    : template.description;

  const now = new Date().toISOString();
  const ref = db.collection(`users/${uid}/games`).doc();
  // An explicit ALLOW-LIST, never a spread of `template`. A spread would make
  // every future template field inherit silently — including the next template
  // MARKER someone adds, which would put a creator's private copy in every other
  // creator's picker. Fields absent from this list are absent from the copy on
  // purpose; fields listed here used to be dropped and silently cost the story
  // template its unit-name registration field, its operator instructions and the
  // manualLeaderboardReveal that holds the standings back for its plot twist.
  const newGame: Game = {
    id: ref.id,
    ownerUid: uid,
    title: stripUnsafeDisplayChars(title).trim(),
    description: personalizedDescription,
    mode: personalizedMode,
    stages: personalizedStages,
    scoringPreset: (typeof scoringPreset === 'string' ? scoringPreset : template.scoringPreset) as ScoringPreset
      ?? DEFAULT_SCORING_PRESET,
    registrationFields: Array.isArray(template.registrationFields) && template.registrationFields.length > 0
      ? template.registrationFields
      : DEFAULT_REGISTRATION_FIELDS,
    visibility: 'private',
    tags: mergePersonalizedTags(template.tags, tags),
    playCount: 0,
    ...(template.scoringOptions !== undefined ? { scoringOptions: template.scoringOptions } : {}),
    ...(template.instructions !== undefined ? { instructions: template.instructions } : {}),
    ...(template.allowInstantPlay !== undefined ? { allowInstantPlay: template.allowInstantPlay } : {}),
    ...(template.powerUpsEnabled !== undefined ? { powerUpsEnabled: template.powerUpsEnabled } : {}),
    ...(template.manualLeaderboardReveal !== undefined
      ? { manualLeaderboardReveal: template.manualLeaderboardReveal } : {}),
    // The template's own minor settings are the floor; an answered age can only
    // add to them, never clear them.
    ...(template.minAge !== undefined ? { minAge: template.minAge } : {}),
    ...(template.requiresGuardianConsent !== undefined
      ? { requiresGuardianConsent: template.requiresGuardianConsent } : {}),
    ...consent,
    ...(clonedWizardSteps.length > 0 ? { wizardSteps: clonedWizardSteps } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(newGame);
  // The estimate is reported rather than hidden: the client cannot compute it
  // (listGameTemplates' projection carries counts, not stages), so this is the
  // only honest source for "this may run longer than you asked".
  return {
    gameId: ref.id,
    estimatedMinutes: fit.estimatedMinutes,
    fitsRequestedDuration: fit.fits,
  };
});

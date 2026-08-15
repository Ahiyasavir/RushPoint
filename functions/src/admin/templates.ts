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
import { cloneTemplateStages } from '../lib/cloneTemplateStages';
import {
  FIRESTORE_PATHS,
  isGameDeleted,
  stripUnsafeDisplayChars,
  templateGroupSiblingMatches,
  DEFAULT_REGISTRATION_FIELDS,
  DEFAULT_SCORING_PRESET,
  type Game,
  type ScoringPreset,
} from '@rushpoint/shared';

const KNOWN_TEMPLATE_LANGS = new Set(['he', 'en']);

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
  } = (data ?? {}) as {
    gameId?: unknown; isTemplate?: unknown; templateEmoji?: unknown;
    templateOrder?: unknown; templateGroupKey?: unknown; templateLang?: unknown;
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
  if (!isTemplate) {
    // Demoting a template clears the picker-only metadata too — a re-flagged
    // game starts as a fresh, ungrouped template rather than inheriting stale
    // sibling links.
    update.templateEmoji = admin.firestore.FieldValue.delete();
    update.templateOrder = admin.firestore.FieldValue.delete();
    update.templateGroupKey = admin.firestore.FieldValue.delete();
    update.templateLang = admin.firestore.FieldValue.delete();
  } else {
    if (templateEmoji !== undefined) update.templateEmoji = templateEmoji;
    if (templateOrder !== undefined) update.templateOrder = templateOrder;
    if (templateGroupKey !== undefined) update.templateGroupKey = templateGroupKey;
    if (templateLang !== undefined) update.templateLang = templateLang;
  }

  await db.doc(FIRESTORE_PATHS.game(adminUid, gameId)).update(update);
  return { ok: true, gameId, isTemplate };
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
}

interface TemplateGroupEntry {
  groupKey: string;
  templateEmoji?: string;
  templateOrder?: number;
  variants: Record<string, TemplateVariant>;
}

function toVariant(game: Game): TemplateVariant {
  const stages = game.stages ?? [];
  return {
    id: game.id,
    ownerUid: game.ownerUid,
    title: game.title,
    description: game.description,
    mode: game.mode,
    scoringPreset: game.scoringPreset,
    stageCount: stages.length,
    taskCount: stages.reduce((sum, s) => sum + (s.tasks?.length ?? 0), 0),
  };
}

export const listGameTemplates = loggedCallable('listGameTemplates', async (_data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'listGameTemplates');

  const games = await loadAllTemplateGames();
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

export const createGameFromTemplate = loggedCallable('createGameFromTemplate', async (data, context) => {
  const uid = requireAuth(context);
  await enforceRateLimit(uid, 'createGameFromTemplate');

  const { templateGameId, title, scoringPreset } = (data ?? {}) as {
    templateGameId?: unknown; title?: unknown; scoringPreset?: unknown;
  };
  if (typeof templateGameId !== 'string' || !templateGameId.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'templateGameId required');
  }
  if (typeof title !== 'string' || !title.trim()) {
    throw new functions.https.HttpsError('invalid-argument', 'title required');
  }

  // Cross-owner read is DELIBERATE here (unlike every other game callable): a
  // template belongs to whichever admin authored it, not the calling creator.
  // collectionGroup can't filter by document id directly, so fetch every
  // template doc (small dataset — see loadAllTemplateGames) and match by id.
  const template = (await loadAllTemplateGames()).find((g) => g.id === templateGameId);
  if (!template) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown or non-template templateGameId');
  }

  const clonedStages = cloneTemplateStages(template.stages ?? []);
  const now = new Date().toISOString();
  const ref = db.collection(`users/${uid}/games`).doc();
  const newGame: Game = {
    id: ref.id,
    ownerUid: uid,
    title: stripUnsafeDisplayChars(title).trim(),
    description: template.description,
    mode: template.mode,
    stages: clonedStages,
    scoringPreset: (typeof scoringPreset === 'string' ? scoringPreset : template.scoringPreset) as ScoringPreset
      ?? DEFAULT_SCORING_PRESET,
    registrationFields: DEFAULT_REGISTRATION_FIELDS,
    visibility: 'private',
    tags: [],
    playCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(newGame);
  return { gameId: ref.id };
});

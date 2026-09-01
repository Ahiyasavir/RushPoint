// Admin edits to the smart-build mission bank (change: admin-editable-mission-bank).
//
// ─── What this collection is, and what it deliberately is NOT ────────────────
//
// The bank itself — 89 missions, their tags, their `build()` factories, and the
// 40-rule authoring doctrine that governs them — stays in
// `apps/creator-web/src/taskBank.ts`. This collection carries ONLY the deltas an
// admin has made from the console: one `missionBankOverrides/{key}` document per
// mission that has been edited or deleted, absent for every mission still at its
// authored content. So a fresh project reads zero documents here, and the cost of
// the feature is proportional to how much has actually been changed.
//
// The merge is CLIENT-side (`apps/creator-web/src/lib/missionBankOverlay.ts`),
// because the composer is: `SmartBuildWizard` and `DashboardPage` build a game in
// the browser without a round trip. That is why these callables move rows and not
// missions — the server has no copy of the bank to merge into.
//
// ─── Why the two mutations are audit-logged ──────────────────────────────────
//
// They change what EVERY creator on the platform is offered by "compose one for
// me". That is a platform-wide content change made by one person outside any
// review, and "who changed this mission, when, and from what" is not answerable
// from the resulting document alone — the previous value is gone once it is
// overwritten. Both are declared in PRIVILEGED_CALLABLES
// (scripts/lib/callableHardening.mjs) for exactly that reason.

import * as functions from 'firebase-functions';
import { loggedCallable } from '../obs/log';
import { db } from '../firebase';
import { assertAdmin } from '../auth';
import { enforceRateLimit } from '../rateLimitStore';
import { auditBestEffort } from '../obs/audit';

/** Mirrors FIRESTORE_PATHS' shape of naming; the collection is flat and top-level. */
const OVERRIDES_COL = 'missionBankOverrides';

export const AUDIT_BANK_ENTRY_EDITED = 'mission_bank_entry_edited';
export const AUDIT_BANK_ENTRY_RESET  = 'mission_bank_entry_reset';

/**
 * The stored row. Kept structurally identical to `MissionBankOverride` in
 * creator-web's overlay module — the merge there is the only consumer, and a
 * field the server invents that the merge does not read would be dead data that
 * looks alive in the console.
 */
interface StoredOverride {
  key: string;
  deleted?: boolean;
  title?: string;
  description?: string;
  tags?: string[];
  difficulty?: number;
  minAge?: number | null;
  transitMinutes?: number | null;
  /** Curation bookkeeping — the words have been read. Never affects the merge. */
  reviewedCopy?: boolean;
  /** Curation bookkeeping — the whole mission, Quick Setup included, was stood up. */
  verifiedSetup?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

/** A document id must be a usable, non-path key. */
function assertKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'key required');
  }
  const key = value.trim();
  // A slash would address a subcollection rather than a document, and the bank's
  // own keys never contain one.
  if (!key || key.length > 200 || key.includes('/')) {
    throw new functions.https.HttpsError('invalid-argument', 'invalid mission key');
  }
  return key;
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

// ─── listMissionBankOverrides ───────────────────────────────────────────────
//
// Admin only, and unfiltered: this is the admin's own editing view of a
// collection that is otherwise read straight from the client by the composer.
// Nothing here is secret — it is the same content every creator can already be
// handed — so the gate is about who may see the EDITING surface, not about
// concealment.
export const listMissionBankOverrides = loggedCallable('listMissionBankOverrides', async (_data, context) => {
  const adminUid = assertAdmin(context);
  await enforceRateLimit(adminUid, 'listMissionBankOverrides');

  const snap = await db.collection(OVERRIDES_COL).get();
  const overrides = snap.docs.map((d) => ({ ...(d.data() as StoredOverride), key: d.id }));
  return { overrides };
});

// ─── setMissionBankOverride ─────────────────────────────────────────────────
//
// Edit a mission, or mark it deleted. One call carries the WHOLE edited state of
// that mission, not a partial patch: the admin page always sends every editable
// field, so "the admin cleared the age limit" and "the admin did not touch the
// age limit" stay distinguishable — the first arrives as an explicit `null`, the
// second as an absent key. The callable transport collapses `undefined` to
// `null` on the wire (see CLAUDE.md), which is exactly why the meaning of `null`
// has to be pinned down here rather than inferred.
export const setMissionBankOverride = loggedCallable('setMissionBankOverride', async (data, context) => {
  const adminUid = assertAdmin(context);
  await enforceRateLimit(adminUid, 'setMissionBankOverride');

  const body = (data ?? {}) as Record<string, unknown>;
  const key = assertKey(body.key);

  const patch: StoredOverride = { key, updatedBy: adminUid, updatedAt: new Date().toISOString() };

  if (body.deleted === true) patch.deleted = true;

  const title = text(body.title, 200);
  if (title !== undefined) patch.title = title;

  const description = text(body.description, 4000);
  if (description !== undefined) patch.description = description;

  if (Array.isArray(body.tags)) {
    // Membership in the closed BankTagId vocabulary is checked by the merge, which
    // owns that registry; the server bounds the SIZE and shape so a malformed
    // array cannot become an unbounded document.
    const tags = body.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 40);
    if (tags.length > 0) patch.tags = tags;
  }

  if (typeof body.difficulty === 'number' && Number.isInteger(body.difficulty)
      && body.difficulty >= 1 && body.difficulty <= 10) {
    patch.difficulty = body.difficulty;
  }

  // Only `true` is stored: an untick is the absence of the field, so a row never
  // survives just to say "nobody has looked at this yet", which is the default.
  for (const flag of ['reviewedCopy', 'verifiedSetup'] as const) {
    if (body[flag] === true) patch[flag] = true;
  }

  for (const field of ['minAge', 'transitMinutes'] as const) {
    const v = body[field];
    if (v === null) patch[field] = null;
    else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) patch[field] = v;
  }

  // A row has to SAY something. `key` plus the two timestamps is not an edit and
  // not a curation note — it would be a document that marks a mission as touched
  // while carrying no statement about it at all.
  const meaningful = [
    'deleted', 'title', 'description', 'tags', 'difficulty', 'minAge', 'transitMinutes',
    // A row that ONLY records "I have read this one" is meaningful: it is the
    // whole point of being able to resume a curation pass over 103 missions.
    'reviewedCopy', 'verifiedSetup',
  ].some((f) => f in patch);
  if (!meaningful) {
    throw new functions.https.HttpsError('invalid-argument', 'nothing to store for this mission');
  }

  // Not a merge: this IS the whole edited state of that mission, so a field the
  // admin cleared has to disappear from the document rather than survive from the
  // previous write.
  const ref = db.doc(`${OVERRIDES_COL}/${key}`);
  const before = (await ref.get().catch(() => null))?.data() as StoredOverride | undefined;
  await ref.set(patch);

  await auditBestEffort({
    operatorId: adminUid,
    actionType: AUDIT_BANK_ENTRY_EDITED,
    missionKey: key,
    deleted: patch.deleted === true,
    previousValue: before ? JSON.stringify(before).slice(0, 1500) : null,
    newValue: JSON.stringify(patch).slice(0, 1500),
  });

  return { ok: true, key, override: patch };
});

// ─── clearMissionBankOverride ───────────────────────────────────────────────
//
// Reset one mission to its authored content by deleting its override row. This is
// the reason the overlay design was chosen over migrating the bank into
// Firestore: the source content is still in the repo, so "put it back the way it
// was" is one deletion rather than a restore from a backup nobody took.
export const clearMissionBankOverride = loggedCallable('clearMissionBankOverride', async (data, context) => {
  const adminUid = assertAdmin(context);
  await enforceRateLimit(adminUid, 'clearMissionBankOverride');

  const key = assertKey((data ?? {} as Record<string, unknown>).key);
  const ref = db.doc(`${OVERRIDES_COL}/${key}`);
  const before = (await ref.get().catch(() => null))?.data() as StoredOverride | undefined;
  // Clearing an override that is already absent is a no-op, not an error: two
  // admins pressing reset is not a conflict.
  await ref.delete().catch(() => { /* already gone */ });

  await auditBestEffort({
    operatorId: adminUid,
    actionType: AUDIT_BANK_ENTRY_RESET,
    missionKey: key,
    previousValue: before ? JSON.stringify(before).slice(0, 1500) : null,
    newValue: null,
  });

  return { ok: true, key, cleared: before !== undefined };
});

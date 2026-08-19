// הקמה מהירה / Quick Setup — the shared, framework-free half
// (change: quick-setup-wizard).
//
// A template used to carry its SETUP INSTRUCTION inside the very field the
// instruction is about:
//
//   description: "[הערת מפעיל - למחוק]: הגדירו את המיקום בשלב 1 וצרפו תמונה תקריב…"
//   answers:     ["(ערכו את התשובה) / (edit this answer)"]
//
// which fails three ways at once: a player reads "delete this paragraph" mid-race,
// the instruction cannot take the creator to the control it names, and a template
// placeholder is a perfectly VALID answer key so `computeGameReadiness` launches a
// half-configured game without a word.
//
// This module makes the instruction a first-class pointer instead. A
// `TemplateWizardStep` says WHICH field it is about; the prose in the game stays
// strictly player-facing.
//
// Three rules run through everything here:
//   • IDENTITY OVER POSITION — a step resolves by stage/task id when it has one, so
//     reordering stages cannot silently re-point it at a different mission.
//   • FAIL OPEN — an unresolvable step is INERT (not shown, not counted, not
//     launch-blocking) and nothing here throws. A stale pointer must never be able
//     to wedge the Builder or lock a creator out of launching.
//   • ONE MARKER LIST — stripping, detection and extraction read the same exported
//     patterns, so a marker cannot be recognised in one place and missed in another.
//
// No React, no Firebase, no `window`: pinned by scripts/test-template-wizard.ts.
import type { Game, Stage, Task, GameInstructions } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// 1. The step
// ═══════════════════════════════════════════════════════════════════════════

export interface TemplateWizardStep {
  /** Stable and unique within the game. */
  id: string;
  /** '' means a game-level step (the title, the primer). */
  stageId: string;
  /** '' means a game- or stage-level step. */
  taskId: string;
  /** `description`, `smart.autoApprove`, or the absolute `stages[0].tasks[1].media`. */
  targetFieldPath: string;
  /** Creator-facing, authored CONTENT (never a dictionary key) — rendered dir="auto". */
  instructionPrompt: string;
  /** Blocks the launch while the target field is unconfigured. */
  isRequired: boolean;
}

export type WizardTargetScope = 'game' | 'stage' | 'task';

export interface WizardTarget {
  scope: WizardTargetScope;
  stageId: string;
  taskId: string;
  stageIndex: number;   // -1 for a game-level target
  taskIndex: number;    // -1 for a game- or stage-level target
  /** The path RELATIVE to the resolved object, e.g. `coordinates` or `smart.autoApprove`. */
  fieldPath: string;
}

/** Just enough of a game to point into, so callers and tests stay light. */
type PointableGame = Pick<Game, 'stages'> & Partial<Pick<Game, 'title' | 'description' | 'instructions' | 'wizardSteps'>>;

// ═══════════════════════════════════════════════════════════════════════════
// 2. Path parsing and resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `stages[1].tasks[0].smart.autoApprove` → ['stages','1','tasks','0','smart','autoApprove'].
 *
 * Total: anything it cannot make sense of yields `[]`, which every caller reads as
 * "unresolvable" rather than as an error.
 */
export function parseFieldPath(path: string | undefined | null): string[] {
  if (typeof path !== 'string') return [];
  const trimmed = path.trim();
  if (trimmed === '') return [];
  const out: string[] = [];
  for (const rawPart of trimmed.split('.')) {
    const part = rawPart.trim();
    if (part === '') return [];
    // name[0][2] → name, 0, 2
    const match = /^([A-Za-z_$][\w$]*)((?:\[\d+\])*)$/.exec(part);
    if (!match) return [];
    out.push(match[1]);
    for (const idx of match[2].match(/\d+/g) ?? []) out.push(idx);
  }
  return out;
}

function stageIndexOf(stages: Stage[], stageId: string): number {
  if (!stageId) return -1;
  return stages.findIndex((s) => s?.id === stageId);
}
function taskIndexOf(stage: Stage | undefined, taskId: string): number {
  if (!stage || !taskId) return -1;
  return (stage.tasks ?? []).findIndex((t) => t?.id === taskId);
}

/**
 * Where does this step point, and does that place still exist?
 *
 * `null` means INERT — the mission was deleted, the index is out of range, or the
 * path is malformed. Callers drop it rather than rendering a dead step.
 */
export function resolveWizardTarget(
  game: PointableGame | undefined | null,
  step: TemplateWizardStep | undefined | null,
): WizardTarget | null {
  if (!game || !step) return null;
  const stages: Stage[] = Array.isArray(game.stages) ? game.stages : [];
  const segments = parseFieldPath(step.targetFieldPath);
  if (segments.length === 0) return null;

  const declaredStageId = typeof step.stageId === 'string' ? step.stageId.trim() : '';
  const declaredTaskId = typeof step.taskId === 'string' ? step.taskId.trim() : '';

  // An ABSOLUTE path carries its own indexes. They are only ever the fallback:
  // when the step also names ids, the ids win (see IDENTITY OVER POSITION).
  let rest = segments;
  let pathStageIndex = -1;
  let pathTaskIndex = -1;
  if (segments[0] === 'stages') {
    const si = Number(segments[1]);
    if (!Number.isInteger(si)) return null;
    pathStageIndex = si;
    rest = segments.slice(2);
    if (rest[0] === 'tasks') {
      const ti = Number(rest[1]);
      if (!Number.isInteger(ti)) return null;
      pathTaskIndex = ti;
      rest = rest.slice(2);
    }
    if (rest.length === 0) return null; // points at a stage/task, not at a FIELD
  }

  const wantsStage = declaredStageId !== '' || pathStageIndex >= 0;
  const wantsTask = declaredTaskId !== '' || pathTaskIndex >= 0;
  const fieldPath = rest.join('.');
  if (fieldPath === '') return null;

  if (!wantsStage) {
    return { scope: 'game', stageId: '', taskId: '', stageIndex: -1, taskIndex: -1, fieldPath };
  }

  const stageIndex = declaredStageId ? stageIndexOf(stages, declaredStageId) : pathStageIndex;
  const stage = stages[stageIndex];
  if (!stage) return null;

  if (!wantsTask) {
    return { scope: 'stage', stageId: stage.id, taskId: '', stageIndex, taskIndex: -1, fieldPath };
  }

  const taskIndex = declaredTaskId ? taskIndexOf(stage, declaredTaskId) : pathTaskIndex;
  const task = (stage.tasks ?? [])[taskIndex];
  if (!task) return null;

  return { scope: 'task', stageId: stage.id, taskId: task.id, stageIndex, taskIndex, fieldPath };
}

/** The object a target's `fieldPath` is relative to. */
function baseObjectFor(game: PointableGame, target: WizardTarget): unknown {
  if (target.scope === 'game') return game;
  const stage = (game.stages ?? [])[target.stageIndex];
  if (!stage) return undefined;
  if (target.scope === 'stage') return stage;
  return (stage.tasks ?? [])[target.taskIndex];
}

/** Walk a dotted/indexed path. `undefined` for anything it cannot reach — never a throw. */
export function readWizardFieldValue(
  game: PointableGame | undefined | null,
  step: TemplateWizardStep | undefined | null,
): unknown {
  const target = resolveWizardTarget(game, step);
  if (!target || !game) return undefined;
  let cursor: unknown = baseObjectFor(game, target);
  for (const key of parseFieldPath(target.fieldPath)) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. "Configured" — the ONE predicate the badge, the flow and the guard share
// ═══════════════════════════════════════════════════════════════════════════

/** The "not placed" sentinel every unplaced task carries. */
function isNullIsland(v: unknown): boolean {
  if (!v || typeof v !== 'object') return true;
  const { lat, lng } = v as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number') return true;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  return lat === 0 && lng === 0;
}

function entryIsFilled(entry: unknown): boolean {
  if (typeof entry === 'string') return entry.trim() !== '' && !isPlaceholderValue(entry);
  if (entry && typeof entry === 'object') {
    // A sequence step / ordering item: judged by its own text fields.
    return Object.values(entry as Record<string, unknown>).some(entryIsFilled);
  }
  if (typeof entry === 'number') return Number.isFinite(entry);
  return entry !== null && entry !== undefined;
}

/**
 * Is the field this step points at actually filled in by the creator?
 *
 * Derived from the LIVE game every time — never from a stored "done" flag, which
 * would go on claiming a field is finished after the creator emptied it.
 *
 * An unresolvable step reads as configured: it is inert, and inert work must not
 * show up as something the creator still owes (FAIL OPEN).
 */
export function isWizardStepConfigured(
  game: PointableGame | undefined | null,
  step: TemplateWizardStep | undefined | null,
): boolean {
  const target = resolveWizardTarget(game, step);
  if (!target || !game) return true;

  // Location is the one field whose "configured" depends on a SIBLING field: a
  // mission played from anywhere is fully configured with no pin at all.
  if (target.scope === 'task' && target.fieldPath === 'coordinates') {
    const task = baseObjectFor(game, target) as Task | undefined;
    if (!task) return true;
    if (task.locationless === true || task.triggerMode === 'locationless') return true;
    return !isNullIsland(task.coordinates);
  }

  const value = readWizardFieldValue(game, step);
  if (value === undefined || value === null) return false;
  // A boolean has no "unset" state, so a step on one is guidance, never a blocker.
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim() !== '' && !isPlaceholderValue(value);
  if (Array.isArray(value)) return value.length > 0 && value.every(entryIsFilled);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(entryIsFilled);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Order — the recommended path
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The rank of a field WITHIN one mission — five lettered tiers, in the order a
 * creator has to understand a mission before the next tier makes sense.
 *
 * Position alone is not enough to order the flow. Two steps on the same mission
 * used to run in whatever order a template author happened to write them, which
 * routinely opened with *"drop the pin for this mission"* on a mission whose name
 * and purpose the creator had not read yet, or asked for a numeric answer before
 * the riddle that the number answers had even been written. Both are the same
 * failure: a later tier being asked for before the earlier tier it depends on.
 *
 *   a. 10-19  concept    — the name and the one-line summary: what IS this
 *   b. 20-29  details     — the picture, the riddle/clue text: what a PLAYER reads
 *   c. 30-39  location    — where it happens, now that the mission is understood
 *   d. 40-49  verification — how a player's attempt is judged: the answer, the
 *                            code, the steps, whether a submission auto-approves
 *   e. 50-59  advanced    — hints, points, timing, capacity, unlocks, tags
 *
 * `locationClue` sits in tier b, not c: it is the RIDDLE TEXT the player reads
 * ("פצחו את צופן האימוג'י…"), which the creator writes as part of understanding the
 * mission — not the pin itself. Verification comes AFTER location, deliberately:
 * a numeric answer or a secret code is almost always a property of the physical
 * spot ("how many benches are here"), so asking for it before the pin exists is
 * asking the creator to answer a question about a place they have not set yet.
 * `smart.autoApprove` sits in tier d for the same reason — it decides how a
 * submission is VERIFIED, not an optional extra laid on top of that decision.
 *
 * An unranked field sorts after every ranked one instead of ahead of them — a
 * field this table has never heard of is the one thing we cannot claim to have
 * placed correctly, so it goes last rather than interrupting a known-good
 * sequence.
 */
const FIELD_RANK: Readonly<Record<string, number>> = {
  // a. concept
  title: 10,
  description: 11,
  'instructions.title': 12,
  'instructions.bodyHe': 13,
  'instructions.body': 13,

  // b. details — media and the riddle/clue text a PLAYER reads
  media: 20,
  locationClue: 21,

  // c. location — only once the mission is understood
  coordinates: 30,
  geofenceRadiusMeters: 31,
  locationHidden: 32,

  // d. verification — how the attempt is judged, now that "where" is settled
  answers: 40,
  choices: 40,
  numericAnswer: 41,
  numericTolerance: 42,
  surveyChoices: 43,
  steps: 44,
  orderItems: 45,
  'smart.secretCode': 46,
  'smart.captureKind': 47,
  'smart.longInstructions': 48,
  'smart.autoApprove': 49,

  // e. advanced — hints, scoring, timing, capacity, gating, tags
  hint: 50,
  hintPenalty: 51,
  pointValue: 52,
  expectedDurationMinutes: 53,
  difficulty: 54,
  maxConcurrentTeams: 55,
  unlockAfterTaskIds: 56,
  tags: 57,
};

/** Where an unranked field sorts: after everything this module has an opinion about. */
export const UNRANKED_FIELD_RANK = 90;

/** The rank of one resolved field path. Total — an unknown path is simply last. */
export function quickSetupFieldRank(fieldPath: string | undefined | null): number {
  if (typeof fieldPath !== 'string') return UNRANKED_FIELD_RANK;
  return FIELD_RANK[fieldPath.trim()] ?? UNRANKED_FIELD_RANK;
}

/**
 * Game level first, then stage order, then mission order inside the stage, then
 * "explain, then place" WITHIN the mission, then the order the steps were authored
 * in.
 *
 * Sorting by POSITION rather than by the authored array means a template author who
 * appends a step later still gets it in the right place, and two steps on one
 * mission that share a rank keep the order they were written in (the sort is
 * stable).
 *
 * Unresolvable steps are dropped here, which is what keeps every downstream caller
 * (bar, badge, guard) from having to re-check.
 */
export function orderQuickSetupSteps(
  game: PointableGame | undefined | null,
  steps: readonly TemplateWizardStep[] | undefined | null,
): TemplateWizardStep[] {
  if (!game || !Array.isArray(steps)) return [];
  return steps
    .map((step, authored) => ({ step, authored, target: resolveWizardTarget(game, step) }))
    .filter((row): row is { step: TemplateWizardStep; authored: number; target: WizardTarget } => row.target !== null)
    .sort((a, b) => (
      a.target.stageIndex - b.target.stageIndex
      || a.target.taskIndex - b.target.taskIndex
      || quickSetupFieldRank(a.target.fieldPath) - quickSetupFieldRank(b.target.fieldPath)
      || a.authored - b.authored
    ))
    .map((row) => row.step);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Normalization, pruning and remap (the server + copy contract)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate an incoming `wizardSteps` value.
 *
 * `undefined` ⇒ the field was not sent (leave stored steps alone).
 * `null`      ⇒ an explicit clear.
 * `null` RETURN ⇒ malformed; the caller raises invalid-argument.
 *
 * Unknown members are dropped rather than stored, so a client cannot smuggle extra
 * data onto a game document through this field.
 */
export function normalizeWizardSteps(value: unknown): TemplateWizardStep[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value)) return null;

  const out: TemplateWizardStep[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const targetFieldPath = typeof r.targetFieldPath === 'string' ? r.targetFieldPath.trim() : '';
    if (id === '' || targetFieldPath === '') return null;
    if (r.isRequired !== undefined && typeof r.isRequired !== 'boolean') return null;
    if (seen.has(id)) continue; // first one wins; a duplicate id is noise, not a refusal
    seen.add(id);
    out.push({
      id,
      stageId: typeof r.stageId === 'string' ? r.stageId.trim() : '',
      taskId: typeof r.taskId === 'string' ? r.taskId.trim() : '',
      targetFieldPath,
      instructionPrompt: typeof r.instructionPrompt === 'string' ? r.instructionPrompt : '',
      isRequired: r.isRequired === true,
    });
  }
  return out;
}

/**
 * Drop steps whose stage or mission no longer exists.
 *
 * Deliberately a DROP and not a rejection: a creator deleting a mission must not be
 * locked out of autosave by a pointer they never authored (the lesson of
 * builder-clear-optional-field, where one refused optional value froze every save).
 */
export function pruneWizardSteps(
  steps: readonly TemplateWizardStep[] | undefined | null,
  stages: readonly Stage[] | undefined | null,
): TemplateWizardStep[] {
  if (!Array.isArray(steps)) return [];
  const list: Stage[] = Array.isArray(stages) ? (stages as Stage[]) : [];
  return steps.filter((step) => {
    if (!step) return false;
    const stageId = typeof step.stageId === 'string' ? step.stageId.trim() : '';
    const taskId = typeof step.taskId === 'string' ? step.taskId.trim() : '';
    if (stageId === '') return true; // game-level: nothing to dangle
    const stage = list.find((s) => s?.id === stageId);
    if (!stage) return false;
    if (taskId === '') return true;
    return (stage.tasks ?? []).some((t) => t?.id === taskId);
  });
}

/**
 * Rewrite stage/mission references for a COPY of a game (template instantiation,
 * duplicate, translate, import).
 *
 * An id with no mapping is left alone rather than dropped: the copy paths preserve
 * ORDER, so an index-form path still resolves, and dropping a step because one id
 * was unmapped would silently discard a creator instruction.
 */
export function remapWizardStepIds(
  steps: readonly TemplateWizardStep[] | undefined | null,
  idMap: Map<string, string> | Record<string, string> | undefined | null,
): TemplateWizardStep[] {
  if (!Array.isArray(steps)) return [];
  const lookup = (id: string): string => {
    if (!id) return id;
    if (idMap instanceof Map) return idMap.get(id) ?? id;
    if (idMap && typeof idMap === 'object') return (idMap as Record<string, string>)[id] ?? id;
    return id;
  };
  return steps.map((step) => ({
    ...step,
    stageId: lookup(step.stageId ?? ''),
    taskId: lookup(step.taskId ?? ''),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Operator notes — one marker list, three callers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A bracketed note addressed to the creator: `[הערת מפעיל - למחוק]`,
 * `[הוראות למפעיל - למחוק]`, `[operator note - delete]`.
 */
const BRACKET_NOTE = /\[[^\]\n]*(?:מפעיל|ליוצר|operator|organi[sz]er)[^\]\n]*\]\s*[:：-]?\s*/;
/** The same instruction written without brackets, as `הוראות ליוצר: …`. */
const BARE_NOTE = /(?:^|\n)[ \t]*(?:הוראות ליוצר|הערה ליוצר|note to creator)\s*[:：-]\s*/;
/**
 * A bracket that tells the creator to ADAPT rather than delete keeps its body: the
 * game primer is written `[… - למחוק/התאימו לפי הצורך]: <real player-facing primer>`,
 * so removing the note text there would delete the instructions players read.
 */
const ADAPT_HINT = /התאימו|התאם|adapt|edit as needed/;

/** Placeholders authored INSIDE an otherwise player-facing value. */
const INLINE_PLACEHOLDERS: readonly RegExp[] = [
  /\(\s*ערכו את התשובה\s*\)/gi,
  /\(\s*ערכו את המספר\s*\)/gi,
  /\(\s*ערכו את התשובה בעורך\s*\)/gi,
  /\(\s*edit this answer\s*\)/gi,
  /\(\s*edit this number\s*\)/gi,
];

/** Every marker this module knows about, exported so nothing re-derives the list. */
export const OPERATOR_NOTE_MARKERS: readonly RegExp[] = [BRACKET_NOTE, BARE_NOTE, ...INLINE_PLACEHOLDERS];

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[\s/|,–-]+/, '')
    .replace(/[\s/|,–-]+$/, '')
    .trim();
}

/**
 * Vocabulary that marks a sentence as addressed to the CREATOR rather than to a
 * player: it names a Builder control, an authoring action, or the note's own
 * self-destruct.
 *
 * This exists because the boundary is genuinely ambiguous in real data. One real
 * template writes
 *
 *   "[הערת מפעיל - למחוק]: מומלץ מיקום הומה אדם. לאישור ידני, כבו אישור אוטומטי
 *    בביצוע ותוספות. השיגו דף והחתימו עליו 20 אנשים…"
 *
 * where the first two sentences are for the CREATOR and the third is the mission a
 * PLAYER performs, with nothing but the words themselves to tell them apart.
 *
 * Deliberately NOT a list of player-ish verbs (צלמו, נווטו): those appear in BOTH
 * halves, so testing for them would eat the mission. Testing for AUTHORING
 * vocabulary fails toward keeping text — and text kept in error is visible on the
 * screen, while text deleted in error is not.
 */
const OPERATOR_SENTENCE = /למחוק|תמחקו|מחקו|כשתסיימו|לאחר הקריאה|הפסקה הזו|מומלץ|הגדיר|כבו|הכניסו|באפשרויות מתקדמות|אישור אוטומטי|אישור ידני|בביצוע|מיקום|במפה|במערכת|אזור בטיחות|safe zone|תבחר|תשאיר|השאירו|אפשר להוסיף|צרפו|מנהל הריצה|בשלב 1|בשלב הראשון|בעורך|ערכו/i;

/**
 * Where does a note that starts at `from` end?
 *
 * Sentence by sentence. The first sentence after a marker IS the note by
 * construction; each one after it is kept only while it still speaks to the
 * creator. Two boundaries end it early whatever the words say: a blank line, and
 * the concatenation glue templates produce when the player-facing half was
 * appended with no space ("…מחקו את הפסקה הזו.נווטו אל נקודת הסיום").
 *
 * Nothing is destroyed either way: whatever is removed becomes the step's
 * `instructionPrompt`, and the admin action confirms before it writes.
 */
/**
 * The note's own "delete this paragraph" instruction — not anchored to the end
 * of a string like `SELF_DESTRUCT_CLAUSE` (which trims a finished instruction),
 * but findable ANYWHERE, because it is the single most reliable sign-off a
 * template author writes right before pasting or typing the real player text.
 */
const SELF_DESTRUCT_PHRASE =
  /(?:ו?לאחר הקריאה\s*)?(?:תמחקו|מחקו|למחוק)\s*(?:את\s*)?(?:ה?פסקה|ה?הערה)\s*(?:הזו|הזאת|זו)?\s*(?:לאחר הקריאה)?[).]*\s*/g;

function noteEnd(text: string, from: number): number {
  const blank = text.indexOf('\n\n', from);
  const limit = blank >= 0 ? blank : text.length;

  // The self-destruct phrase, wherever it falls, is the AUTHORITATIVE end of the
  // note: a template author writes it as their own sign-off immediately before
  // the real player text, even inside a multi-part structured note ("בחירת
  // מיקום: … קוד סודי: … הגדרות מתקדמות: … מחקו פסקה זו לאחר הקריאה.<player
  // text>") whose earlier sentences don't individually read as authoring prose.
  // Take the LAST occurrence in the window: a note can mention "delete" more
  // than once, and only the final one is the actual close.
  SELF_DESTRUCT_PHRASE.lastIndex = from;
  let destructEnd = -1;
  for (let m = SELF_DESTRUCT_PHRASE.exec(text); m && m.index < limit; m = SELF_DESTRUCT_PHRASE.exec(text)) {
    destructEnd = Math.min(m.index + m[0].length, limit);
  }
  if (destructEnd >= 0) return destructEnd;

  // No self-destruct phrase: fall back to the glue seam — a full stop
  // immediately followed by more text, no space, no capital, is the seam where
  // player-facing prose was pasted directly onto the end of a short note.
  const glue = /[.!?](?=[^\s.!?)\]])/g;
  glue.lastIndex = from;
  const glued = glue.exec(text);
  if (glued && glued.index + 1 <= limit) return glued.index + 1;

  // Neither signal exists: the note runs into unrelated prose with no marker at
  // all, so walk whole sentences while they still read as authoring notes — the
  // genuinely ambiguous case the vocabulary list exists for.
  const sentence = /[^.!?\n]*[.!?]+|[^.!?\n]+/g;
  sentence.lastIndex = from;
  let cursor = from;
  let first = true;
  for (let m = sentence.exec(text); m && m.index < limit; m = sentence.exec(text)) {
    const end = Math.min(m.index + m[0].length, limit);
    if (!first && !OPERATOR_SENTENCE.test(m[0])) break;
    cursor = end;
    first = false;
    if (end >= limit) break;
  }
  return Math.max(cursor, from);
}

/** Every operator note found in a value, in the order they appear. */
export function findOperatorNotes(text: string | undefined | null): string[] {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const found: string[] = [];
  let working = text;
  for (let guard = 0; guard < 8; guard += 1) {
    const bracket = BRACKET_NOTE.exec(working);
    const bare = BARE_NOTE.exec(working);
    const hit = bracket && bare ? (bracket.index <= bare.index ? bracket : bare) : (bracket ?? bare);
    if (!hit) break;
    const start = hit.index;
    const adapt = ADAPT_HINT.test(hit[0]);
    const end = adapt ? start + hit[0].length : noteEnd(working, start + hit[0].length);
    found.push(working.slice(start, end).trim());
    working = working.slice(0, start) + working.slice(end);
  }
  for (const pattern of INLINE_PLACEHOLDERS) {
    const matches = working.match(new RegExp(pattern.source, 'gi'));
    if (matches) found.push(...matches);
  }
  return found;
}

/**
 * The player-facing remainder of a value: its operator notes and inline
 * placeholders removed, whitespace tidied.
 */
export function stripOperatorNotes(text: string | undefined | null): string {
  if (typeof text !== 'string' || text === '') return '';
  let working = text;
  for (let guard = 0; guard < 8; guard += 1) {
    const bracket = BRACKET_NOTE.exec(working);
    const bare = BARE_NOTE.exec(working);
    const hit = bracket && bare ? (bracket.index <= bare.index ? bracket : bare) : (bracket ?? bare);
    if (!hit) break;
    const start = hit.index;
    const adapt = ADAPT_HINT.test(hit[0]);
    const end = adapt ? start + hit[0].length : noteEnd(working, start + hit[0].length);
    working = working.slice(0, start) + working.slice(end);
  }
  for (const pattern of INLINE_PLACEHOLDERS) {
    working = working.replace(new RegExp(pattern.source, 'gi'), '');
  }
  return collapseWhitespace(working);
}

/**
 * Is this value still the template's placeholder rather than something the creator
 * authored?
 *
 * This is what `isWizardStepConfigured` needs and `computeGameReadiness` cannot
 * have: "(ערכו את התשובה)" is a structurally VALID answer key, so nothing else in
 * the product can tell it apart from a real one.
 *
 * A blank value is NOT a placeholder — blankness is judged by the caller, and
 * conflating the two would make an empty optional field read as leftover template.
 */
export function isPlaceholderValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.trim() === '') return false;
  return findOperatorNotes(value).length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Extraction — turn a note-carrying game into a clean one plus steps
// ═══════════════════════════════════════════════════════════════════════════

/** Which field a note is talking about, in the order we prefer to guide them. */
interface Aspect { field: string; test: RegExp; required: boolean }

const ASPECTS: readonly Aspect[] = [
  { field: 'coordinates', test: /מיקום|נקודת|נקודה|מפה|במפה|סיכה|אזור בטיחות|location|map|pin|geofence/, required: true },
  { field: 'media', test: /תמונה|תמונת|צילום|צלמו|צרפו|סרטון|קליפ|photo|image|video|media|attach/, required: true },
  { field: 'answers', test: /תשוב|answer/, required: true },
  { field: 'hint', test: /רמז|hint/, required: false },
  { field: 'smart.autoApprove', test: /אישור אוטומטי|אישור ידני|auto ?approve/, required: false },
];

/**
 * The creator-facing half of a note: its MARKER removed, whitespace tidied.
 *
 * Nobody needs to read "[הערת מפעיל - למחוק]:" in the הקמה מהירה bar — the bar
 * IS the place creator instructions live now, so the label that used to mean
 * "this text is not for players" carries no information there.
 *
 * Empty when the note was ONLY a marker (a bare "[… - התאימו לפי הצורך]:" prefix
 * on otherwise player-facing prose), and extraction then produces no step at all:
 * an instruction with nothing in it cannot guide anyone.
 */
/**
 * A note's own "now delete this paragraph" tail.
 *
 * True while the note sat in the mission text; meaningless the moment extraction
 * moves it into a setup step, where it becomes an instruction to delete something
 * the creator can no longer see. Dropped as a WHOLE clause (and only when other
 * words remain), so a note that is nothing but a self-destruct still yields its
 * text rather than an empty step.
 */
const SELF_DESTRUCT_CLAUSE =
  /[,.;·]?\s*(?:ו?לאחר הקריאה\s*)?(?:תמחקו|מחקו|למחוק)\s*(?:את\s*)?(?:ה?פסקה|ה?הערה)?\s*(?:הזו|הזאת|זו)?\s*(?:לאחר הקריאה)?[\s).]*$/;

export function noteInstruction(note: string): string {
  if (typeof note !== 'string') return '';
  const withoutMarker = collapseWhitespace(
    note.replace(BRACKET_NOTE, '').replace(BARE_NOTE, '').replace(/^[\s:：-]+/, ''),
  );
  const trimmed = collapseWhitespace(withoutMarker.replace(SELF_DESTRUCT_CLAUSE, ''));
  return trimmed === '' ? withoutMarker : trimmed;
}

function slug(text: string): string {
  return text.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'field';
}

/** A stable id, so re-running extraction updates rather than duplicates. */
function stepIdFor(taskId: string, field: string): string {
  return `qs-${taskId || 'game'}-${slug(field)}`;
}

function aspectsOf(
  noteText: string, task: Task | undefined, fallbackField: string = 'description',
): { field: string; required: boolean }[] {
  const hits = ASPECTS
    .filter((a) => a.test.test(noteText))
    .map((a) => {
      // "הגדירו תשובה מספרית" on a numeric task means the number, not the word list.
      if (a.field === 'answers' && task?.type === 'numeric') return { field: 'numericAnswer', required: true };
      if (a.field === 'answers' && task?.type === 'survey') return { field: 'surveyChoices', required: true };
      if (a.field === 'answers' && task?.type === 'sequence') return { field: 'steps', required: true };
      return { field: a.field, required: a.required };
    });
  // A note we cannot classify still deserves to be shown — pointed at the field
  // it actually lives IN (the caller passes that in), so the creator lands on
  // the control they need to edit rather than always being sent to `description`
  // regardless of where the note was written.
  return hits.length > 0 ? hits : [{ field: fallbackField, required: false }];
}

/** The answer-key field a task of this type is completed by, if any. */
function answerFieldOf(task: Task): string | null {
  switch (task.type) {
    case 'quiz': return 'answers';
    case 'numeric': return 'numericAnswer';
    case 'survey': return 'surveyChoices';
    case 'sequence': return 'steps';
    default: return null;
  }
}

export interface QuickSetupExtraction {
  stages: Stage[];
  instructions?: GameInstructions;
  wizardSteps: TemplateWizardStep[];
}

/**
 * Pull every creator instruction OUT of a game's player-facing content.
 *
 * Returns the cleaned stages and primer plus one step per instruction, MERGED over
 * any steps the game already carries (deduplicated by mission + field, with the
 * existing step winning) so the admin action is safe to run twice.
 *
 * Pure: the input game is never mutated.
 */
/**
 * Does this game still carry creator-only notes in its player-facing text?
 *
 * The question a creator's own console needs to ask: a game IMPORTED before
 * extraction existed on the import path still has "[הערת מפעיל - למחוק]…" sitting
 * in mission descriptions, and nothing in the product would ever have told them.
 * This is what lets the Builder offer to clean it up rather than leaving those
 * games stranded on the old behaviour.
 *
 * Total and cheap — a scan of the authored strings, never a throw, so it is safe
 * to call on every render of a game of any size.
 */
export function gameHasOperatorNotes(game: PointableGame | undefined | null): boolean {
  if (!game) return false;
  const instructions = game.instructions;
  if (instructions) {
    if (findOperatorNotes(instructions.bodyHe).length > 0) return true;
    if (findOperatorNotes(instructions.body).length > 0) return true;
  }
  for (const stage of game.stages ?? []) {
    for (const task of stage?.tasks ?? []) {
      if (!task) continue;
      if (findOperatorNotes(task.title).length > 0) return true;
      if (findOperatorNotes(task.description).length > 0) return true;
      if (findOperatorNotes(task.locationClue).length > 0) return true;
      if (findOperatorNotes(task.smart?.longInstructions).length > 0) return true;
      for (const step of task.steps ?? []) {
        if (findOperatorNotes(step?.prompt).length > 0) return true;
      }
    }
  }
  return false;
}

export function extractQuickSetupSteps(game: PointableGame): QuickSetupExtraction {
  const produced: TemplateWizardStep[] = [];
  const add = (stageId: string, taskId: string, field: string, prompt: string, required: boolean): void => {
    const id = stepIdFor(taskId, field);
    if (produced.some((s) => s.id === id)) return;
    const instructionPrompt = noteInstruction(prompt);
    if (instructionPrompt === '') return;
    produced.push({ id, stageId, taskId, targetFieldPath: field, instructionPrompt, isRequired: required });
  };

  // The game primer.
  const instructions = game.instructions;
  let cleanedInstructions = instructions;
  if (instructions) {
    const notes = [...findOperatorNotes(instructions.bodyHe), ...findOperatorNotes(instructions.body)];
    if (notes.length > 0) {
      cleanedInstructions = {
        ...instructions,
        ...(instructions.bodyHe !== undefined ? { bodyHe: stripOperatorNotes(instructions.bodyHe) } : {}),
        ...(instructions.body !== undefined ? { body: stripOperatorNotes(instructions.body) } : {}),
      };
      add('', '', 'instructions.bodyHe', notes.join(' '), false);
    }
  }

  const stages = (game.stages ?? []).map((stage) => ({
    ...stage,
    tasks: (stage.tasks ?? []).map((task) => {
      const next: Task = { ...task };

      // (a) notes written into the prose. `title`/`description` share one pass
      // (a note in either usually classifies to a DIFFERENT field, like
      // coordinates or media, so both fall back to `description`); `locationClue`
      // and `smart.longInstructions` are scanned on their own, because a note
      // embedded THERE is almost always an instruction to fill in that exact
      // field ("[…]: לכו אל [ציון דרך כללי…]"), so an unclassifiable one should
      // fall back to pointing at ITSELF, not at `description`.
      const titleDescNotes = [...findOperatorNotes(task.title), ...findOperatorNotes(task.description)];
      if (findOperatorNotes(task.title).length > 0) next.title = stripOperatorNotes(task.title);
      if (findOperatorNotes(task.description).length > 0) next.description = stripOperatorNotes(task.description);
      for (const note of titleDescNotes) {
        for (const aspect of aspectsOf(note, task, 'description')) {
          add(stage.id, task.id, aspect.field, note, aspect.required);
        }
      }

      const clueNotes = findOperatorNotes(task.locationClue);
      if (clueNotes.length > 0) {
        next.locationClue = stripOperatorNotes(task.locationClue);
        for (const note of clueNotes) {
          for (const aspect of aspectsOf(note, task, 'locationClue')) {
            add(stage.id, task.id, aspect.field, note, aspect.required);
          }
        }
      }

      const longInstrNotes = findOperatorNotes(task.smart?.longInstructions);
      if (longInstrNotes.length > 0 && task.smart) {
        next.smart = { ...task.smart, longInstructions: stripOperatorNotes(task.smart.longInstructions) };
        for (const note of longInstrNotes) {
          for (const aspect of aspectsOf(note, task, 'smart.longInstructions')) {
            add(stage.id, task.id, aspect.field, note, aspect.required);
          }
        }
      }

      // (b) a placeholder sitting in the answer key itself. Cleared rather than
      //     kept: a template must never ship "(ערכו את התשובה)" as a real answer,
      //     because it grades a player's honest answer wrong.
      const answerField = answerFieldOf(task);
      if (answerField === 'answers' && Array.isArray(task.answers) && task.answers.some(isPlaceholderValue)) {
        next.answers = task.answers.filter((a) => !isPlaceholderValue(a));
        add(stage.id, task.id, 'answers', titleDescNotes[0] ?? '', true);
      }
      if (answerField === 'surveyChoices' && Array.isArray(task.surveyChoices) && task.surveyChoices.some(isPlaceholderValue)) {
        next.surveyChoices = task.surveyChoices.filter((c) => !isPlaceholderValue(c));
        add(stage.id, task.id, 'surveyChoices', titleDescNotes[0] ?? '', true);
      }
      if (answerField === 'steps' && Array.isArray(task.steps) && task.steps.some((s) => isPlaceholderValue(s?.answer) || isPlaceholderValue(s?.prompt))) {
        next.steps = task.steps.map((s) => ({
          ...s,
          prompt: stripOperatorNotes(s?.prompt),
          answer: isPlaceholderValue(s?.answer) ? '' : s?.answer,
        }));
        add(stage.id, task.id, 'steps', titleDescNotes[0] ?? '', true);
      }
      return next;
    }),
  }));

  // Existing steps win, so re-running never duplicates and never overwrites an
  // instruction an admin has since reworded.
  const existing = Array.isArray(game.wizardSteps) ? game.wizardSteps : [];
  const key = (s: TemplateWizardStep) => `${s.stageId}|${s.taskId}|${s.targetFieldPath}`;
  const taken = new Set(existing.map(key));
  const wizardSteps = [...existing, ...produced.filter((s) => !taken.has(key(s)))];

  return {
    stages,
    ...(cleanedInstructions !== undefined ? { instructions: cleanedInstructions } : {}),
    wizardSteps,
  };
}

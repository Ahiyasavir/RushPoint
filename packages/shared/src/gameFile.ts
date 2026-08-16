// ═══════════════════════════════════════════════════════════════════════════════
// Creator-owned game portability (change: game-file-export-import).
//
// THE INCIDENT: a creator's real game was destroyed and could not be recovered,
// because it existed in exactly ONE place and the creator had no copy of their
// own. Trash/restore, platform backups and `exportMyData` all live on
// infrastructure the creator neither controls nor can inspect. This module is the
// creator's own copy: a single, versioned, self-contained document that carries
// the COMPLETE authored template of one game, and can be read back into a new,
// immediately launchable game.
//
// Two rules govern everything below.
//   1. LOSSLESS. export → import → export must be byte-stable. A field that
//      quietly fails to round-trip is the same loss as the incident, just slower.
//      The exported key lists are explicit (never a spread of the stored doc) and
//      a drift-guard test fails the moment the model grows a field nobody
//      classified.
//   2. REFUSE, NEVER GUESS. A document this code cannot read faithfully is
//      rejected loudly. Importing an unknown version by ignoring the fields we do
//      not recognise is how a creator loses their work a second time — invisibly,
//      and only discovered on the day they try to launch.
//
// PURE — no Firebase imports. The whole round trip is testable with no emulator,
// and the Builder can pre-validate a chosen file before spending a round trip.
//
// ⚠️ SECURITY: the document produced here CONTAINS server-secret material
// (`answers`, the authored `orderItems` order, `numericAnswer`, `steps[].answer`,
// `hint`, `smart.secretCode`, and the real coordinates of `hideLocation` tasks).
// That is deliberate — an export without the answer keys restores an unplayable
// game. It therefore may ONLY be produced for the authenticated OWNER of the
// game (`exportGameFile` enforces this) and must never be reachable from a
// participant/staff surface or copied into publicGames / publicTasks.
// ═══════════════════════════════════════════════════════════════════════════════

import type { Game, Stage, Task, SmartStationConfig, TaskType } from './types';
import { isValidCoord } from './geo';
import { stripUnsafeDisplayChars } from './validation';
import { validateUnlockGraph } from './gating';
import { validateAvailabilityWindow } from './schedule';
import { validateOrderItems } from './ordering';
import { validateSurveyChoices } from './survey';

// ─── Format identity + version ────────────────────────────────────────────────

/** Fixed identifier. A document without exactly this value is not ours. */
export const GAME_FILE_FORMAT = 'rushpoint.game';

/**
 * The document schema version this build can read and write.
 *
 * BUMP ONLY when an older file can no longer be read faithfully by
 * `parseGameFile` — a rename, a re-typing, or a removal. Adding a new OPTIONAL
 * authored field does NOT bump it: an old file simply lacks the field, which is
 * indistinguishable from the field being unset.
 */
export const CURRENT_GAME_FILE_VERSION = 1;

/** File extension / suffix used by `gameFileFilename`. */
export const GAME_FILE_EXTENSION = '.rushpoint.json';

// ─── Size bounds (checked BEFORE any real parsing work) ───────────────────────
// A hostile or corrupt file must not be able to make the server do unbounded work
// before it fails. 2 MiB sits well under the Firebase callable request limit
// (10 MiB) and comfortably above a 1000-task game with long instructions — and a
// Firestore document is itself hard-capped at 1 MiB, so any game that could be
// AUTHORED is structurally under this bound. Export is therefore never capped.

export const MAX_GAME_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_STAGES = 100;
export const MAX_FILE_TASKS = 1000;
export const MAX_FILE_STRING_LEN = 20_000;

// ─── Graph bounds (change: game-import-hardening) ─────────────────────────────
// The allow-listed `pick()` below guards KEY NAMES at four fixed levels (game ·
// stage · task · smart). It does not look INSIDE a value, so everything nested in
// an allow-listed field — `branding`, `scoringOptions`, `safeZone`, `media`,
// `steps[]`, `answers[]` — used to be cloned straight through to the write. These
// bounds are what the scan below enforces at EVERY depth, on the server, not only
// in the Builder.

/** A legitimate game is game → stages[] → tasks[] → smart/media/steps[] → object
 *  ≈ 7 levels. 32 is generous for authored content and far below the JS stack. */
export const MAX_FILE_DEPTH = 32;

/** The longest legitimate list is `unlockAfterTaskIds`, itself bounded by
 *  MAX_FILE_TASKS. Applies to EVERY array in the document. */
export const MAX_FILE_ARRAY_LEN = 1000;

/**
 * Key names refused wherever they appear, at any depth. REFUSED, not stripped:
 * a document produced by `serializeGameToFile` can never contain one, so its
 * presence means the file was hand-built or tampered with, and this module's
 * rule is REFUSE, NEVER GUESS. (Contrast an unknown ORDINARY field, which is
 * dropped by `pick` — a file written by a newer build may legitimately carry
 * fields this build does not know, and the `schemaVersion` gate is what makes
 * that safe.)
 */
export const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** A hostile file must not be able to make us build a megabyte of error text. */
export const MAX_FILE_PROBLEMS = 25;

// ─── The exported key sets ────────────────────────────────────────────────────
// Explicit, never a spread. Every key of Game / Stage / Task / SmartStationConfig
// must appear in exactly one of these two lists at its level — enforced by the
// drift-guard test in scripts/test-game-file.ts, which is also a TYPE error when
// a field is added and left unclassified.

export const EXPORTED_GAME_KEYS = [
  'title', 'description', 'mode', 'stages', 'scoringPreset', 'scoringOptions',
  'registrationFields', 'branding', 'tags', 'coverImage', 'approxLocation',
  'requiresGuardianConsent', 'minAge', 'safeZone', 'benchmarkOptOut',
  'allowInstantPlay', 'photoFeedEnabled', 'powerUpsEnabled', 'instructions',
  'manualLeaderboardReveal',
] as const satisfies readonly (keyof Game)[];

/**
 * What is deliberately NOT exported, and why:
 *   id, ownerUid, createdAt, updatedAt  — server-owned. Import always lands in the
 *     CALLER's account with a fresh address and the server clock; honouring these
 *     from a file would be an account-transfer primitive and would corrupt the
 *     `orderBy('updatedAt')` ordering of listGames.
 *   visibility                          — changes ONLY through publishGame, which
 *     re-runs the structural winnability guard before indexing into the public
 *     gallery. An import that could set 'public' would be a way past that guard.
 *   playCount                           — run history. A restored game claiming
 *     plays it never had is a lie, and (via publicGames.popularity) a way to
 *     manufacture gallery ranking. duplicateGame already resets it.
 *   deletedAt / deletedBy               — the trash tombstone, written only by
 *     deleteGame; rules reject client writes of these fields outright.
 *   integrationWebhookUrl / integrationPlatform — an owner SECRET (a bearer
 *     credential for a Slack/Teams channel). duplicateGame and translateGame both
 *     already strip it from copies; a file that leaves the machine must not carry it.
 */
export const DELIBERATELY_EXCLUDED_GAME_KEYS = [
  'id', 'ownerUid', 'visibility', 'playCount', 'createdAt', 'updatedAt',
  'deletedAt', 'deletedBy', 'integrationWebhookUrl', 'integrationPlatform',
] as const satisfies readonly (keyof Game)[];

export const EXPORTED_STAGE_KEYS = [
  'id', 'order', 'title', 'tasks', 'isFinal', 'narrative', 'requiredTaskCount',
  'releaseAt', 'releaseAfterMinutes', 'exclusiveGroups',
] as const satisfies readonly (keyof Stage)[];

/** Nothing on a Stage is server-owned or runtime — a stage is pure authorship. */
export const DELIBERATELY_EXCLUDED_STAGE_KEYS: readonly (keyof Stage)[] = [];

export const EXPORTED_TASK_KEYS = [
  'id', 'title', 'description', 'type', 'coordinates', 'difficulty',
  'estimatedMinutes', 'expectedDurationMinutes', 'pointValue', 'maxConcurrentTeams',
  'status', 'maxDurationMinutes', 'smart', 'triggerMode', 'locationless',
  'hideLocation', 'locationClue', 'locationClueHe', 'hint', 'hintPenalty',
  'hintAutoRevealMinutes', 'hintAutoRevealAttempts', 'choices', 'answers',
  'orderItems', 'surveyChoices', 'numericAnswer', 'numericTolerance',
  'geofenceRadiusMeters', 'requirePresence', 'steps', 'media', 'releaseAt',
  'releaseAfterMinutes', 'expiresAfterMinutes', 'unlockAfterTaskIds', 'tags',
  // pause-clock-tasks: pure authorship (the run-side `excludedMs` lives on the
  // team record, not here), so it round trips like any other authored flag.
  'pausesTimer',
] as const satisfies readonly (keyof Task)[];

/** `currentTeamCount` is, in the type's own words, a "runtime counter maintained
 *  per run (not on template)" — live station occupancy. Exporting it would seed a
 *  fresh game with phantom occupancy and starve routing. */
export const DELIBERATELY_EXCLUDED_TASK_KEYS = [
  'currentTeamCount',
] as const satisfies readonly (keyof Task)[];

export const EXPORTED_SMART_KEYS = [
  'enabled', 'verificationType', 'longInstructions', 'longInstructionsHe',
  'extraInfo', 'mediaUrl', 'imageUrl', 'adminNotes', 'timeLimitSeconds', 'canSkip',
  'autoCompleteOnSuccess', 'autoApprove', 'captureKind',
  'videoMinSeconds', 'videoMaxSeconds', 'geofenceRadiusMeters',
  'codeInputLabel', 'hasCode', 'secretCode', 'attemptLimit', 'hintCount',
  'photoReviewRequired', 'allowRetry', 'showIntroScreen', 'showSuccessScreen',
  'showFailureScreen', 'showPendingReviewScreen', 'showHintsOverTime',
] as const satisfies readonly (keyof SmartStationConfig)[];

/** `stationCoords` is, in the type's own words, "injected by assignTask; never
 *  authored" — per-run routing state that happens to live on the config object. */
export const DELIBERATELY_EXCLUDED_SMART_KEYS = [
  'stationCoords',
] as const satisfies readonly (keyof SmartStationConfig)[];

// ─── Document types ───────────────────────────────────────────────────────────

/**
 * The authored subset of a Game carried by an export file: a Game minus the
 * server-owned, runtime and secret fields above. `title` and `stages` stay
 * required — a document without them is not a game.
 */
export type GameFileGame =
  Partial<Omit<Game, (typeof DELIBERATELY_EXCLUDED_GAME_KEYS)[number]>>
  & { title: string; stages: Stage[] };

export interface GameFile {
  /** Always `GAME_FILE_FORMAT`. */
  format: string;
  /** Integer. See `CURRENT_GAME_FILE_VERSION`. */
  schemaVersion: number;
  /** Informational only — deliberately excluded from round-trip comparison. */
  exportedAt: string;
  game: GameFileGame;
}

export interface ParsedGameFile {
  /** The authored template, or null when `errors` is non-empty. Never partial. */
  game: GameFileGame | null;
  /** Human-readable reasons. Empty ⇔ the document was accepted. */
  errors: string[];
}

const TASK_TYPES: readonly TaskType[] = [
  'field', 'smart_station', 'photo', 'self_report', 'quiz', 'numeric', 'geofence',
  'sequence', 'survey',
];

// ─── Internal helpers ─────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copy only the allow-listed keys, dropping `undefined` (absent stays absent). */
function pick(source: Bag, keys: readonly string[]): Bag {
  const out: Bag = {};
  for (const k of keys) {
    const v = source[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** JSON deep clone. Every value we carry is plain JSON by construction. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** UTF-8 byte length without depending on Buffer (this module runs in the browser too). */
function utf8Bytes(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return unescape(encodeURIComponent(s)).length;
}

/**
 * Every graph-level problem in a candidate game, as path-qualified messages
 * (change: game-import-hardening).
 *
 * ITERATIVE BY CONSTRUCTION — an explicit stack, never recursion. A hostile file
 * can nest 40 000 levels deep; the recursive walk this replaced blew the JS stack
 * on exactly that input and threw `RangeError` out of `parseGameFile`, whose
 * contract (and whose Builder-side pre-check) says it never throws.
 *
 * Must run on the RAW candidate, BEFORE `clone()`: clone is a JSON round trip,
 * and JSON turns `NaN` / `±Infinity` into `null` — so cloning first is what
 * silently converted numeric poison (`1e999` in a hand-edited file) into an
 * accepted `null` instead of a refusal.
 *
 * Checks, at every depth: forbidden key name · nesting depth · array length ·
 * finite numbers · string length (the pre-existing cap, message unchanged).
 */
export function scanCandidateGraph(root: unknown): string[] {
  const problems: string[] = [];
  const stack: { value: unknown; path: string; depth: number }[] = [
    { value: root, path: '', depth: 0 },
  ];

  while (stack.length > 0 && problems.length < MAX_FILE_PROBLEMS) {
    const { value, path, depth } = stack.pop()!;
    const label = path || 'the game';

    if (typeof value === 'string') {
      if (value.length > MAX_FILE_STRING_LEN) {
        problems.push(`The field "${path}" is too long. The limit is ${MAX_FILE_STRING_LEN} characters.`);
      }
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        problems.push(`The field "${label}" must be a finite number.`);
      }
      continue;
    }
    if (value === null || typeof value !== 'object') continue;

    if (depth >= MAX_FILE_DEPTH) {
      problems.push(`The file is nested too deeply at "${label}". The limit is ${MAX_FILE_DEPTH} levels.`);
      continue; // do NOT descend — depth is the bound, not a suggestion
    }

    if (Array.isArray(value)) {
      if (value.length > MAX_FILE_ARRAY_LEN) {
        problems.push(`The list "${label}" has ${value.length} items. The limit is ${MAX_FILE_ARRAY_LEN}.`);
        continue;
      }
      for (let i = value.length - 1; i >= 0; i--) {
        stack.push({ value: value[i], path: `${path}[${i}]`, depth: depth + 1 });
      }
      continue;
    }

    // Own keys only — `Object.keys` on a JSON.parse result surfaces a literal
    // "__proto__" data property, which is exactly the key we must catch.
    for (const key of Object.keys(value as Bag)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (FORBIDDEN_KEYS.includes(key)) {
        problems.push(`The field "${childPath}" is not allowed.`);
        continue;
      }
      stack.push({
        value: (value as Bag)[key],
        path: childPath,
        depth: depth + 1,
      });
    }
  }

  if (problems.length >= MAX_FILE_PROBLEMS) {
    problems.push('…and more problems. Fix these first.');
  }
  return problems;
}

// ─── Field-type tables (change: game-import-hardening) ────────────────────────
// Declarative, so adding an authored field is an obvious one-line edit. Each entry
// says what a value MUST be when present; a wrong type is a named refusal instead
// of a value that survives the parse and crashes something downstream.

type FieldKind = 'stringList' | 'objectList' | 'object' | 'text' | 'number' | 'boolean';

const KIND_LABEL: Record<FieldKind, string> = {
  stringList: 'must be a list of text values',
  objectList: 'must be a list',
  object: 'has the wrong shape',
  text: 'must be text',
  number: 'must be a number',
  boolean: 'must be true or false',
};

/**
 * `answers` / `choices` / `unlockAfterTaskIds` — a non-list here reached
 * `taskCompletabilityError` (`.some is not a function`) and a non-string element
 * reached `a.trim()`; both surfaced to the creator as an opaque `internal`.
 * `steps` / `media` — walked element-by-element by the run-time task renderer and
 * by `normalizeStagesMedia`. The numbers are graded / compared at run time, so a
 * string there is a task nobody can complete.
 */
const TASK_FIELD_TYPES: Readonly<Record<string, FieldKind>> = {
  answers: 'stringList',
  choices: 'stringList',
  unlockAfterTaskIds: 'stringList',
  steps: 'objectList',
  media: 'objectList',
  description: 'text',
  hint: 'text',
  locationClue: 'text',
  locationClueHe: 'text',
  numericAnswer: 'number',
  numericTolerance: 'number',
  geofenceRadiusMeters: 'number',
  hintPenalty: 'number',
  maxDurationMinutes: 'number',
  expectedDurationMinutes: 'number',
  hintAutoRevealMinutes: 'number',
  hintAutoRevealAttempts: 'number',
  releaseAfterMinutes: 'number',
  expiresAfterMinutes: 'number',
  locationless: 'boolean',
  hideLocation: 'boolean',
  requirePresence: 'boolean',
  // pause-clock-tasks: a boolean or nothing. A file saying `"yes"` is REFUSED by
  // name here rather than coerced — the flag decides how a whole run is timed.
  pausesTimer: 'boolean',
  smart: 'object',
  coordinates: 'object',
};

const STAGE_FIELD_TYPES: Readonly<Record<string, FieldKind>> = {
  requiredTaskCount: 'number',
  releaseAfterMinutes: 'number',
  narrative: 'object',
  exclusiveGroups: 'objectList',
  isFinal: 'boolean',
};

const GAME_FIELD_TYPES: Readonly<Record<string, FieldKind>> = {
  description: 'text',
  instructions: 'object',
  minAge: 'number',
  requiresGuardianConsent: 'boolean',
  benchmarkOptOut: 'boolean',
  allowInstantPlay: 'boolean',
  photoFeedEnabled: 'boolean',
  powerUpsEnabled: 'boolean',
  manualLeaderboardReveal: 'boolean',
};

/** Every wrongly-typed PRESENT field of `bag`, as `label: field must be …`. */
function fieldTypeProblems(
  bag: Bag,
  label: string,
  table: Readonly<Record<string, FieldKind>>,
): string[] {
  const problems: string[] = [];
  for (const [field, kind] of Object.entries(table)) {
    const v = bag[field];
    if (v === undefined || v === null) continue;
    const ok =
      kind === 'stringList' ? Array.isArray(v) && v.every((e) => typeof e === 'string')
      : kind === 'objectList' ? Array.isArray(v) && v.every((e) => isBag(e))
      : kind === 'object' ? isBag(v)
      : kind === 'text' ? typeof v === 'string'
      : kind === 'number' ? typeof v === 'number' && Number.isFinite(v)
      : typeof v === 'boolean';
    if (!ok) problems.push(`${label}: ${field} ${KIND_LABEL[kind]}.`);
  }
  return problems;
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Serialize an owner's game into the portable document. Picks the authored key
 * sets ONLY — never a spread — so a field added to the model without being
 * classified cannot leak (secrets, runtime state) or vanish (authored data)
 * unnoticed.
 */
export function serializeGameToFile(game: GameFileGame | Game): GameFile {
  const src = clone(game as unknown as Bag);
  const out = pick(src, EXPORTED_GAME_KEYS);

  const stages = Array.isArray(src.stages) ? (src.stages as Bag[]) : [];
  out.stages = stages.map((rawStage) => {
    const stage = pick(rawStage, EXPORTED_STAGE_KEYS);
    const tasks = Array.isArray(rawStage.tasks) ? (rawStage.tasks as Bag[]) : [];
    stage.tasks = tasks.map((rawTask) => {
      const task = pick(rawTask, EXPORTED_TASK_KEYS);
      if (isBag(task.smart)) task.smart = pick(task.smart, EXPORTED_SMART_KEYS);
      return task;
    });
    return stage;
  });

  return {
    format: GAME_FILE_FORMAT,
    schemaVersion: CURRENT_GAME_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    game: out as unknown as GameFileGame,
  };
}

/** A safe, recognisable download filename for a game title. */
export function gameFileFilename(title: string): string {
  const base = stripUnsafeDisplayChars(String(title ?? ''))
    .replace(/[/\\:*?"<>|]/g, ' ')   // path + Windows-reserved characters
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'game'}${GAME_FILE_EXTENSION}`;
}

// ─── Version upgrades ─────────────────────────────────────────────────────────

/**
 * Bring a document at a KNOWN older version up to `CURRENT_GAME_FILE_VERSION`.
 * The chain is empty at v1 (there are no predecessors); the seam exists so that
 * adding v2 is a pure function plus a test, not a redesign.
 */
export function upgradeGameFile(doc: GameFile): GameFile {
  return doc;
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Read a portable document back into an authored template.
 *
 * NEVER throws and NEVER returns a partial game: on any problem `game` is null
 * and every reason is listed. The caller (importGameFile) refuses the whole
 * import, so a bad file can never leave half a game behind.
 *
 * Accepts either the parsed object or the raw JSON text (the byte cap is measured
 * on the text before it is parsed).
 *
 * Layers, in order: envelope (format · version · byte cap) → counts → shape
 * (required fields, types, unique ids, coordinates, string caps) → pure
 * structural rules (unlock graph · availability window · ordering · survey).
 * The WINNABILITY guards (`gameStructureProblems`) and the media/instructions
 * trust boundary run in the callable, from the same helper `updateGame` uses, so
 * an imported game can never be accepted on terms an authored one would not be.
 */
export function parseGameFile(input: unknown): ParsedGameFile {
  const errors: string[] = [];
  const reject = (): ParsedGameFile => ({ game: null, errors });

  // ── Envelope: byte cap first, on the raw payload ──
  let raw: unknown = input;
  if (typeof input === 'string') {
    if (utf8Bytes(input) > MAX_GAME_FILE_BYTES) {
      errors.push(tooLargeMessage(utf8Bytes(input)));
      return reject();
    }
    try {
      raw = JSON.parse(input);
    } catch {
      errors.push('Could not parse the file. It is not valid JSON.');
      return reject();
    }
  } else if (isBag(input)) {
    let bytes = 0;
    try {
      bytes = utf8Bytes(JSON.stringify(input));
    } catch {
      errors.push('Could not parse the file. It is not valid JSON.');
      return reject();
    }
    if (bytes > MAX_GAME_FILE_BYTES) {
      errors.push(tooLargeMessage(bytes));
      return reject();
    }
  }

  if (!isBag(raw)) {
    errors.push('This is not a RushPoint game file.');
    return reject();
  }

  if (raw.format !== GAME_FILE_FORMAT) {
    errors.push('This is not a RushPoint game file.');
    return reject();
  }

  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    errors.push("The file's format version is missing or invalid.");
    return reject();
  }
  if (version > CURRENT_GAME_FILE_VERSION) {
    // Refuse LOUDLY. Importing this by ignoring what we do not recognise is
    // exactly how a creator loses their work a second time, invisibly.
    errors.push(
      `This file was exported by a newer version of RushPoint (format ${version}). `
      + `This version reads up to format ${CURRENT_GAME_FILE_VERSION}.`,
    );
    return reject();
  }

  const upgraded = upgradeGameFile(raw as unknown as GameFile);
  const rawGame = (upgraded as unknown as Bag).game;
  if (!isBag(rawGame)) {
    errors.push('The file contains no game.');
    return reject();
  }

  // ── Counts, before any per-item work ──
  const rawStages = rawGame.stages;
  if (!Array.isArray(rawStages)) {
    errors.push('The file has no stages list.');
    return reject();
  }
  if (rawStages.length > MAX_FILE_STAGES) {
    errors.push(`This file has ${rawStages.length} stages. The limit is ${MAX_FILE_STAGES}.`);
    return reject();
  }
  const totalTasks = rawStages.reduce(
    (n, s) => n + (isBag(s) && Array.isArray(s.tasks) ? s.tasks.length : 0), 0,
  );
  if (totalTasks > MAX_FILE_TASKS) {
    errors.push(`This file has ${totalTasks} tasks. The limit is ${MAX_FILE_TASKS}.`);
    return reject();
  }

  // ── Graph scan: forbidden keys · depth · array length · finite numbers ·
  //    string length. On the RAW game, before any clone (change:
  //    game-import-hardening — see scanCandidateGraph for why the order matters).
  const graphProblems = scanCandidateGraph(rawGame);
  if (graphProblems.length > 0) {
    errors.push(...graphProblems);
    return reject();
  }

  // ── Shape ──
  const game = pick(clone(rawGame), EXPORTED_GAME_KEYS);

  const title = typeof game.title === 'string' ? stripUnsafeDisplayChars(game.title).trim() : '';
  if (!title) errors.push('The game has no title.');
  game.title = title;
  errors.push(...fieldTypeProblems(game, 'The game', GAME_FIELD_TYPES));

  const stages: Bag[] = [];
  const seenStageIds = new Set<string>();
  rawStages.forEach((rawStage, si) => {
    if (!isBag(rawStage)) {
      errors.push(`Stage ${si + 1} is not a valid stage.`);
      return;
    }
    const stage = pick(clone(rawStage), EXPORTED_STAGE_KEYS);
    const stageId = typeof stage.id === 'string' ? stage.id.trim() : '';
    if (!stageId) {
      errors.push(`Stage ${si + 1} has no id.`);
    } else if (seenStageIds.has(stageId)) {
      errors.push(`Duplicate stage id "${stageId}".`);
    }
    seenStageIds.add(stageId);
    stage.id = stageId;
    stage.title = typeof stage.title === 'string' ? stripUnsafeDisplayChars(stage.title).trim() : '';
    stage.order = typeof stage.order === 'number' && Number.isFinite(stage.order) ? stage.order : si;

    const label = `Stage "${stage.title || stageId || si + 1}"`;
    // A wrongly-typed stage field used to be carried through (or silently turned
    // into an empty task list, which strands the whole stage at run time).
    errors.push(...fieldTypeProblems(stage, label, STAGE_FIELD_TYPES));
    if (rawStage.tasks !== undefined && !Array.isArray(rawStage.tasks)) {
      errors.push(`${label}: tasks must be a list.`);
    }
    const rawTasks = Array.isArray(rawStage.tasks) ? rawStage.tasks : [];
    const tasks: Bag[] = [];
    const seenTaskIds = new Set<string>();

    rawTasks.forEach((rawTask, ti) => {
      if (!isBag(rawTask)) {
        errors.push(`${label}: task ${ti + 1} is not a valid task.`);
        return;
      }
      const task = pick(clone(rawTask), EXPORTED_TASK_KEYS);
      const taskId = typeof task.id === 'string' ? task.id.trim() : '';
      if (!taskId) {
        errors.push(`${label}: a task has no id.`);
      } else if (seenTaskIds.has(taskId)) {
        errors.push(`${label}: duplicate task id "${taskId}".`);
      }
      seenTaskIds.add(taskId);
      task.id = taskId;

      const tLabel = `Task "${(typeof task.title === 'string' && task.title) || taskId || ti + 1}"`;
      task.title = typeof task.title === 'string' ? stripUnsafeDisplayChars(task.title).trim() : '';
      if (!task.title) errors.push(`${tLabel}: title is required.`);

      if (task.type === undefined) {
        errors.push(`${tLabel}: type is required.`);
      } else if (typeof task.type !== 'string' || !TASK_TYPES.includes(task.type as TaskType)) {
        errors.push(`${tLabel}: unknown task type "${String(task.type)}".`);
      }

      const coords = task.coordinates;
      if (!isBag(coords) || !isValidCoord(coords.lat, coords.lng)) {
        errors.push(`${tLabel}: coordinates are not valid (lat must be within ±90, lng within ±180).`);
      }

      for (const numField of ['difficulty', 'estimatedMinutes', 'pointValue', 'maxConcurrentTeams'] as const) {
        const v = task[numField];
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          errors.push(`${tLabel}: ${numField} must be a number.`);
        }
      }

      // Expected duration (change: task-duration-defaults) is OPTIONAL — absent means
      // the Builder derives the per-interaction default — so it is range-checked here
      // rather than required above. TASK_FIELD_TYPES already refuses a non-number;
      // this refuses NaN/Infinity (which would NaN the whole run's speed bonus) and a
      // negative value (which would shrink the expected route total below zero).
      if (task.expectedDurationMinutes !== undefined
        && typeof task.expectedDurationMinutes === 'number'
        && (!Number.isFinite(task.expectedDurationMinutes) || task.expectedDurationMinutes < 0)) {
        errors.push(`${tLabel}: expectedDurationMinutes must be a finite, non-negative number.`);
      }

      // Optional fields whose TYPE was previously trusted. A `5` where a list of
      // `answers` belongs used to parse clean and then throw
      // `TypeError: task.answers.some is not a function` inside the callable's
      // completability guard — an opaque 500 instead of a field-level refusal.
      errors.push(...fieldTypeProblems(task, tLabel, TASK_FIELD_TYPES));

      // Pure structural rules — the same functions the Builder save path runs.
      const windowError = validateAvailabilityWindow(task as { releaseAfterMinutes?: number; expiresAfterMinutes?: number });
      if (windowError) errors.push(`${tLabel}: ${windowError}`);

      if (task.orderItems !== undefined) {
        if (task.type !== 'quiz') {
          errors.push(`${tLabel}: ordering items are only valid on a quiz task.`);
        } else if (
          (Array.isArray(task.choices) && task.choices.length > 0)
          || (Array.isArray(task.answers) && task.answers.length > 0)
        ) {
          errors.push(`${tLabel}: a quiz cannot mix ordering items with choices or typed answers.`);
        }
        const orderError = validateOrderItems(task.orderItems);
        if (orderError) errors.push(`${tLabel}: ${orderError}`);
      }
      if (task.surveyChoices !== undefined) {
        const choiceError = validateSurveyChoices(task.surveyChoices);
        if (choiceError) errors.push(`${tLabel}: ${choiceError}`);
      }
      // `unlockAfterTaskIds` is type-checked by TASK_FIELD_TYPES above; drop it
      // here so the unlock-graph walk below is never handed a non-list.
      if (task.unlockAfterTaskIds !== undefined
        && !(Array.isArray(task.unlockAfterTaskIds)
          && task.unlockAfterTaskIds.every((v) => typeof v === 'string'))) {
        delete task.unlockAfterTaskIds;
      }

      if (isBag(task.smart)) task.smart = pick(task.smart, EXPORTED_SMART_KEYS);
      tasks.push(task);
    });

    stage.tasks = tasks;
    // Prerequisite graph: no self-reference, no cross-stage / unknown id, no cycle.
    for (const e of validateUnlockGraph(stage as unknown as { tasks: { id: string; unlockAfterTaskIds?: string[] }[] }).errors) {
      errors.push(`${label}: ${e}`);
    }
    stages.push(stage);
  });

  game.stages = stages;

  if (errors.length > 0) return reject();
  // NOTE: display-char sanitizing is applied to exactly the fields the normal
  // authoring path (updateGame → sanitizeStagesText) sanitizes — game/stage/task
  // titles and descriptions — and to nothing else. Running stripUnsafeDisplayChars
  // over EVERY string leaf was tried and reverted: it strips U+200D, which silently
  // destroys ZWJ emoji sequences (👨‍👩‍👧 → 👨👩👧) in tags, answers and clues. An
  // import must never mangle content that the Builder itself stores untouched.
  return { game: game as unknown as GameFileGame, errors: [] };
}

function tooLargeMessage(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const limit = (MAX_GAME_FILE_BYTES / (1024 * 1024)).toFixed(0);
  return `That file is too large (${mb} MB). The size limit is ${limit} MB.`;
}

// "Give me another one like this" — swapping one mission for a bank mission
// (change: mission-regenerate).
//
// ─── Why this is not `fitScore` ──────────────────────────────────────────────
//
// `lib/composeGame.ts` already scores bank missions, and it answers a different
// question: *how well does this mission suit the answers a creator gave a
// questionnaire?* This module answers *how close is this mission to the one
// already sitting in this slot?* — a mission-to-mission comparison, on a game
// that may never have had a questionnaire. Bolting a second meaning onto
// `fitScore` would put it inside the function every composed game depends on,
// whose weights are documented as summing to exactly 1 so that "the neutral
// occasion changes nothing" stays provable. So: a separate score, in a separate
// module, and the composer is not touched.
//
// What IS reused rather than restated: the tag registry and every one of its
// group lists (bankTags), and `seededRng` + `pickFromBand` + `TOP_K_MARGIN` from
// the composer, so regenerate and compose sample a near-best band the same way.
//
// ─── Pure, seeded, total ─────────────────────────────────────────────────────
//
// No React, no Firebase, no storage handle, no clock. The chooser takes a SEED
// rather than reaching for `Math.random`, which is what makes every scenario in
// specs/mission-regenerate assertable without stubbing anything —
// scripts/test-mission-regenerate.ts. Every exported function is total: the
// caller is a button, and a button that throws is a Builder that crashes to the
// ErrorBoundary.
import type { Task } from '@rushpoint/shared';
import type { TaskBankEntry } from '../taskBank';
import {
  ACTIVITY_TAG_IDS,
  BOOKEND_TAG_IDS,
  AREA_TAG_IDS,
  AUDIENCE_TAG_IDS,
  DIFFICULTY_TAG_IDS,
  difficultyBandFor,
  prepTierOf,
  type BankTagId,
} from '../bankTags';
import { seededRng, pickFromBand } from './composeGame';
import type { OccasionId } from './occasions';

// ═══════════════════════════════════════════════════════════════════════════
// 1. Tuning constants — named so a test asserts against the NAME, not the number
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The six similarity terms. Sum to 1, so a perfect match scores exactly 1.
 *
 * The mass sits on the axes a stored `Task` can actually express (see
 * `missionTagProfile`): a mission document knows what players DO and whether it
 * has a pin; it does not know who the game is for. Weighting audience heavily
 * would be weighting a term that is neutral for nearly every real mission.
 */
export const SIMILARITY_WEIGHTS = {
  /** What the players do. The strongest sense of "another one like this" — and the axis drift attacks. */
  activity: 0.30,
  /** Placed vs from-anywhere. Structural, and always derivable from a task. */
  location: 0.20,
  /** Band distance, so a hard mission is replaced by a hard one. */
  difficulty: 0.16,
  /** Indoor / outdoor. */
  setting: 0.10,
  /**
   * Opener / finale / neither — the mission's ROLE in the game.
   *
   * Added after the first browser run of this feature replaced a game's opening
   * mission ("everyone gather here, then we start") with a mid-game action
   * mission. Every other term scored it correctly — same activity, same
   * placement, same difficulty band — and the answer was still wrong, because a
   * bookend is not a mission that happens to be first: the bank tags six openers
   * and eight finales precisely because that role is a property of the content.
   * Weighted like `setting`, which is the other structural axis a creator would
   * notice immediately.
   */
  bookend: 0.10,
  /** The kind of place. */
  area: 0.08,
  /** Who it suits. */
  audience: 0.06,
} as const;

/**
 * What a dimension scores when nobody has an opinion about it.
 *
 * Neutral, NOT zero. This is `fitScore`'s own area rule generalised: a profile
 * that is silent on an axis and a mission that suits everywhere are both "no
 * information", and scoring that as a mismatch would rank every place-agnostic
 * mission below every tagged one for a reason no creator could see. Since a
 * derived profile is silent on audience and area for nearly every mission, the
 * rule matters more here than it does in the composer.
 */
export const NEUTRAL_MATCH = 0.5;

/**
 * How much of the activity reward one press of "regenerate" burns.
 *
 * Level 0 → ×1 (pure similarity: the closest match available). 1 → ×0.5. 2 → ×0
 * (indifferent). 3 → ×-0.5, 4+ → ×-1: sharing the outgoing mission's activity
 * now COSTS, so a genuinely different kind of mission outranks the one that
 * would have won on the first press.
 *
 * A signed multiplier rather than a widening band, deliberately. Widening the
 * accepted band makes later presses MORE RANDOM, not more different, and the
 * creator asked for a different direction. Every other term stays intact, so a
 * drifted pick is still the right difficulty, still playable, still in the right
 * place — only the activity moves.
 */
export const ACTIVITY_DRIFT_STEP = 0.5;

/** Drift is clamped here, so a creator who presses twenty times does not invert into nonsense. */
const DRIFT_MULTIPLIER_FLOOR = -1;

/** The default prep tier a regenerate will hand out: `needsSetup`, never `needsPartner`. */
export const DEFAULT_PREP_TOLERANCE = 1;

// ── Dimension groups ────────────────────────────────────────────────────────
//
// `SETTING_TAG_IDS` is deliberately NOT used: it contains `fromAnywhere`, which
// the `location` term already owns, and counting one tag under two weights would
// quietly double its influence.
const SETTING_GROUP = ['outdoor', 'indoor'] as const;
const LOCATION_GROUP = ['locationBased', 'fromAnywhere'] as const;

const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : null);

const tagsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);

// ═══════════════════════════════════════════════════════════════════════════
// 2. The outgoing mission's tag profile
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Which activity tag a mission's own interaction implies.
 *
 * The map is the honest reading of what the player physically does, not a
 * lookup that happens to be exhaustive: a photo mission is a camera mission, an
 * answer-bearing mission is a thinking mission, and everything else is going
 * somewhere and doing something.
 */
const ACTIVITY_FOR_TYPE: Record<string, BankTagId> = {
  photo: 'camera',
  quiz: 'thinking',
  numeric: 'thinking',
  sequence: 'thinking',
  survey: 'teamwork',
  self_report: 'teamwork',
  field: 'action',
  geofence: 'action',
  smart_station: 'action',
};

/**
 * A bank-tag profile for the mission being replaced, derived from the mission
 * ITSELF rather than from any record of where it came from.
 *
 * That is what makes regenerate work on every mission in every game — composed,
 * from a template, from the library, or hand-written — with nothing stamped at
 * creation time. The alternative (a `Task.bankKey` written when a bank mission is
 * inserted) reaches the shared type, the Builder's save allow-list, the game-file
 * format and the participant sanitizer's allow-list — four places this codebase
 * records as having caused silent data loss — does nothing for the games that
 * already exist, and LIES after a creator rewrites the mission into something
 * else. Deriving is cheaper and stays true.
 *
 * A dimension a `Task` cannot express — audience, area, prep, occasion — is
 * ABSENT, never guessed. `similarityScore` scores an absent dimension neutrally,
 * so silence costs a candidate nothing.
 *
 * Total: the caller is a button.
 */
export function missionTagProfile(task: unknown, role?: MissionRole): BankTagId[] {
  const t = (task && typeof task === 'object' ? task : {}) as Partial<Task>;
  const out: BankTagId[] = [];

  const activity = ACTIVITY_FOR_TYPE[typeof t.type === 'string' ? t.type : ''];
  if (activity) out.push(activity);

  out.push(isLocationlessTask(t) ? 'fromAnywhere' : 'locationBased');
  out.push(difficultyBandFor(t.difficulty));
  if (role === 'start' || role === 'finish') out.push(role);

  return out;
}

/**
 * Where a mission sits in the game, when that is a role and not just a position.
 *
 * Derived by the caller from the slot (`missionRoleAt`), not from the task: a
 * `Task` records nothing about being the opener, and it is the SLOT that carries
 * the obligation — whatever mission ends up first has to be one a group can walk
 * up to and begin with.
 */
export type MissionRole = 'start' | 'finish' | null;

/**
 * The role of the mission at `taskIndex` of `stageIndex`.
 *
 * The FIRST mission of the FIRST stage opens the game; the LAST mission of the
 * LAST stage closes it. Everything else is a middle mission, and a middle slot
 * must not be handed a bookend either — "everyone gather here and we begin" in
 * the middle of a game is exactly as wrong as a random action mission at the
 * start. That symmetry is why `bookendMatch` compares roles for EQUALITY rather
 * than scoring a silent profile neutrally.
 *
 * Total: any out-of-range or malformed index is a middle mission.
 */
export function missionRoleAt(
  stageIndex: unknown,
  taskIndex: unknown,
  stageCount: unknown,
  taskCount: unknown,
): MissionRole {
  const si = num(stageIndex);
  const ti = num(taskIndex);
  const sc = num(stageCount);
  const tc = num(taskCount);
  if (si === null || ti === null || sc === null || tc === null) return null;
  if (si === 0 && ti === 0) return 'start';
  if (si === sc - 1 && ti === tc - 1) return 'finish';
  return null;
}

/** Does this mission play from anywhere? The one placement question every reader asks. */
function isLocationlessTask(t: Partial<Task> | null | undefined): boolean {
  if (!t || typeof t !== 'object') return true;
  return t.locationless === true || t.triggerMode === 'locationless';
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. The game's playability context
// ═══════════════════════════════════════════════════════════════════════════

export interface RegenerateContext {
  /**
   * `fromAnywhere` when this game has no venue at all. A location-only mission is
   * then literally unplayable and is excluded — the composer's own hard rule.
   */
  setting: 'fromAnywhere' | 'placed';
  /** The highest `PREP_TAG_IDS` tier a candidate may demand. */
  prepTolerance: number;
  /**
   * A `Game` records no occasion, so this is `undefined` in practice and a
   * candidate that declares `occasions` is excluded. That is the SAFE direction,
   * and it is the rule `fitScore` already states: "we were not told what this
   * event is" must never resolve to "so hand them a birthday mission".
   */
  occasion: OccasionId | undefined;
}

/**
 * What this game can actually accept, derived from the game itself.
 *
 * Total against a malformed game: an unreadable game yields the most permissive
 * SAFE context — a placed setting (so nothing is excluded for a venue reason)
 * with the default prep tolerance (so an outside-partner mission still cannot
 * arrive by accident).
 */
export function regenerateContext(game: unknown, _task?: unknown): RegenerateContext {
  const stages = (game && typeof game === 'object' && Array.isArray((game as { stages?: unknown }).stages)
    ? (game as { stages: unknown[] }).stages
    : []);

  let sawTask = false;
  let sawPlaced = false;
  for (const stage of stages) {
    const tasks = (stage && typeof stage === 'object' && Array.isArray((stage as { tasks?: unknown }).tasks)
      ? (stage as { tasks: unknown[] }).tasks
      : []);
    for (const t of tasks) {
      if (!t || typeof t !== 'object') continue;
      sawTask = true;
      if (!isLocationlessTask(t as Partial<Task>)) sawPlaced = true;
    }
  }

  return {
    // A game we could not read is NOT declared venueless: that would exclude every
    // placed mission in the bank on the strength of a parse failure.
    setting: sawTask && !sawPlaced ? 'fromAnywhere' : 'placed',
    prepTolerance: DEFAULT_PREP_TOLERANCE,
    occasion: undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Similarity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How much two tag sets agree on ONE dimension.
 *
 * `NEUTRAL_MATCH` whenever either side is silent — see the constant. Otherwise a
 * plain hit/miss: within a dimension the tags are alternatives, not a spectrum.
 */
function dimensionMatch(
  profile: readonly string[],
  candidate: readonly string[],
  group: readonly string[],
): number {
  const mine = profile.filter((t) => group.includes(t));
  const theirs = candidate.filter((t) => group.includes(t));
  if (mine.length === 0 || theirs.length === 0) return NEUTRAL_MATCH;
  return mine.some((t) => theirs.includes(t)) ? 1 : 0;
}

/**
 * The bookend dimension: do the slot and the candidate agree about the ROLE?
 *
 * Equality, NOT the neutral rule the other dimensions use. Silence here is
 * information: a profile with no bookend tag is a middle slot, and a candidate
 * tagged `start` is wrong for it just as surely as an untagged candidate is
 * wrong for the opening slot. Scoring silence neutrally would let a bank opener
 * drift into the middle of a game, which is the failure the term was added for.
 */
function bookendMatch(profile: readonly string[], candidate: readonly string[]): number {
  const bookends = BOOKEND_TAG_IDS as readonly string[];
  const mine = profile.find((t) => bookends.includes(t)) ?? null;
  const theirs = candidate.filter((t) => bookends.includes(t));
  if (mine === null) return theirs.length === 0 ? 1 : 0;
  return theirs.includes(mine) ? 1 : 0;
}

/**
 * The difficulty dimension, which IS a spectrum: an adjacent band is a near
 * miss, not a miss. Both sides always declare one, so there is no neutral case.
 */
function difficultyMatch(profile: readonly string[], candidate: readonly string[]): number {
  const bands = DIFFICULTY_TAG_IDS as readonly string[];
  const a = bands.indexOf(profile.find((t) => bands.includes(t)) ?? '');
  const b = bands.indexOf(candidate.find((t) => bands.includes(t)) ?? '');
  if (a < 0 || b < 0) return NEUTRAL_MATCH;
  const gap = Math.abs(a - b);
  return gap === 0 ? 1 : gap === 1 ? 0.5 : 0;
}

/**
 * How much this press should still reward sharing the outgoing activity.
 *
 * Total: anything that is not a real, non-negative level behaves as level 0 — a
 * malformed drift must produce the CLOSEST match, never an inverted one.
 */
export function activityDriftMultiplier(level: unknown): number {
  const n = num(level);
  if (n === null || n <= 0) return 1;
  return Math.max(DRIFT_MULTIPLIER_FLOOR, 1 - n * ACTIVITY_DRIFT_STEP);
}

/**
 * How close this bank mission is to the profile, at this drift level.
 *
 * At drift 0 this is pure similarity — a first press is provably the closest
 * match, which is the behaviour the whole feature is named for.
 */
export function similarityScore(
  entry: TaskBankEntry | null | undefined,
  profile: readonly BankTagId[] | null | undefined,
  drift: unknown = 0,
): number {
  if (!entry || typeof entry !== 'object') return -Infinity;
  const mine = tagsOf(profile);
  const theirs = tagsOf(entry.tags);
  const W = SIMILARITY_WEIGHTS;

  return W.activity * dimensionMatch(mine, theirs, ACTIVITY_TAG_IDS) * activityDriftMultiplier(drift)
    + W.location * dimensionMatch(mine, theirs, LOCATION_GROUP)
    + W.difficulty * difficultyMatch(mine, theirs)
    + W.setting * dimensionMatch(mine, theirs, SETTING_GROUP)
    + W.bookend * bookendMatch(mine, theirs)
    + W.area * dimensionMatch(mine, theirs, AREA_TAG_IDS)
    + W.audience * dimensionMatch(mine, theirs, AUDIENCE_TAG_IDS);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Seeding
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A seed for one press: this mission, at this drift level.
 *
 * FNV-1a, NOT a djb2 / Bernstein roll. CLAUDE.md records a real defect from the
 * latter: folding each character into the low bits collides structurally on
 * SHORT inputs, and a task id is short. FNV multiplies the whole word every
 * step, so one character avalanches. Pinned by an exhaustive two-character sweep
 * in the test.
 */
export function seedFor(taskId: unknown, drift: unknown): number {
  const id = typeof taskId === 'string' ? taskId : '';
  const level = Math.max(0, Math.floor(num(drift) ?? 0));
  let h = 0x811c9dc5;
  const word = `${id}#${level}`;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Choosing
// ═══════════════════════════════════════════════════════════════════════════

export interface RegenerateRequest {
  bank: readonly TaskBankEntry[];
  profile: readonly BankTagId[];
  context: RegenerateContext;
  /** How many times THIS mission has already been regenerated. */
  drift: number;
  /** Bank keys already offered for this mission. */
  offeredKeys: readonly string[];
  seed: number;
}

/**
 * Can this game play this mission at all?
 *
 * These describe the creator's WORLD, not their taste, so they are hard and they
 * are never relaxed — not by drift, and not by an empty pool. A mission that
 * cannot be played must never be offered, however many times the button is
 * pressed.
 */
function playable(entry: TaskBankEntry, ctx: RegenerateContext): boolean {
  const tags = tagsOf(entry.tags);
  if (prepTierOf(tags) > (num(ctx?.prepTolerance) ?? DEFAULT_PREP_TOLERANCE)) return false;
  if (ctx?.setting === 'fromAnywhere' && tags.includes('locationBased') && !tags.includes('fromAnywhere')) {
    return false;
  }
  const occasions = Array.isArray(entry.occasions) ? entry.occasions : [];
  if (occasions.length > 0 && (ctx?.occasion === undefined || !occasions.includes(ctx.occasion))) {
    return false;
  }
  return true;
}

/**
 * The replacement, or `null` when this game genuinely has nothing left to offer.
 *
 * TWO passes. The first excludes everything already offered for this mission and
 * every near-duplicate `family` of it — the relation that already exists to stop
 * the composer shipping two skins of one mechanic, and exactly what makes a
 * second suggestion feel like the first. If that leaves nothing, the second pass
 * drops ONLY the history exclusion: history describes the past, and a creator
 * pressing a button must not reach a dead end because of it. Playability is
 * never dropped.
 *
 * Sampling, not argmax, via the composer's own `pickFromBand`: always returning
 * the single best would make two creators with the same mission get the same
 * replacement forever.
 */
export function chooseRegeneratedMission(req: RegenerateRequest | null | undefined): TaskBankEntry | null {
  const bank = Array.isArray(req?.bank) ? req!.bank : [];
  if (bank.length === 0) return null;
  const ctx = req!.context ?? regenerateContext(null);
  const profile = tagsOf(req!.profile) as BankTagId[];
  const drift = num(req!.drift) ?? 0;
  const offered = new Set(tagsOf(req!.offeredKeys));
  const offeredFamilies = new Set(
    bank.filter((e) => e && offered.has(e.key) && typeof e.family === 'string').map((e) => e.family as string),
  );

  const eligible = bank.filter((e) => e && typeof e.key === 'string' && playable(e, ctx));
  if (eligible.length === 0) return null;

  const fresh = eligible.filter(
    (e) => !offered.has(e.key) && !(typeof e.family === 'string' && offeredFamilies.has(e.family)),
  );
  const pool = fresh.length > 0 ? fresh : eligible;

  const scored = pool.map((e) => ({ key: e.key, score: similarityScore(e, profile, drift), entry: e }));
  const picked = pickFromBand(scored, seededRng(num(req!.seed) ?? 0));
  return picked ? picked.entry : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Applying the replacement
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The task that replaces `outgoing`, built from `incoming`.
 *
 * The content changes; the SLOT does not. Preserved from the outgoing mission:
 *
 *   • `id` — non-negotiable. A sibling's `unlockAfterTaskIds` names it, and a new
 *     id would break that prerequisite silently, which is exactly the class of
 *     failure this codebase keeps re-learning.
 *   • the pin — `coordinates`, `geofenceRadiusMeters`, `triggerMode` — but only
 *     when the incoming mission can be played at a fixed spot. The stop is the
 *     same physical place; the mission at it changed. A from-anywhere replacement
 *     must NOT inherit a pin, or the game gains a map marker for a mission that
 *     is not played there.
 *   • `unlockAfterTaskIds` and the benched `hidden` flag — the mission's position
 *     in the flow is a property of the slot, not of the content in it.
 *
 * Total: a merge that throws would take the Builder down with it.
 */
export function applyRegeneratedMission(
  outgoing: Task | null | undefined,
  incoming: Task | null | undefined,
): Task {
  const from = (outgoing && typeof outgoing === 'object' ? outgoing : {}) as Task;
  const to = (incoming && typeof incoming === 'object' ? incoming : {}) as Task;
  const next: Task = { ...to };

  if (typeof from.id === 'string' && from.id !== '') next.id = from.id;
  if (from.hidden === true) next.hidden = true;
  if (Array.isArray(from.unlockAfterTaskIds)) next.unlockAfterTaskIds = [...from.unlockAfterTaskIds];

  if (!isLocationlessTask(to) && !isLocationlessTask(from)) {
    // Both sides want a place: keep the one the creator already chose.
    if (from.coordinates) next.coordinates = { ...from.coordinates };
    if (num(from.geofenceRadiusMeters) !== null) next.geofenceRadiusMeters = from.geofenceRadiusMeters;
    if (typeof from.triggerMode === 'string') next.triggerMode = from.triggerMode;
    next.locationless = undefined;
  }

  return next;
}

// The game composer — turns a short questionnaire into a complete, paced,
// launch-valid game (change: smart-game-composer).
//
// ═══════════════════════════════════════════════════════════════════════════
// What this module guarantees
// ═══════════════════════════════════════════════════════════════════════════
//
//   1. PURE. No React, no Firebase, no storage, no clock. Every source of
//      variability arrives as an argument — `rng` is injected exactly the way
//      `now` is injected into lib/teamAttention.ts and lib/photoReviewQueue.ts.
//      That is what makes a random feature testable at all.
//   2. TOTAL. It returns either a game that passes the server's own save-guard
//      validators, or exactly `null`. It never throws and never returns
//      something half-built. `null` means "this bank cannot make a game" and the
//      caller falls back to the blank path and says so.
//   3. LAUNCH-VALID BY CONSTRUCTION. No exclusiveGroups, no unlock graphs, no
//      availability windows, exactly one final stage, every stage populated,
//      every requiredTaskCount attainable. Not validated-then-repaired —
//      unable to be built wrong. scripts/test-composer-validators.ts runs the
//      exact `updateGame` battery over a 1000+ cell matrix to hold this.
//   4. LANGUAGE-FREE. Not one Hebrew or English word of copy lives here. Every
//      human-readable string arrives through the injected `copy` object, the
//      same rule lib/describeNewGame.ts lives by, so one composer serves a
//      Hebrew creator and an English one.
//
// ═══════════════════════════════════════════════════════════════════════════
// The rng call sequence — DO NOT reorder
// ═══════════════════════════════════════════════════════════════════════════
//
// Reproducibility is a function of the exact ORDER draws are consumed in:
//
//      1 draw  — which blueprint shapes the game
//      1 draw  — per slot filled, in this order:
//                  [stage 0, slot 0]           the opener
//                  [last stage, last slot]     the finale
//                  every remaining slot, stage by stage, left to right
//
// Adding a draw in the middle silently changes every seeded result, which would
// look like the composer "randomly got worse". If a new source of randomness is
// ever needed, append it at the end.
//
// ═══════════════════════════════════════════════════════════════════════════
// Why bookends are reserved BEFORE ordinary slots
// ═══════════════════════════════════════════════════════════════════════════
//
// Filling left to right and hoping a finale is still available does not work: an
// ordinary mid-game slot will happily consume the last `finish` mission, because
// from that slot's point of view it was simply the best fit. The finale slot then
// finds an empty pool and the game ends on filler. Reserving both ends first
// costs nothing and makes the guarantee structural.
import type { GameMode, ScoringPreset, Stage, Task, TemplateWizardStep } from '@rushpoint/shared';
import {
  AGE_BANDS,
  MAX_TAGS,
  effectiveExpectedDurationMinutes,
  normalizeTags,
  planDurationFit,
  type PersonalizationStage,
} from '@rushpoint/shared';
import {
  ACTIVITY_TAG_IDS,
  AUDIENCE_TAG_IDS,
  SETTING_TAG_IDS,
  isBankTagId,
  type ActivityTagId,
  type AudienceTagId,
  type BankTagId,
  type BookendTagId,
  type SettingTagId,
  AREA_TAG_IDS,
  type AreaTagId,
  prepTierOf,
  prepToleranceOf,
  prepWantsPlacedMissions,
  type PrepLevel,
} from '../bankTags';
import type { TaskBankEntry } from '../taskBank';
import { isOccasionId, occasionProfile, type OccasionId } from './occasions';
import { uuid } from '../taskShorthands';
import {
  MAX_BLENDED_DESCRIPTION_LEN,
  derivedGameTags,
  type NewGameDescriptionCopy,
} from './describeNewGame';

// ═══════════════════════════════════════════════════════════════════════════
// 1. Shapes
// ═══════════════════════════════════════════════════════════════════════════

export type DifficultyPreference = 'easy' | 'balanced' | 'hard';

/** What the questionnaire collected. Every field is treated as untrusted. */
export interface ComposerAnswers {
  /**
   * What KIND of event this is — see lib/occasions.ts.
   *
   * Optional, and ABSENT must behave exactly as the neutral occasion does: every
   * other composer suite composes without one, and if the two ever drift apart
   * they are all quietly testing a path no creator takes.
   */
  occasion?: OccasionId;
  audience: AudienceTagId;
  setting: SettingTagId;
  people: number;
  minutes: number;
  ageBandId: string;
  difficultyPreference: DifficultyPreference;
  /** Activity kinds the creator asked for more of. Optional by design. */
  preferredTags?: BankTagId[];
  /**
   * The kinds of place the event actually has — forest, mall, beach, and so on.
   * Optional: an empty list means "no preference", never "nowhere".
   */
  areas?: AreaTagId[];
  /**
   * Pin play-from-anywhere missions to real spots and guide the creator through
   * placing each one in Quick Setup, instead of leaving them playable from
   * wherever the team is standing. Defaults to FALSE — see `wantsPlacedMissions`
   * for why this must be an explicit ask, not inferred from the venue.
   */
  locationMissions?: boolean;
  /**
   * How much work the creator is willing to do BEFORE the game.
   *
   * A hard budget, not a preference. Missions are not equally expensive to run:
   * most cost nothing, some cost an afternoon (hide a key, walk a route and
   * count), and a few require going to a business, PAYING them, and getting the
   * owner to hand a code to strangers. No amount of good fit makes that last
   * kind acceptable to a creator who did not sign up for it, which is why the
   * tolerance excludes rather than merely penalises.
   *
   * A cumulative 1-5 rating, not a tier — see PREP_SCALE in bankTags.ts. The
   * five levels collapse onto the bank's three tiers, and level 2 ("I'll put
   * them on real spots") is the reason the scale exists at all: it also decides
   * `locationMissions`, which is why that field is derived rather than answered.
   *
   * Absent never buys the top level. See `prepToleranceOf`.
   */
  prepEffort?: PrepLevel;
}

/**
 * The localized copy the caller supplies from `t.*`.
 *
 * Extends the existing new-game copy so the age and duration words a composed
 * game is tagged with are byte-identical to the ones the template path produces.
 */
export interface ComposerDescriptionCopy extends NewGameDescriptionCopy {
  /** The opening clause of a composed description. */
  composedLead(input: { people: number; minutes: number; ageLabel: string }): string;
  /** A human phrase for an activity tag, e.g. "משימות צילום". */
  activityPhrase(tag: BankTagId): string;
  /**
   * How activity phrases are joined into ONE clause, connector included.
   *
   * The whole clause, not per-phrase: a connector repeated on every item reads
   * as "with photo missions and with riddles". The caller writes it once.
   */
  activityJoin(phrases: string[]): string;
  /** The gallery tag word for an activity tag. */
  activityTag(tag: BankTagId): string;
  /**
   * The candidate names for a stage in this position.
   *
   * A LIST, not one string: the composer picks from it, so two games of the same
   * shape do not read as the same game. Data in the dictionary, choice in here —
   * the same split the activity phrases use, and for the same reason (a list in
   * the dictionary has every entry parity- and language-checked; a name computed
   * behind a function does not).
   */
  stageNames(role: StageRole): string[];
  /**
   * Stage titles for THIS occasion, if the caller has any.
   *
   * Optional on purpose: every existing caller keeps compiling and keeps
   * behaving identically, so the occasion work cannot regress the generic path.
   * Absent, throwing or malformed all fall back to `stageNames` — a stage with
   * the wrong flavour of title is a cosmetic miss; a nameless one is a bug.
   */
  occasionStageNames?(occasion: OccasionId, role: StageRole): string[];
  /**
   * The Quick Setup prompt shown for a play-from-anywhere mission that this game
   * pinned to a place (see `siteableInPlacedGame`).
   *
   * Lives here rather than on the bank entry because it is not a property of the
   * mission — the same mission needs no pin at all in a no-venue game. It is a
   * property of the DECISION this composition made.
   */
  placeMissionPrompt(): string;
}

/** Where a stage sits in the arc. Drives which name list it draws from. */
export type StageRole = 'opener' | 'middle' | 'finale';

/** The bank keys this creator was handed recently. Most recent FIRST. */
export interface RecentPickState {
  recentBankKeys: string[];
}

export interface ComposerResult {
  stages: Stage[];
  description: string;
  tags: string[];
  wizardSteps: TemplateWizardStep[];
  scoringPreset: ScoringPreset;
  mode: GameMode;
  estimatedMinutes: number;
  /** The keys used, in the game's READING order. What the caller records as recency. */
  usedBankKeys: string[];
  /** Which blueprint shaped it. Diagnostics and variety assertions. */
  blueprintKey: string;
  /**
   * Set ONLY when the bank could not fill the time the creator asked for.
   *
   * A composed game is capped by how many missions exist that suit the answers,
   * and the honest failure is quiet: a creator asks for ninety minutes, is handed
   * a finished-looking game, and finds out it runs forty-five on the day. The
   * commonest cause is naming no places at all — that leaves only the missions
   * playable from anywhere, which is a small slice of any bank — so the caller
   * can turn this into advice the creator can act on rather than a bare number.
   */
  shortfall?: { askedMinutes: number; estimatedMinutes: number; namedPlaces: boolean };
}

/** One hand-authored stage shape. */
export interface StageBlueprint {
  key: string;
  stageCount: number;
  /** Relative mission weight per stage. Normalised to the real budget. */
  taskWeights: number[];
  /** Per-stage difficulty target, 1-10 — the game's arc. */
  difficultyCurve: number[];
}

/** Everything scoring one mission for one slot needs. */
export interface FitContext {
  audience: AudienceTagId;
  setting: SettingTagId;
  /** This stage's difficulty target, 1-10. */
  stageTarget: number;
  /** The age band's lower bound. */
  ageFrom: number;
  preferredTags: BankTagId[];
  /** The kinds of place this event has. Empty means the creator did not say. */
  areas: AreaTagId[];
  /** Bank keys already used in THIS game. */
  usedKeys: Set<string>;
  /**
   * Mission `family` ids already used in THIS game — see `TaskBankEntry.family`.
   * Two DIFFERENT keys sharing a family are the same mechanic in different
   * clothes ("collect five things one colour" / "collect a rainbow"), so a
   * family already spent excludes every remaining member exactly like
   * `usedKeys` excludes an exact repeat.
   */
  usedFamilies: Set<string>;
  /** Bank key → position in the recency memory (0 = most recent). */
  recentIndex: Map<string, number>;
  /** When set, only missions carrying this tag are eligible (a bookend slot). */
  requiredTag?: BookendTagId;
  /** The highest prep tier this creator accepts. See `prepToleranceOf`. */
  prepTolerance: number;
  /**
   * Activity tags the occasion favours. EMPTY means no bias whatsoever — see
   * `occasionBonus` for why that has to be exactly zero and not merely small.
   */
  favouredTags: readonly BankTagId[];
  /**
   * Does this creator prefer missions pinned to real spots? True from prep level
   * 4 ("I'll go to the site beforehand and set it up there"). A PREFERENCE, not
   * a filter: level 4 admits exactly the missions level 3 admits.
   */
  placedPreference: boolean;
}

/** The minimum a candidate needs to be sampled. */
export interface BandCandidate {
  key: string;
  score: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Tuning constants — named so tests assert against the name, not the number
// ═══════════════════════════════════════════════════════════════════════════

/** The five scoring terms. Sum to 1 so a perfect mission scores exactly 1. */
export const TERM_WEIGHTS = {
  audience: 0.26,
  setting: 0.20,
  // The KIND of place — forest, mall, beach — as opposed to merely indoor or out.
  // Weighted just under `setting` because it is finer-grained but optional: a
  // creator who skips the question, and a mission that suits everywhere, both
  // score neutrally here rather than being punished.
  area: 0.16,
  difficulty: 0.18,
  age: 0.08,
  preferred: 0.12,
} as const;

/**
 * The two ADDITIVE bonuses — deliberately NOT members of TERM_WEIGHTS.
 *
 * That object sums to exactly 1 by contract, so a seventh weight would mean
 * re-weighting the other six: every score the composer has ever produced would
 * move, and "the neutral occasion changes nothing" would become impossible to
 * state. These sit outside the normalized sum, in the same position the recency
 * penalty already occupies, and both are bounded well below any single term so
 * neither can overrule a real mismatch.
 */
export const OCCASION_BONUS = 0.10;
export const PLACED_PREFERENCE_BONUS = 0.08;

/** How far below the best a candidate may score and still be sampled. */
export const TOP_K_MARGIN = 0.15;

/** Keeps an all-equal band sampling uniformly instead of dividing by zero. */
export const BAND_EPSILON = 0.01;

/** How many recent keys are remembered — roughly five generations. */
export const RECENCY_WINDOW = 40;

/** The most a recent use can cost. Strictly below 1, so it biases but never vetoes. */
export const RECENCY_MAX_PENALTY = 0.35;

/** Mission-count clamp. */
export const MIN_TASKS = 4;

/**
 * The fewest missions a stage is worth having.
 *
 * A stage holding ONE mission is a mission wearing a stage's clothes: the team
 * completes it, a transition screen fires, and the next stage opens — ceremony
 * with nothing inside it. Blueprints used to be eligible whenever they had at
 * most one stage per mission, so a six-mission answer could come out as six
 * stages of one, which reads as a long game and plays as a stuttering one.
 */
export const MIN_MISSIONS_PER_STAGE = 2;
export const MAX_TASKS = 30;

/**
 * Seed estimate for sizing the budget BEFORE real missions are known. The real
 * pacing comes from `planDurationFit` on the missions actually chosen, so this
 * can be retuned without touching any interface.
 *
 * It covers the WHOLE cost of a mission — reading it, walking to it, doing it —
 * not just the interaction. An earlier 2.5 counted interaction only, and the
 * effect was that every answer from ~75 minutes upward hit the MAX_TASKS ceiling:
 * a 90-minute game, a two-hour game and a three-hour game all came out at exactly
 * 30 missions, so the duration question silently stopped mattering. At 7 the
 * whole realistic range stays on the curve (30m → 4 missions, 180m → 26).
 */
export const MINUTES_PER_TASK = 7;

/**
 * Minutes every mission costs beyond the interaction itself, wherever it is
 * played: reading it, agreeing who does what, getting the group organised,
 * submitting, and the pause before the next one lands.
 *
 * This is the half of the old flat constant that really was uniform.
 * `effectiveExpectedDurationMinutes` measures only the interaction — a photo
 * mission prices at well under two minutes — which is honest about the doing and
 * silent about everything around it. Averaged over the current bank the
 * interaction alone is ~1.7 minutes, so pricing missions at their interaction
 * cost made every answer from an hour upward ask for more missions than the
 * ceiling allows, and an hour, two hours and three hours all came out the same
 * length. The old flat 7 hid that by pretending every mission included a
 * five-minute walk, which is wrong in the other direction for a game played from
 * the couch.
 *
 * So the model is `interaction + overhead + transit`: derived, uniform, and
 * per-mission respectively. Overhead is the one term that is a judgement rather
 * than a measurement, and it is deliberately the only tunable number left.
 */
export const MISSION_OVERHEAD_MINUTES = 3.5;

/** How far `difficultyPreference` shifts the whole arc. Shifts, never flattens. */
const DIFFICULTY_SHIFT: Record<DifficultyPreference, number> = {
  easy: -2,
  balanced: 0,
  hard: 2,
};

/** How partial matches score, relative to an exact one. */
const MIXED_AUDIENCE_MATCH = 0.6;
const ANYWHERE_SETTING_MATCH = 0.8;

/**
 * What area fit scores when nobody expressed a preference — the creator skipped
 * the question, or the mission suits anywhere. Deliberately mid-range: a silent
 * pairing must not beat a real match, and must not lose to a real mismatch.
 */
const AREA_NEUTRAL_FIT = 0.5;

/**
 * The walk assumed for a play-from-anywhere mission that the creator is asked to
 * PIN, in a game that has real places (see `siteableInPlacedGame`). It is a
 * guess about a spot that does not exist yet, so it is deliberately shorter than
 * any authored transit: those name a real leg of a real route.
 */
export const PLACED_TRANSIT_MINUTES = 4;

/**
 * The walk a play-from-anywhere mission costs INDOORS.
 *
 * Pinning and walking are separate questions, and conflating them made indoor
 * games come out about an eighth short: an office day is not a couch game — the
 * team still crosses the building between missions — but it does not need a pin
 * dropped on each one. So indoors we price a short walk and ask for no pins.
 */
export const INDOOR_WALK_MINUTES = 2;

/** The floor an age mismatch decays to — a penalty, never an exclusion. */
const AGE_FIT_FLOOR = 0.2;
/** Years of gap that take age fit all the way down to the floor. */
const AGE_FIT_SPAN = 10;

/** A composed game's fixed presentation. */
const COMPOSED_SCORING_PRESET: ScoringPreset = 'smart_weighted';
const COMPOSED_MODE: GameMode = 'team';

/**
 * How much of the asked-for time a game must fill before we stop calling it
 * short. Below this the caller is told, above it the gap is ordinary rounding.
 */
export const SHORTFALL_RATIO = 0.75;

/** At most this many activity kinds are named in a description. */
const MAX_NAMED_ACTIVITIES = 2;

export const STAGE_BLUEPRINTS: StageBlueprint[] = [
  { key: 'classic-3', stageCount: 3, taskWeights: [0.8, 1.4, 0.8], difficultyCurve: [3, 6, 8] },
  { key: 'steady-4', stageCount: 4, taskWeights: [0.8, 1.1, 1.1, 0.9], difficultyCurve: [3, 5, 6, 8] },
  { key: 'twist-5', stageCount: 5, taskWeights: [0.7, 1.0, 1.3, 0.9, 0.8], difficultyCurve: [3, 5, 7, 6, 8] },
  { key: 'marathon-6', stageCount: 6, taskWeights: [0.7, 1, 1.2, 1.2, 1, 0.8], difficultyCurve: [2, 4, 5, 7, 6, 9] },
];

// ═══════════════════════════════════════════════════════════════════════════
// 3. Small total helpers
// ═══════════════════════════════════════════════════════════════════════════

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Collapse every run of whitespace, so a description is always one paragraph. */
const oneParagraph = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * A mulberry32. Exported so tests and the determinism guarantee share ONE
 * generator rather than the tests inventing their own — "same seed, same game"
 * is only meaningful against a fixed sequence.
 */
export function seededRng(seed: number): () => number {
  let a = (num(seed) ?? 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One draw in [0, 1), whatever the caller's rng does.
 *
 * A rng returning NaN, a negative, or exactly 1 would walk a cumulative-sum
 * picker off the end of its array and yield `undefined` — a crash three frames
 * later, in code that looks correct.
 */
function draw(rng: unknown): number {
  if (typeof rng !== 'function') return 0;
  let v: unknown;
  try {
    v = (rng as () => number)();
  } catch {
    return 0;
  }
  const n = num(v);
  if (n === null) return 0;
  if (n < 0) return 0;
  if (n >= 1) return 1 - Number.EPSILON;
  return n;
}

/** Sanitised tag list — unknown ids, duplicates and non-strings dropped. */
function safeTags(value: unknown): BankTagId[] {
  if (!Array.isArray(value)) return [];
  const out: BankTagId[] = [];
  for (const t of value) if (isBankTagId(t) && !out.includes(t)) out.push(t);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Answers → a scoring context
// ═══════════════════════════════════════════════════════════════════════════

function safeAudience(v: unknown): AudienceTagId {
  return (AUDIENCE_TAG_IDS as readonly string[]).includes(str(v))
    ? (v as AudienceTagId)
    : 'mixed';
}

function safeSetting(v: unknown): SettingTagId {
  return (SETTING_TAG_IDS as readonly string[]).includes(str(v))
    ? (v as SettingTagId)
    : 'fromAnywhere';
}

function safePreference(v: unknown): DifficultyPreference {
  return v === 'easy' || v === 'hard' || v === 'balanced' ? v : 'balanced';
}

/** The age band's lower bound. An unknown band falls back to the median band. */
function ageFloorFor(bandId: unknown): number {
  const band = AGE_BANDS.find((b) => b.id === str(bandId));
  if (band && num(band.from) !== null) return band.from;
  const fallback = AGE_BANDS[2] ?? AGE_BANDS[0];
  return num(fallback?.from) ?? 0;
}

/**
 * Turn answers plus a recency memory into a scoring context.
 *
 * Total: every unknown or malformed answer resolves to a usable default rather
 * than propagating into the scorer, so `fitScore` itself never has to guard.
 */
export function buildFitContext(answers: unknown, recent: unknown): FitContext {
  const a = (answers ?? {}) as Partial<ComposerAnswers>;

  const recentKeys = Array.isArray((recent as RecentPickState | undefined)?.recentBankKeys)
    ? (recent as RecentPickState).recentBankKeys
    : [];
  const recentIndex = new Map<string, number>();
  let position = 0;
  for (const k of recentKeys) {
    if (typeof k !== 'string' || k === '') continue;
    if (!recentIndex.has(k)) recentIndex.set(k, position);
    position++;
  }

  return {
    audience: safeAudience(a.audience),
    setting: safeSetting(a.setting),
    stageTarget: 5,
    ageFrom: ageFloorFor(a.ageBandId),
    preferredTags: safeTags(a.preferredTags),
    prepTolerance: prepToleranceOf(a.prepEffort),
    // Neutral, unknown and absent all resolve to an EMPTY list — see
    // `occasionProfile`, which never guesses a bias from a malformed answer.
    favouredTags: occasionProfile(a.occasion).favouredTags,
    // Level 4 and up. Level 2-3 pin missions too (`prepWantsPlacedMissions`),
    // but only level 4 says the creator is going there beforehand, which is what
    // makes a located mission worth preferring rather than merely tolerable.
    placedPreference: prepWantsPlacedMissions(a.prepEffort) && (num(a.prepEffort) ?? 0) >= 4,
    // Sanitised the same way as preferredTags, then narrowed to real area ids, so
    // a stray tag in the answers cannot silently become an area filter.
    areas: safeTags(a.areas).filter((t): t is AreaTagId =>
      (AREA_TAG_IDS as readonly string[]).includes(t)),
    usedKeys: new Set<string>(),
    usedFamilies: new Set<string>(),
    recentIndex,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Fit score
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How well one mission suits one slot.
 *
 * Same weighted-sum-of-named-terms shape as
 * functions/src/routing/assignNextTask.ts's `priorityScore`, with runtime terms
 * swapped for authoring-time ones.
 *
 * `-Infinity` is the hard exclusion: already used, unplayable without a venue the
 * creator does not have, or wrong for a bookend slot. Everything else is soft —
 * in particular AGE, which must never empty a pool. A band below every
 * candidate's floor still has to yield a game.
 */
export function fitScore(entry: TaskBankEntry, ctx: FitContext): number {
  if (!entry || typeof entry !== 'object') return -Infinity;
  const tags = Array.isArray(entry.tags) ? entry.tags : [];

  // ── Hard filters, before any arithmetic ───────────────────────────────────
  if (ctx.usedKeys?.has(entry.key)) return -Infinity;
  // A DIFFERENT key that is the same mechanic under different content — see
  // TaskBankEntry.family. Excluded exactly like an exact repeat, not merely
  // penalised: two "collect items by colour" missions in one game is the
  // composer visibly repeating itself, not a fit issue a lower score fixes.
  if (entry.family && ctx.usedFamilies?.has(entry.family)) return -Infinity;
  if (ctx.requiredTag && !tags.includes(ctx.requiredTag)) return -Infinity;
  // The creator's prep budget. A hard exclusion because "I am not coordinating
  // with a business" describes their world, not their taste — see
  // ComposerAnswers.prepEffort.
  if (prepTierOf(tags) > (num(ctx.prepTolerance) ?? 1)) return -Infinity;
  // "No venue" makes a location-only mission literally unplayable.
  if (ctx.setting === 'fromAnywhere' && tags.includes('locationBased') && !tags.includes('fromAnywhere')) {
    return -Infinity;
  }

  // ── Soft terms ────────────────────────────────────────────────────────────
  const audienceMatch = tags.includes(ctx.audience) ? 1
    : tags.includes('mixed') ? MIXED_AUDIENCE_MATCH
      : 0;

  const settingMatch = tags.includes(ctx.setting) ? 1
    : tags.includes('fromAnywhere') ? ANYWHERE_SETTING_MATCH
      : 0;

  const difficulty = num(entry.difficulty) ?? 5;
  const target = num(ctx.stageTarget) ?? 5;
  // 9 is the widest possible gap on a 1-10 scale, so this never goes negative.
  const difficultyFit = clamp(1 - Math.abs(difficulty - target) / 9, 0, 1);

  const minAge = num(entry.minAge);
  const ageFrom = num(ctx.ageFrom) ?? 0;
  const ageFit = minAge === null || minAge <= ageFrom
    ? 1
    : clamp(1 - (minAge - ageFrom) / AGE_FIT_SPAN, AGE_FIT_FLOOR, 1);

  // Guarded against an empty list: `overlap / 0` is NaN, and one NaN poisons the
  // whole sum — every candidate would score NaN and the band would come out empty.
  const preferred = Array.isArray(ctx.preferredTags) ? ctx.preferredTags : [];
  const preferredOverlap = preferred.length === 0
    ? 0
    : preferred.filter((t) => tags.includes(t)).length / preferred.length;

  // Area fit. NEUTRAL, not zero, when either side is silent: a creator who skipped
  // the question and a mission that suits anywhere are both "no information", and
  // scoring those as a mismatch would quietly rank every place-agnostic mission
  // below every tagged one for no reason a creator could understand.
  const wantedAreas = Array.isArray(ctx.areas) ? ctx.areas : [];
  const missionAreas = tags.filter((t) => (AREA_TAG_IDS as readonly string[]).includes(t));
  const areaFit = wantedAreas.length === 0 || missionAreas.length === 0
    ? AREA_NEUTRAL_FIT
    : (missionAreas.some((a) => wantedAreas.includes(a as AreaTagId)) ? 1 : 0);

  const base = TERM_WEIGHTS.audience * audienceMatch
    + TERM_WEIGHTS.setting * settingMatch
    + TERM_WEIGHTS.area * areaFit
    + TERM_WEIGHTS.difficulty * difficultyFit
    + TERM_WEIGHTS.age * ageFit
    + TERM_WEIGHTS.preferred * preferredOverlap;

  return base
    + occasionBonus(tags, ctx.favouredTags)
    + (ctx.placedPreference === true && tags.includes('locationBased') ? PLACED_PREFERENCE_BONUS : 0)
    - recencyPenalty(entry.key, ctx.recentIndex);
}

/**
 * How much this mission suits the occasion.
 *
 * The share of the occasion's favoured tags the mission carries, times a bounded
 * bonus. Exactly ZERO when nothing is favoured — not a small number, zero — so
 * the neutral occasion reproduces the pre-occasion score bit for bit, which is
 * what keeps every other composer suite (all of which compose with no occasion)
 * meaningful.
 *
 * Additive and soft. It lifts a favoured mission; it never excludes an
 * unfavoured one. The creator's other answers have already narrowed the pool,
 * and a mere preference that empties it drops the whole game.
 */
function occasionBonus(tags: readonly string[], favoured: readonly BankTagId[] | undefined): number {
  if (!Array.isArray(favoured) || favoured.length === 0) return 0;
  const hits = favoured.filter((t) => tags.includes(t)).length;
  return (OCCASION_BONUS * hits) / favoured.length;
}

/**
 * How much a recent use costs, decaying linearly to nothing at the window edge.
 *
 * Bounded by RECENCY_MAX_PENALTY and strictly below the score range, so it can
 * reorder candidates but can never veto one — a saturated memory must still
 * yield a game.
 */
function recencyPenalty(key: string, recentIndex: Map<string, number> | undefined): number {
  if (!recentIndex) return 0;
  const i = recentIndex.get(key);
  if (i === undefined || i >= RECENCY_WINDOW) return 0;
  return RECENCY_MAX_PENALTY * (1 - i / RECENCY_WINDOW);
}

/**
 * Sample one candidate from the band of near-best scorers.
 *
 * NOT argmax. Always taking the single best makes the whole feature a template
 * with extra steps: same answers, same bank, same game, forever. A narrow band
 * keeps every pick well-fitted while letting two generations differ.
 *
 * Consumes exactly one draw. Ties break on `key` ascending — float sums tie often
 * enough that relying on sort stability would make determinism engine-dependent.
 */
export function pickFromBand<T extends BandCandidate>(candidates: T[], rng: () => number): T | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const usable = candidates.filter((c) => c && num(c.score) !== null && c.score > -Infinity);
  if (usable.length === 0) return null;

  const ordered = [...usable].sort((a, b) => (b.score - a.score) || a.key.localeCompare(b.key));
  const best = ordered[0].score;
  const band = ordered.filter((c) => c.score >= best - TOP_K_MARGIN);

  const floor = band[band.length - 1].score;
  const weights = band.map((c) => (c.score - floor) + BAND_EPSILON);
  const total = weights.reduce((a, w) => a + w, 0);

  const target = draw(rng) * total;
  let running = 0;
  for (let i = 0; i < band.length; i++) {
    running += weights[i];
    if (target < running) return band[i];
  }
  // Float drift only — the last band member is the correct answer.
  return band[band.length - 1];
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Budget and blueprints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How many missions a requested duration is worth.
 *
 * Clamped to the supported range AND to the bank. The bank clamp is load-bearing:
 * asking for more missions than exist does not error, it produces unfillable
 * slots, then dropped stages, then a game quietly shorter than a shorter answer
 * would have produced.
 */
export function targetTaskCount(
  minutes: unknown,
  usableBankSize: unknown,
  minutesPerMission: unknown = MINUTES_PER_TASK,
): number {
  const size = Math.max(0, Math.floor(num(usableBankSize) ?? 0));
  if (size === 0) return 0;

  // A third argument, not a replacement: the real per-mission cost comes from
  // the eligible pool (see averageMissionCost), and MINUTES_PER_TASK survives
  // only as the fallback for a pool that cannot price itself.
  const perMission = num(minutesPerMission);
  const cost = perMission !== null && perMission > 0 ? perMission : MINUTES_PER_TASK;

  const m = num(minutes);
  const wanted = m === null || m <= 0
    ? MIN_TASKS
    : Math.round(m / cost);

  const ranged = clamp(wanted, MIN_TASKS, MAX_TASKS);
  return Math.min(ranged, size);
}

/**
 * Interaction minutes per bank entry, memoised on the entry's key.
 *
 * `build()` mints a fresh id every call but the fields the duration model reads
 * are fixed content, so the answer is stable and worth caching: sizing a game
 * would otherwise rebuild all 53 missions on every composition.
 */
const interactionCache = new Map<string, number>();

function interactionMinutes(entry: TaskBankEntry): number {
  const key = typeof entry?.key === 'string' ? entry.key : '';
  const hit = interactionCache.get(key);
  if (hit !== undefined) return hit;

  let minutes = 0;
  try {
    minutes = num(effectiveExpectedDurationMinutes(entry.build())) ?? 0;
  } catch {
    minutes = 0;
  }
  if (key !== '') interactionCache.set(key, minutes);
  return minutes;
}

/**
 * What one mission really costs a team: doing it, plus getting to it.
 *
 * The whole reason the composer stopped believing a single global constant. A
 * `fromAnywhere` mission costs only its interaction; a sited one also costs its
 * own declared walk. Averaged over the ELIGIBLE pool, this makes the budget
 * setting-aware for free — an outdoor pool prices in walking, a play-from-
 * anywhere pool does not, without either being special-cased.
 */
export function missionCostMinutes(entry: TaskBankEntry, walkMinutes = 0): number {
  if (!entry || typeof entry !== 'object') return 0;
  const declared = Math.max(0, num(entry.transitMinutes) ?? 0);
  // An authored figure always wins: it names a real leg of a real route, which a
  // setting-wide default never can. `walkMinutes` only fills the gap for missions
  // that declare none — the play-from-anywhere ones.
  const walk = Math.max(0, num(walkMinutes) ?? 0);
  const transit = declared === 0 && siteableInPlacedGame(entry) ? walk : declared;
  return interactionMinutes(entry) + MISSION_OVERHEAD_MINUTES + transit;
}

/**
 * Does the creator want missions to have real places?
 *
 * `fromAnywhere` is the "no venue" answer; anything else is a game happening
 * somewhere, where a pin is meaningful.
 */
/**
 * The walk to add to a mission that carries none of its own, for this setting —
 * ONLY when the creator asked for located missions (see `wantsPlacedMissions`).
 *
 * Zero with no venue (there is nowhere to walk to), a short hop indoors, a real
 * leg outdoors, when asked for. Never invented as a default.
 */
function walkMinutesFor(setting: SettingTagId): number {
  if (setting === 'outdoor') return PLACED_TRANSIT_MINUTES;
  if (setting === 'indoor') return INDOOR_WALK_MINUTES;
  return 0;
}

/**
 * Does the creator want missions pinned to real spots?
 *
 * Used to be inferred from `setting === 'outdoor'` alone — any outdoor answer
 * silently turned every play-from-anywhere mission into a required map pin. That
 * is a real, useful shape for a walking race, but it is also a DECISION about how
 * the game is run, and inferring it from "the event has a park" quietly made that
 * decision for the creator. An office day that only wanted a normal indoor game
 * came out needing pins anyway once outdoor content mixed in, and a creator who
 * wanted the routed version had no way to ask for it explicitly either.
 *
 * So it is now its own answer, defaulting to NO — every setting behaves like a
 * no-venue game for siting purposes unless the creator opts in — and when they
 * do, the composer shows them which missions are play-from-anywhere and walks
 * them through pinning each one via Quick Setup (`siteableInPlacedGame` below),
 * the same guided flow the harvested location-based missions already use.
 */
function wantsPlacedMissions(setting: SettingTagId, locationMissions: boolean): boolean {
  return setting !== 'fromAnywhere' && locationMissions === true;
}

/**
 * Can this play-from-anywhere mission be pinned to a spot?
 *
 * A team can build a pyramid or film a news report anywhere — including at a
 * place the creator chooses. Excluding those from a located game was leaving the
 * best content on the shelf: the youth bank has eight of them and only seven
 * missions that are sited by nature, so a walking race was being built from half
 * the pool. In a located game they are offered a pin through Quick Setup instead.
 *
 * A mission already tied to a place is not "siteable" — it is simply sited.
 */
export function siteableInPlacedGame(entry: TaskBankEntry): boolean {
  const tags = Array.isArray(entry?.tags) ? entry.tags : [];
  return tags.includes('fromAnywhere') && !tags.includes('locationBased');
}

/**
 * Mean real cost across a pool, for sizing before any mission is chosen.
 *
 * Falls back to `MINUTES_PER_TASK` only when the pool cannot answer (empty, or
 * every entry priced at zero) — a fallback, no longer the model.
 */
export function averageMissionCost(pool: readonly TaskBankEntry[], walkMinutes = 0): number {
  if (!Array.isArray(pool) || pool.length === 0) return MINUTES_PER_TASK;
  let total = 0;
  for (const e of pool) total += missionCostMinutes(e, walkMinutes);
  const mean = total / pool.length;
  return mean > 0 ? mean : MINUTES_PER_TASK;
}

/** The blueprints that can hold this budget with at least one mission per stage. */
export function eligibleBlueprints(target: unknown): StageBlueprint[] {
  const t = num(target) ?? 0;
  return STAGE_BLUEPRINTS.filter((b) => b.stageCount * MIN_MISSIONS_PER_STAGE <= t);
}

/**
 * Spread the budget across a blueprint's stages.
 *
 * Largest-remainder over `taskWeights`, floor of 1 per stage, ties to the lower
 * stage index. Pure and exact: the result always sums to the budget, which is
 * where an off-by-one would otherwise hide as a missing or extra mission.
 */
export function distributeTaskCounts(blueprint: StageBlueprint, target: unknown): number[] {
  const n = Math.max(1, Math.floor(num(blueprint?.stageCount) ?? 1));
  const weights = Array.isArray(blueprint?.taskWeights) && blueprint.taskWeights.length === n
    ? blueprint.taskWeights.map((w) => Math.max(0, num(w) ?? 0))
    : Array.from({ length: n }, () => 1);

  const wanted = Math.max(n, Math.floor(num(target) ?? n));

  // Every stage starts at its floor; only the surplus is distributed.
  const counts = Array.from({ length: n }, () => 1);
  let remaining = wanted - n;
  if (remaining <= 0) return counts;

  const weightTotal = weights.reduce((a, w) => a + w, 0) || n;
  const exact = weights.map((w) => (remaining * w) / weightTotal);
  const floors = exact.map((v) => Math.floor(v));

  for (let i = 0; i < n; i++) counts[i] += floors[i];
  remaining -= floors.reduce((a, v) => a + v, 0);

  // Hand out what rounding left over, largest fractional part first.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  for (let k = 0; remaining > 0; k++, remaining--) counts[order[k % n].i] += 1;

  return counts;
}

/** One eligible blueprint, uniformly at random. Consumes exactly one draw. */
export function pickBlueprint(eligible: StageBlueprint[], rng: () => number): StageBlueprint | null {
  if (!Array.isArray(eligible) || eligible.length === 0) return null;
  const i = Math.min(eligible.length - 1, Math.floor(draw(rng) * eligible.length));
  return eligible[i];
}

/**
 * The occasion's own stage shape, when the budget can hold it.
 *
 * A wedding is not a team-building day: guests are dressed up and not walking
 * far, so it wants few stages holding many missions each, while a team-building
 * day wants a real arc with a twist in the middle. Held to the SAME eligibility
 * rule as the authored blueprints, so an occasion can never force a stage the
 * budget cannot fill.
 *
 * Returns null for the neutral occasion, an unknown one, or a budget too small —
 * all three mean "keep the random pick".
 */
export function occasionBlueprint(occasion: unknown, budget: unknown): StageBlueprint | null {
  const b = occasionProfile(occasion).blueprint;
  if (!b) return null;
  return b.stageCount * MIN_MISSIONS_PER_STAGE <= (num(budget) ?? 0) ? b : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Description and tags
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The activity kinds actually present among the chosen missions, most common
 * first, registry order as the tie-break, capped.
 *
 * "Actually present" is the whole point: a description naming a kind the game
 * does not contain is a confident lie on the creator's own game card.
 */
function namedActivities(entries: TaskBankEntry[]): ActivityTagId[] {
  const counts = new Map<ActivityTagId, number>();
  for (const e of entries) {
    for (const t of e.tags ?? []) {
      if ((ACTIVITY_TAG_IDS as readonly string[]).includes(t)) {
        const id = t as ActivityTagId;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (ACTIVITY_TAG_IDS.indexOf(a[0]) - ACTIVITY_TAG_IDS.indexOf(b[0])))
    .slice(0, MAX_NAMED_ACTIVITIES)
    .map(([id]) => id);
}

/** Every copy call is guarded — a caller's `t.*` must never be able to throw here. */
function copyCall(fn: unknown, ...args: unknown[]): string {
  if (typeof fn !== 'function') return '';
  try {
    return str((fn as (...a: unknown[]) => unknown)(...args));
  } catch {
    return '';
  }
}

function composerDescription(
  answers: { people: number; minutes: number; ageBandId: string },
  activities: ActivityTagId[],
  copy: ComposerDescriptionCopy,
): string {
  const ageLabel = copyCall(copy?.ageLabel, answers.ageBandId);
  const lead = oneParagraph(copyCall(copy?.composedLead, {
    people: answers.people,
    minutes: answers.minutes,
    ageLabel,
  }));

  const phrases = activities
    .map((t) => oneParagraph(copyCall(copy?.activityPhrase, t)))
    .filter((p) => p !== '');

  const joined = phrases.length === 0 ? '' : oneParagraph(copyCall(copy?.activityJoin, phrases));

  // A COMMA, not a full stop. The activity clause is a continuation ("…about 90
  // minutes, with photo missions"), and a full stop would start a new sentence
  // with a lowercase connector. Capitalising instead would be wrong for Hebrew,
  // which has no capitals — a comma reads correctly in both languages.
  const full = !lead ? joined : !joined ? lead : `${lead}, ${joined}`;
  return oneParagraph(full).slice(0, MAX_BLENDED_DESCRIPTION_LEN);
}

/**
 * Give every stage a name.
 *
 * A composed game used to ship every stage titled `''`. Nothing rejected it —
 * the Builder has an "untitled stage" fallback and rendered that on every row,
 * the stage picker fell back to "Stage 1", and Quick Setup announced every step
 * as being in a stage with no name. So the one output a creator was told is a
 * finished game arrived looking like a draft, while every hand-authored template
 * names its stages.
 *
 * Names are drawn AFTER mission selection, deliberately: the selection draw
 * sequence stays byte-identical to what it was before naming existed, so a seed
 * that produced a given set of missions still produces exactly those missions.
 *
 * Total. A copy list that is absent, empty, throwing, or full of blanks leaves
 * the title `''` and the Builder's existing fallback covers it — a nameless
 * stage is a cosmetic miss, and is never worth taking the game down for.
 */
function nameStages(
  stages: Stage[],
  copy: ComposerDescriptionCopy,
  rng: () => number,
  occasion?: OccasionId,
): void {
  /** The occasion's titles first, the generic ones when it has none. */
  const rawFor = (role: StageRole): unknown => {
    if (occasion !== undefined && typeof copy?.occasionStageNames === 'function') {
      try {
        const own = copy.occasionStageNames(occasion, role);
        // A short-but-present list is honoured; only an absent or empty one
        // falls through, so a caller with titles for three of the five occasions
        // still gets the generic set for the other two.
        if (Array.isArray(own) && own.length > 0) return own;
      } catch {
        // Fall through to the generic list — a throwing copy callback is never
        // worth taking a stage's title down for.
      }
    }
    if (typeof copy?.stageNames !== 'function') return [];
    try {
      return copy.stageNames(role);
    } catch {
      return [];
    }
  };

  const listFor = (role: StageRole): string[] => {
    const raw = rawFor(role);
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of raw) {
      const name = oneParagraph(str(v));
      if (name === '' || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
    return out;
  };

  const used = new Set<string>();
  const pick = (role: StageRole): string => {
    const list = listFor(role);
    if (list.length === 0) return '';
    // Prefer a name this game has not spent yet, so a six-stage game does not
    // print the same middle name three times. Once the list is exhausted the
    // whole list is back in play — repeating beats going blank.
    const fresh = list.filter((n) => !used.has(n));
    const pool = fresh.length > 0 ? fresh : list;
    const name = pool[Math.min(pool.length - 1, Math.floor(draw(rng) * pool.length))];
    used.add(name);
    return name;
  };

  const last = stages.length - 1;
  stages.forEach((stage, i) => {
    stage.title = pick(i === 0 ? 'opener' : i === last ? 'finale' : 'middle');
  });
}

function composerTags(
  answers: { people: number; minutes: number; ageBandId: string },
  activities: ActivityTagId[],
  copy: ComposerDescriptionCopy,
): string[] {
  const derived = (() => {
    try {
      return derivedGameTags(answers, copy);
    } catch {
      return [];
    }
  })();

  const activityWords = activities
    .map((t) => copyCall(copy?.activityTag, t))
    .filter((w) => w.trim() !== '');

  // Through the SHARED normaliser, so the clamp, dedupe and separator rules
  // cannot drift from what `updateGame` enforces on the way in.
  return normalizeTags([...derived, ...activityWords]).slice(0, MAX_TAGS);
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Fingerprint
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The id-free shape of a result.
 *
 * Ids are minted fresh on every run, so "the same game" can only ever mean "the
 * same game apart from its ids". Exported rather than left to the test, so
 * there is exactly one definition of what that means.
 */
export function composerFingerprint(result: ComposerResult): unknown {
  if (!result) return null;
  const taskIndex = new Map<string, string>();
  result.stages.forEach((s, si) => s.tasks.forEach((t, ti) => taskIndex.set(t.id, `${si}:${ti}`)));

  return {
    blueprintKey: result.blueprintKey,
    usedBankKeys: result.usedBankKeys,
    description: result.description,
    tags: result.tags,
    scoringPreset: result.scoringPreset,
    mode: result.mode,
    estimatedMinutes: result.estimatedMinutes,
    stages: result.stages.map((s) => ({
      title: s.title,
      order: s.order,
      isFinal: s.isFinal === true,
      requiredTaskCount: s.requiredTaskCount,
      taskCount: s.tasks.length,
      taskTitles: s.tasks.map((t) => t.title),
    })),
    wizardSteps: result.wizardSteps.map((w) => ({
      field: w.targetFieldPath,
      prompt: w.instructionPrompt,
      required: w.isRequired === true,
      // The POSITION of the mission, never its id.
      at: taskIndex.get(w.taskId) ?? '',
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. The composer
// ═══════════════════════════════════════════════════════════════════════════

/** A slot waiting to be filled: which stage, which position, what it must be. */
interface Slot {
  stage: number;
  index: number;
  requiredTag?: BookendTagId;
}

/**
 * The missions this answer set can actually use.
 *
 * Shared by `composeGame` and `previewComposition` so the count a creator is
 * shown BEFORE pressing the button is produced by the same filter that then
 * builds the game. A preview derived independently would drift the first time
 * either side was tuned, and the creator would be told one number and handed
 * another — which is worse than showing nothing at all.
 */
export function usableBankFor(bank: readonly TaskBankEntry[], ctx: FitContext): TaskBankEntry[] {
  if (!Array.isArray(bank)) return [];
  return bank.filter((e) =>
    e
    && typeof e === 'object'
    && typeof e.key === 'string'
    && e.key !== ''
    && typeof e.build === 'function'
    && fitScore(e, { ...ctx, stageTarget: 5 }) > -Infinity);
}

/** What a set of answers is worth, without minting a game. */
export interface CompositionPreview {
  /**
   * How many missions the composed game will hold.
   *
   * Deterministic given the answers — the budget depends only on the requested
   * duration, the eligible pool and its average cost, none of which involve the
   * rng. Which missions get chosen, and the stage shape, are NOT deterministic,
   * which is why neither is previewed here.
   */
  missionCount: number;
  /** False when the bank cannot make a game from these answers at all. */
  possible: boolean;
}

/**
 * What the creator is about to get.
 *
 * Answers the one question the questionnaire could not: "how big is this
 * going to be?" Six questions then a finished game in the Builder is a lot of
 * commitment on faith; a single honest number on the last screen makes the
 * final tap an informed one.
 *
 * Deliberately reports ONLY the mission count. Stage count comes from a
 * randomly drawn blueprint and the mission list from band sampling, so
 * previewing either would show the creator a game they are not going to get.
 */
export function previewComposition(
  bank: readonly TaskBankEntry[],
  answers: ComposerAnswers,
): CompositionPreview {
  const ctx = buildFitContext(answers, { recentBankKeys: [] });
  const usable = usableBankFor(bank, ctx);
  if (usable.length === 0) return { missionCount: 0, possible: false };

  const walk = walkMinutesFor(ctx.setting);
  const minutes = num((answers ?? {} as Partial<ComposerAnswers>).minutes);
  const budget = targetTaskCount(minutes, usable.length, averageMissionCost(usable, walk));
  return { missionCount: Math.max(0, budget), possible: budget > 0 };
}

export function composeGame(
  bank: readonly TaskBankEntry[],
  answers: ComposerAnswers,
  copy: ComposerDescriptionCopy,
  rng: () => number = Math.random,
  recent: RecentPickState = { recentBankKeys: [] },
): ComposerResult | null {
  // ── 1. The usable bank ────────────────────────────────────────────────────
  if (!Array.isArray(bank)) return null;

  const ctx = buildFitContext(answers, recent);
  const a = (answers ?? {}) as Partial<ComposerAnswers>;
  const preference = safePreference(a.difficultyPreference);
  const people = Math.max(1, Math.floor(num(a.people) ?? 1));
  const minutes = num(a.minutes);
  const ageBandId = str(a.ageBandId);

  const usable = usableBankFor(bank, ctx);

  if (usable.length === 0) return null;

  // ── 2. Budget ─────────────────────────────────────────────────────────────
  // Priced from the ELIGIBLE pool, not a global constant: the same answer asks
  // for more missions when they are played from anywhere (no walking) than when
  // each one costs a walk to reach it.
  // Does the creator want missions put on a map? An explicit answer, not an
  // inference from setting (see wantsPlacedMissions) — it changes what a
  // mission costs (a pinned mission gains a walk) and therefore how many fit.
  const locationMissions = a.locationMissions === true;
  const placedGame = wantsPlacedMissions(ctx.setting, locationMissions);
  // NOT gated on `placedGame`. Walking is a property of the VENUE, not of
  // whether the creator opted into pinning: a team crosses the mall between
  // missions whether or not each one carries a map pin. Gating it here made an
  // hour-long indoor game price every mission as if it were played standing
  // still, so it asked for more missions than the bank could supply and reported
  // a shortfall that was really a costing error. Only `fromAnywhere` — no venue
  // at all — genuinely has nowhere to walk to, and `walkMinutesFor` already
  // returns 0 for it.
  const walk = walkMinutesFor(ctx.setting);
  const placePrompt = oneParagraph(copyCall(copy?.placeMissionPrompt));
  const budget = targetTaskCount(minutes, usable.length, averageMissionCost(usable, walk));
  if (budget <= 0) return null;

  // ── 3-4. Blueprint (one draw) ─────────────────────────────────────────────
  const eligible = eligibleBlueprints(budget);
  // A budget too small for any authored blueprint: synthesize the shape that
  // keeps stages worth entering — as many stages as the budget can feed at
  // MIN_MISSIONS_PER_STAGE, never one mission each.
  const synthStages = clamp(Math.floor(budget / MIN_MISSIONS_PER_STAGE), 1, 3);
  // The draw happens FIRST and unconditionally, even when the occasion is about
  // to override it. Every later decision — band sampling, stage naming — reads
  // the same seeded stream, so a branch that consumed one fewer draw would shift
  // all of them, and two occasions would then differ in ways that have nothing
  // to do with the occasion.
  const drawn = eligible.length > 0
    ? pickBlueprint(eligible, rng)
    : {
      key: `compact-${synthStages}`,
      stageCount: synthStages,
      taskWeights: Array.from({ length: synthStages }, () => 1),
      difficultyCurve: Array.from({ length: synthStages }, (_, i) =>
        clamp(3 + Math.round((i * 5) / Math.max(1, synthStages - 1)), 1, 10)),
    };
  const blueprint = occasionBlueprint(a.occasion, budget) ?? drawn;
  if (!blueprint) return null;

  // ── 5. Per-stage counts ───────────────────────────────────────────────────
  const counts = distributeTaskCounts(blueprint, budget);
  const stageCount = counts.length;

  // ── 6. Slot order — bookends FIRST (see the module header) ────────────────
  const lastStage = stageCount - 1;
  const slots: Slot[] = [
    { stage: 0, index: 0, requiredTag: 'start' },
    { stage: lastStage, index: counts[lastStage] - 1, requiredTag: 'finish' },
  ];
  for (let s = 0; s < stageCount; s++) {
    for (let i = 0; i < counts[s]; i++) {
      if (slots.some((x) => x.stage === s && x.index === i)) continue;
      slots.push({ stage: s, index: i });
    }
  }

  // ── 7. Fill (one draw per slot) ───────────────────────────────────────────
  const shift = DIFFICULTY_SHIFT[preference];
  const stageTargets = Array.from({ length: stageCount }, (_, i) =>
    clamp((num(blueprint.difficultyCurve?.[i]) ?? 5) + shift, 1, 10));

  const chosen: (TaskBankEntry | null)[][] = Array.from({ length: stageCount }, (_, s) =>
    Array.from({ length: counts[s] }, () => null));

  for (const slot of slots) {
    const slotCtx: FitContext = {
      ...ctx,
      stageTarget: stageTargets[slot.stage],
      ...(slot.requiredTag ? { requiredTag: slot.requiredTag } : {}),
    };

    const candidates: BandCandidate[] = [];
    for (const e of usable) {
      const score = fitScore(e, slotCtx);
      if (score > -Infinity) candidates.push({ key: e.key, score });
    }

    const picked = pickFromBand(candidates, rng);
    if (!picked) continue; // pool exhausted — the slot is dropped, never faked

    const entry = usable.find((e) => e.key === picked.key);
    if (!entry) continue;
    chosen[slot.stage][slot.index] = entry;
    ctx.usedKeys.add(entry.key);
    if (entry.family) ctx.usedFamilies.add(entry.family);
  }

  // ── 8. Build the stages ───────────────────────────────────────────────────
  const stages: Stage[] = [];
  const usedEntries: TaskBankEntry[] = [];
  const wizardSteps: TemplateWizardStep[] = [];
  let slotCounter = 0;

  for (let s = 0; s < stageCount; s++) {
    const tasks: Task[] = [];
    const stageId = uuid();

    for (const entry of chosen[s]) {
      if (!entry) continue;
      let task: Task;
      try {
        task = entry.build();
      } catch {
        // A broken mission is skipped, never allowed to take the game down.
        continue;
      }
      if (!task || typeof task !== 'object' || typeof task.id !== 'string') continue;

      // A play-from-anywhere mission in a game that HAS places gets pinned: the
      // creator picks the spot, and Quick Setup below asks them for it. Without
      // this the walking race quietly drew from half its pool.
      // Siting a mission makes its pin REQUIRED, so it is only safe when we can
      // actually ask for that pin. With no prompt to show, the creator would meet
      // a mandatory blank field with no explanation — leave the mission playable
      // from anywhere instead.
      const siteIt = placedGame && placePrompt !== '' && siteableInPlacedGame(entry);
      if (siteIt) {
        task.locationless = false;
        task.triggerMode = 'radius';
      }

      tasks.push(task);
      usedEntries.push(entry);

      // Quick Setup, bound to the id just minted — no positional resolution step
      // that could ever go stale.
      if (siteIt) {
        wizardSteps.push({
          id: `qs-${slotCounter}-placed-coordinates`,
          stageId,
          taskId: task.id,
          targetFieldPath: 'coordinates',
          instructionPrompt: placePrompt,
          // Required: the mission was just made location-gated, so an unplaced
          // one would strand a team at a pin that is not there.
          isRequired: true,
        });
      }
      for (const setup of entry.setup ?? []) {
        if (!setup || typeof setup.field !== 'string' || setup.field === '') continue;
        wizardSteps.push({
          id: `qs-${slotCounter}-${setup.field}`,
          stageId,
          taskId: task.id,
          targetFieldPath: setup.field,
          instructionPrompt: str(setup.prompt),
          isRequired: setup.required === true,
        });
      }
      slotCounter++;
    }

    // A stage with nothing in it is dropped rather than emitted empty — that is
    // what keeps "every stage has a mission" structural instead of lucky.
    if (tasks.length === 0) continue;

    stages.push({
      id: stageId,
      order: stages.length,
      title: '',
      requiredTaskCount: tasks.length,
      tasks,
    });
  }

  if (stages.length === 0) return null;

  // Re-stamp order and the single final flag AFTER any stage was dropped.
  stages.forEach((s, i) => {
    s.order = i;
    if (s.isFinal !== undefined) delete (s as Partial<Stage>).isFinal;
  });
  stages[stages.length - 1].isFinal = true;

  // ── 9. Pace it against the real missions ──────────────────────────────────
  // planDurationFit only trims a stage that is neither first nor last, is not
  // final, and ALREADY carries a positive requiredTaskCount — which is why step 8
  // sets an explicit count on every stage.
  const plan = planDurationFit(stages as unknown as PersonalizationStage[], minutes ?? undefined);
  for (const s of stages) {
    const override = plan.overrides[s.id];
    if (typeof override === 'number' && override >= 1) s.requiredTaskCount = override;
  }

  // ── 10. Presentation ──────────────────────────────────────────────────────
  // Named last, so every draw above kept the sequence it had before stages had
  // names at all (see nameStages).
  nameStages(stages, copy, rng, isOccasionId(a.occasion) ? a.occasion : undefined);

  const activities = namedActivities(usedEntries);

  // The honest total: what the chosen missions actually cost, walking included.
  // `planDurationFit` cannot see transit — it only knows interaction time — so
  // reporting its figure told a creator a sited two-hour game was a thirty-minute
  // one. Its verdict still drives the trim above; this is the number we publish.
  const realMinutes = usedEntries.reduce((sum, e) => sum + missionCostMinutes(e, walk), 0);

  const descriptionAnswers = {
    people,
    minutes: minutes !== null && minutes > 0 ? minutes : Math.round(realMinutes) || plan.estimatedMinutes,
    ageBandId,
  };

  return {
    stages,
    description: composerDescription(descriptionAnswers, activities, copy),
    tags: composerTags(descriptionAnswers, activities, copy),
    wizardSteps,
    scoringPreset: COMPOSED_SCORING_PRESET,
    mode: COMPOSED_MODE,
    estimatedMinutes: realMinutes > 0 ? Math.round(realMinutes) : Math.max(1, plan.estimatedMinutes),
    usedBankKeys: usedEntries.map((e) => e.key),
    blueprintKey: blueprint.key,
    ...(minutes !== null && minutes > 0 && realMinutes < minutes * SHORTFALL_RATIO
      ? {
        shortfall: {
          askedMinutes: minutes,
          estimatedMinutes: Math.round(realMinutes),
          namedPlaces: ctx.areas.length > 0,
        },
      }
      : {}),
  };
}

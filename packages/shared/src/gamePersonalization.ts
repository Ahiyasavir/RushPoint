// ─── Template personalization (change: guided-new-game-wizard) ───────────────
//
// The new-game wizard asks four questions — game type, group size, duration and
// age — and this module turns three of them into an actual game. (Type only picks
// which template to copy, which is the client's business, not this file's.)
//
// It lives in @rushpoint/shared, not in creator-web, because the SERVER applies
// these rules inside `createGameFromTemplate`: personalization has to happen in
// the same atomic write that creates the game, or a failure between the two steps
// leaves a half-personalized game in the creator's dashboard.
//
// Everything here is STRUCTURAL. Nothing in this file produces user-facing prose:
// the blended description and the derived tag WORDS are composed client-side,
// where the i18n dictionaries live, and arrive here as finished strings. The
// server never needs to know what language the creator is working in.
//
// ─── Three rules that can quietly ruin a game ────────────────────────────────
//
// 1. CAPACITY IS NOT DECORATION. `maxConcurrentTeams` is real station contention.
//    Handing a template authored for five teams to forty players queues everyone
//    at one stop; handing it to four players makes the limit meaningless. So it
//    scales with the group — but never to 0 (a 0-capacity task can never be handed
//    out at all) and never past the team count (which would delete contention as a
//    mechanic entirely).
//
// 2. SHORTENING MUST NOT CUT THE PLOT. Trimming an over-long game by lowering
//    `Stage.requiredTaskCount` is safe only on a stage whose author ALREADY
//    declared it partial. A stage that leaves the count unset means "do all of
//    these" — and in the story template ("פרוטוקול האפלה") that stage holds the
//    climax, `הקוד האחרון`. Trimming it would silently delete the payoff of a
//    six-stage plot, with nothing on screen to reveal the loss. The author already
//    told us which stages are optional; those are the only ones we may cut.
//
// 3. CONSENT GATES PLAY, NOT JUST DATA. `requiresGuardianConsent` holds a minor's
//    team until a guardian responds, so switching it on for an age band that does
//    not need it strands a group mid-event. See GUARDIAN_CONSENT_AGE_THRESHOLD.
//
// Every function is TOTAL: a malformed or missing answer skips its own rule and
// returns something usable. The alternative is a creator who mistyped one number
// and got no game at all.
//
// Unit-tested by scripts/test-game-personalization.ts (in `npm test`).
import type { GameMode } from './types';
import type { Task } from './types';
import { effectiveExclusiveGroups, maxCompletableTasks, type ExclusiveGroupLike } from './mutualExclusion';
import { effectiveExpectedDurationMinutes } from './taskDuration';
import { normalizeTags } from './tags';
import { validateMinAge } from './guardianConsent';

// ═══════════════════════════════════════════════════════════════════════════
// Constants — the only place any of these numbers appears
// ═══════════════════════════════════════════════════════════════════════════

/** At or below this many people, teams are meaningless and the game goes solo. */
export const SMALL_GROUP_MAX_PEOPLE = 5;

/**
 * A capacity at or above this means the author said "no queue here". Both real
 * templates already use exactly 100 on their survey / locationless tasks, so this
 * reads their existing intent rather than imposing a new convention.
 */
export const UNLIMITED_CAPACITY_THRESHOLD = 100;

/**
 * Below this age, guardian consent is switched ON automatically.
 *
 * 14, deliberately, and NOT 18. Israel is the launch market: its proposed minors'
 * privacy rules require parental consent to collect ANY information about a minor
 * under 14 (and sensitive information about a minor under 18), which squarely
 * covers the GPS tracks and photos this platform collects.
 *
 * 18 was the tempting "safe" number and is the wrong one operationally, because
 * this flag gates PLAY: defaulting it on for a 14–17 youth-movement group means
 * forty teenagers standing in a park unable to start while counsellors chase
 * parents on WhatsApp, at an event whose parents already consented to the outing
 * itself. 14–17 therefore records `minAge` and leaves the flag alone, so the
 * creator turns it on knowingly, before the day, when the consent links can
 * actually be sent ahead.
 *
 * A product default, not legal advice.
 */
export const GUARDIAN_CONSENT_AGE_THRESHOLD = 14;

/** Age at and above which no minor-related field is set at all. */
export const ADULT_AGE = 18;

/** People per team, used to turn a group size into a team count. */
export const TYPICAL_TEAM_SIZE = 5;

/**
 * The team count the existing templates read as though authored for. Capacity is
 * scaled relative to THIS, so a template's authored value is reproduced exactly
 * for a group of this size and moves proportionally either side of it.
 */
export const PERSONALIZATION_BASELINE_TEAMS = 5;

/**
 * Age bands offered by the wizard. `from` is what reaches `minAge`; `to` is absent
 * on the open-ended top band.
 *
 * The ids are MACHINE keys and are never rendered: the product's copy standard
 * forbids every hyphen and dash in user-facing text (scripts/test-no-dashes.ts),
 * so "14-17" is turned into words by the caller's dictionary rather than shown.
 */
export const AGE_BANDS: readonly { id: string; from: number; to?: number }[] = [
  { id: 'band-8-10', from: 8, to: 10 },
  { id: 'band-11-13', from: 11, to: 13 },
  { id: 'band-14-17', from: 14, to: 17 },
  { id: 'band-18-plus', from: 18 },
];

/** Duration options offered by the wizard, in minutes. */
export const DURATION_BANDS: readonly number[] = [60, 90, 120, 180];

/** The duration used when the creator skips the question. */
export const DEFAULT_DURATION_MINUTES = 90;

/** Group-size options offered by the wizard. `people` is the band's upper end. */
export const GROUP_SIZE_BANDS: readonly { id: string; people: number }[] = [
  { id: '<=5', people: 5 },
  { id: '6-15', people: 15 },
  { id: '16-30', people: 30 },
  { id: '31+', people: 40 },
];

/** The group size used when the creator skips the question. */
export const DEFAULT_GROUP_SIZE = 30;

// ═══════════════════════════════════════════════════════════════════════════
// Shapes
// ═══════════════════════════════════════════════════════════════════════════

/** The stage shape these rules need: exclusion data plus duration-bearing tasks. */
export interface PersonalizationStage {
  id: string;
  order?: number;
  isFinal?: boolean;
  requiredTaskCount?: number;
  exclusiveGroups?: ExclusiveGroupLike[];
  tasks: Task[];
}

/** Per-stage `requiredTaskCount` replacements, keyed by stage id. */
export type RequiredCountOverrides = Record<string, number>;

/** What `planDurationFit` decided. */
export interface DurationFitPlan {
  overrides: RequiredCountOverrides;
  estimatedMinutes: number;
  /** False when the game still overruns after every eligible stage was trimmed. */
  fits: boolean;
}

/** The minor-related fields an age answer produces. Absent means "don't write it". */
export interface ConsentSettings {
  minAge?: number;
  /** Only ever `true`. Never written as `false` — see `consentSettingsForAge`. */
  requiresGuardianConsent?: true;
}

const isPositive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Group size
// ═══════════════════════════════════════════════════════════════════════════

/** How many teams a group of `people` makes. Always at least 1. */
export function estimatedTeamCount(people: unknown): number {
  if (!isPositive(people)) return 1;
  return Math.max(1, Math.ceil(people / TYPICAL_TEAM_SIZE));
}

/**
 * A task's capacity for THIS group.
 *
 * Proportional to the authored value rather than replaced by it, so a template
 * that deliberately made one stop tighter than another keeps that relationship.
 * Bounded below by 1 and above by the team count.
 */
export function scaleTaskCapacity(authored: unknown, teamCount: unknown): number {
  const base = isPositive(authored) ? authored : 1;
  // "No queue here" is authorial intent about the task, not about the group.
  if (base >= UNLIMITED_CAPACITY_THRESHOLD) return base;
  if (!isPositive(teamCount)) return Math.max(1, base);
  const teams = Math.max(1, Math.floor(teamCount));
  const scaled = Math.round((base * teams) / PERSONALIZATION_BASELINE_TEAMS);
  return Math.min(teams, Math.max(1, scaled));
}

/**
 * The mode a group of this size should play in. Only ever moves a template TOWARD
 * `individual`, and only for a group too small for teams to mean anything.
 */
export function defaultModeForGroupSize(people: unknown, templateMode: GameMode): GameMode {
  if (!isPositive(people)) return templateMode;
  return people <= SMALL_GROUP_MAX_PEOPLE ? 'individual' : templateMode;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Age
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The minor-related fields for an answered age.
 *
 * `requiresGuardianConsent` is only ever produced as `true`. Writing `false` would
 * let an answered age silently switch OFF a safety setting the template author
 * deliberately turned on — a downgrade nobody asked for and nobody would notice.
 */
export function consentSettingsForAge(age: unknown): ConsentSettings {
  if (!isPositive(age)) return {};
  if (!Number.isInteger(age)) return {};
  if (!validateMinAge(age).ok) return {};
  if (age >= ADULT_AGE) return {};
  if (age < GUARDIAN_CONSENT_AGE_THRESHOLD) {
    return { minAge: age, requiresGuardianConsent: true };
  }
  return { minAge: age };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Duration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The durations a team could actually spend in this stage, longest first.
 *
 * An exclusive group yields ONE completion, so it contributes only its longest
 * member — mirroring `maxCompletableTasks`, which is the single definition of how
 * many tasks a stage can yield.
 */
function completableDurations(stage: PersonalizationStage): number[] {
  const tasks = Array.isArray(stage?.tasks) ? stage.tasks : [];
  const byId = new Map<string, Task>();
  for (const t of tasks) if (t && typeof t.id === 'string') byId.set(t.id, t);

  const groups = effectiveExclusiveGroups(stage);
  const grouped = new Set<string>();
  const out: number[] = [];

  for (const g of groups) {
    let longest = 0;
    for (const id of g) {
      grouped.add(id);
      const t = byId.get(id);
      if (t) longest = Math.max(longest, effectiveExpectedDurationMinutes(t));
    }
    out.push(longest);
  }
  for (const t of tasks) {
    if (!t || typeof t.id !== 'string' || grouped.has(t.id)) continue;
    out.push(effectiveExpectedDurationMinutes(t));
  }
  return out.sort((a, b) => b - a);
}

/**
 * Minutes this stage is expected to take.
 *
 * Conservative on purpose — the LONGEST completable tasks are the ones counted.
 * Overrunning an event with a hard end time is worse than finishing early.
 */
export function estimateStageMinutes(stage: PersonalizationStage, requiredOverride?: number): number {
  if (!stage || typeof stage !== 'object') return 0;
  const durations = completableDurations(stage);
  if (durations.length === 0) return 0;
  const authored = requiredOverride ?? stage.requiredTaskCount;
  // An unset count means "every task", which is exactly the ceiling.
  const wanted = isPositive(authored) ? Math.floor(authored) : maxCompletableTasks(stage);
  const take = Math.min(durations.length, Math.max(0, wanted));
  let total = 0;
  for (let i = 0; i < take; i++) total += durations[i];
  return total;
}

/** Minutes the whole game is expected to take, with optional per-stage overrides. */
export function estimateGameMinutes(
  stages: PersonalizationStage[],
  overrides: RequiredCountOverrides = {},
): number {
  if (!Array.isArray(stages)) return 0;
  let total = 0;
  for (const s of stages) {
    if (!s || typeof s !== 'object') continue;
    total += estimateStageMinutes(s, overrides?.[s.id]);
  }
  return total;
}

/**
 * Is this stage ours to trim?
 *
 * Narrow on purpose. Beyond the obvious protections (never the opening, never the
 * finale) a stage qualifies ONLY if its author already set an explicit
 * `requiredTaskCount`. See rule 2 in the module header — this is the guard that
 * keeps a narrative template's climax out of the trimmer.
 */
function isTrimmable(stage: PersonalizationStage, index: number, total: number): boolean {
  if (!stage || typeof stage !== 'object') return false;
  if (index === 0 || index === total - 1) return false;
  if (stage.isFinal === true) return false;
  return isPositive(stage.requiredTaskCount);
}

/**
 * Lower `requiredTaskCount` on eligible stages until the game fits `targetMinutes`.
 *
 * Trims the largest-contribution eligible stage first, ties broken by the highest
 * `order` so a later stage is cut before the opening act. Never pads a game that
 * already fits, never drops a count below 1, and reports `fits: false` rather than
 * throwing when it cannot get there — creation must never fail over pacing.
 */
export function planDurationFit(
  stages: PersonalizationStage[],
  targetMinutes: unknown,
): DurationFitPlan {
  const list = Array.isArray(stages) ? stages.filter((s) => s && typeof s === 'object') : [];
  const overrides: RequiredCountOverrides = {};
  const estimate = () => estimateGameMinutes(list, overrides);

  if (list.length === 0) return { overrides, estimatedMinutes: 0, fits: true };
  // An unusable target is not a licence to cut: leave the game exactly as authored.
  if (!isPositive(targetMinutes)) {
    return { overrides, estimatedMinutes: estimate(), fits: true };
  }

  const current = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (isTrimmable(s, i, list.length)) current.set(s.id, Math.floor(s.requiredTaskCount as number));
  }

  // Bounded by construction: each pass lowers one count by one, and every count
  // has a floor of 1, so the loop cannot outlive the total authored task count.
  while (estimate() > targetMinutes) {
    let bestId = '';
    let bestMinutes = -1;
    let bestOrder = -Infinity;
    for (const s of list) {
      const count = current.get(s.id);
      if (count === undefined || count <= 1) continue;
      const minutes = estimateStageMinutes(s, count);
      const order = typeof s.order === 'number' ? s.order : 0;
      if (minutes > bestMinutes || (minutes === bestMinutes && order > bestOrder)) {
        bestId = s.id;
        bestMinutes = minutes;
        bestOrder = order;
      }
    }
    if (!bestId) break; // nothing left to give
    const next = (current.get(bestId) as number) - 1;
    current.set(bestId, next);
    overrides[bestId] = next;
  }

  const estimatedMinutes = estimate();
  return { overrides, estimatedMinutes, fits: estimatedMinutes <= targetMinutes };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Tags
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The template's own tags plus the wizard's derived ones, through the SINGLE
 * shared normalizer so the clamp, the dedupe and the separator rules cannot drift
 * from what `updateGame` enforces on the way in.
 */
export function mergePersonalizedTags(templateTags: unknown, derivedTags: unknown): string[] {
  const a = Array.isArray(templateTags) ? templateTags : [];
  const b = Array.isArray(derivedTags) ? derivedTags : [];
  return normalizeTags([...a, ...b].filter((t) => typeof t === 'string').join(','));
}

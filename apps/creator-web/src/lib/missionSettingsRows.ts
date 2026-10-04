// The mission editor's step 3 settings rows (change: mission-editor-value-rows).
//
// Step 3 used to end in three "+" chips, each a drawer of unrelated settings that opened to up to 810px
// of controls and paragraphs, with a "4 מוגדר" badge where the value should have been. They are now at
// most five ROWS, each a single line that shows its value in words and opens only that one setting:
//
//   scoring    the one control this game's scoring actually reads (points / difficulty / none)
//   hint       the hint and its cost
//   opens      one question: from the start / after another mission / N minutes in / at a time
//   timeLimit  a countdown per team
//   more       the single second level; its row NAMES what is set inside it
//
// Everything a row decides is here, pure and total (never throws), so the component only renders.
// Rules that must survive any edit here:
//   - Opening or closing a row writes NOTHING. Only choosing an answer writes, through `apply*`.
//   - A patch clears an optional field with `undefined`, never `null`: `buildSavePayload` drops
//     undefined keys so "unset" arrives ABSENT, which every server guard accepts (CLAUDE.md).
//   - A stored task holding several opening (or closing) conditions at once reads as `combined`;
//     nothing is dropped until the creator explicitly chooses an answer.
//   - A field the game's scoring ignores is hidden, never cleared: switching scoring back restores it.
//
// Pinned by scripts/test-mission-settings-rows.ts.
import type { Task } from '@rushpoint/shared';
import { defaultExpectedDurationMinutes, UNLIMITED_CAPACITY_THRESHOLD } from '@rushpoint/shared';

export const SETTINGS_ROW_KEYS = ['scoring', 'hint', 'opens', 'timeLimit', 'more'] as const;
export type SettingsRowKey = (typeof SETTINGS_ROW_KEYS)[number];

type Preset = 'fixed_points_speed' | 'smart_weighted' | 'time_only';
/** An unknown or missing preset behaves as the product default (DEFAULT_SCORING_PRESET). */
function presetOf(p: unknown): Preset {
  return p === 'smart_weighted' || p === 'time_only' ? p : 'fixed_points_speed';
}

/** Which scoring control the game reads: points, difficulty, or none (a speed race). */
export function scoringRowFor(preset: unknown): 'points' | 'difficulty' | null {
  const p = presetOf(preset);
  return p === 'smart_weighted' ? 'difficulty' : p === 'time_only' ? null : 'points';
}

/**
 * Is this mission field ignored by the game's scoring? (packages/shared/src/scoringPresets.ts:
 * fixed points scores `pointValue` and times its bonus from `expectedDurationMinutes`; smart score
 * scores `difficulty`; a speed race scores neither.) Every other field is never ignored.
 */
export function fieldIgnoredByPreset(field: string, preset: unknown): boolean {
  const p = presetOf(preset);
  switch (field) {
    case 'difficulty': return p !== 'smart_weighted';
    case 'pointValue': return p !== 'fixed_points_speed';
    case 'expectedDurationMinutes': return p !== 'fixed_points_speed';
    default: return false;
  }
}

/** The rows step 3 shows for this game, in order. */
export function visibleRows(preset: unknown): SettingsRowKey[] {
  return SETTINGS_ROW_KEYS.filter((k) => k !== 'scoring' || scoringRowFor(preset) !== null);
}

// ── helpers ──────────────────────────────────────────────────────────────────
const obj = (task: unknown): Partial<Task> => (task && typeof task === 'object' ? task as Partial<Task> : {});
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const filled = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';
const validIso = (s: unknown): s is string => filled(s) && Number.isFinite(Date.parse(s));
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

// ── when it opens ────────────────────────────────────────────────────────────
export type ReleaseAnswer = 'start' | 'afterMission' | 'afterStart' | 'atTime' | 'combined';

export function releaseAnswerOf(task: Task): ReleaseAnswer {
  const t = obj(task);
  const present: ReleaseAnswer[] = [];
  if (ids(t.unlockAfterTaskIds).length > 0) present.push('afterMission');
  if (positive(t.releaseAfterMinutes)) present.push('afterStart');
  if (validIso(t.releaseAt)) present.push('atTime');
  return present.length === 0 ? 'start' : present.length === 1 ? present[0] : 'combined';
}

/**
 * The patch for choosing an answer: set that condition, clear the other two (ABSENT). An answer with no
 * usable value yet (no mission picked, no minutes, no time) writes NOTHING, so the row can wait for it.
 */
export function applyReleaseAnswer(answer: Exclude<ReleaseAnswer, 'combined'>, value?: unknown): Partial<Task> {
  const clear: Partial<Task> = { unlockAfterTaskIds: undefined, releaseAfterMinutes: undefined, releaseAt: undefined };
  switch (answer) {
    case 'start': return clear;
    case 'afterMission': { const v = ids(value); return v.length ? { ...clear, unlockAfterTaskIds: v } : {}; }
    case 'afterStart': return positive(value) ? { ...clear, releaseAfterMinutes: value } : {};
    case 'atTime': return validIso(value) ? { ...clear, releaseAt: value } : {};
    default: return {};
  }
}

// ── when it closes ───────────────────────────────────────────────────────────
export type CloseAnswer = 'never' | 'afterStart' | 'atTime' | 'combined';

export function closeAnswerOf(task: Task): CloseAnswer {
  const t = obj(task);
  const a = positive(t.expiresAfterMinutes);
  const b = validIso(t.expiresAt);
  return a && b ? 'combined' : a ? 'afterStart' : b ? 'atTime' : 'never';
}

export function applyCloseAnswer(answer: Exclude<CloseAnswer, 'combined'>, value?: unknown): Partial<Task> {
  const clear: Partial<Task> = { expiresAfterMinutes: undefined, expiresAt: undefined };
  switch (answer) {
    case 'never': return clear;
    case 'afterStart': return positive(value) ? { ...clear, expiresAfterMinutes: value } : {};
    case 'atTime': return validIso(value) ? { ...clear, expiresAt: value } : {};
    default: return {};
  }
}

// ── time per team ────────────────────────────────────────────────────────────
export const TIME_LIMIT_PRESETS = [2, 5, 10, 15] as const;

export function timeLimitChoiceOf(task: Task): 'none' | 'other' | (typeof TIME_LIMIT_PRESETS)[number] {
  const v = obj(task).timeLimitMinutes;
  if (!positive(v)) return 'none';
  return (TIME_LIMIT_PRESETS as readonly number[]).includes(v) ? v as (typeof TIME_LIMIT_PRESETS)[number] : 'other';
}

// ── steppers ─────────────────────────────────────────────────────────────────
export const POINTS_STEP = 10;
export const POINTS_MAX = 1000;
export const DEFAULT_POINTS = 100;
export const HINT_COST_STEP = 5;
export const DEFAULT_HINT_COST = 25;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Points ±10, kept within 0..1000; an authored odd value keeps its offset (125 → 135). */
export function stepPoints(current: number, dir: 1 | -1): number {
  const c = Number.isFinite(current) ? current : DEFAULT_POINTS;
  return clamp(c + dir * POINTS_STEP, 0, POINTS_MAX);
}
export function stepHintCost(current: number | undefined, dir: 1 | -1): number {
  const c = typeof current === 'number' && Number.isFinite(current) ? current : DEFAULT_HINT_COST;
  return clamp(c + dir * HINT_COST_STEP, 0, POINTS_MAX);
}

// ── "עוד הגדרות" ─────────────────────────────────────────────────────────────
/** The drawer's settings, in the order they appear in it. */
export const MORE_ITEM_KEYS = ['closes', 'capacity', 'contributors', 'presence', 'pauseClock', 'duration', 'hintFree', 'tags'] as const;
export type MoreItemKey = (typeof MORE_ITEM_KEYS)[number];
export type MoreItem = { key: MoreItemKey; n?: number };

/** Mirrors TASK_FIELD_DEFAULTS.maxConcurrentTeams (lib/taskOptInGroups.ts). */
const DEFAULT_CAPACITY = 1;

/** What is set inside "עוד הגדרות", by name, in drawer order. */
export function moreSettingsActive(task: Task, preset: unknown): MoreItem[] {
  const t = obj(task);
  const out: MoreItem[] = [];
  if (closeAnswerOf(t as Task) !== 'never') out.push({ key: 'closes' });
  // At or above UNLIMITED_CAPACITY_THRESHOLD the author said "no queue here" (every bank mission
  // does), which is not a limit to name.
  if (typeof t.maxConcurrentTeams === 'number' && Number.isFinite(t.maxConcurrentTeams) && t.maxConcurrentTeams !== DEFAULT_CAPACITY
    && t.maxConcurrentTeams < UNLIMITED_CAPACITY_THRESHOLD) {
    out.push({ key: 'capacity', n: t.maxConcurrentTeams });
  }
  if (positive(t.requiredContributors) && t.requiredContributors > 1) out.push({ key: 'contributors', n: t.requiredContributors });
  if (t.requirePresence === true) out.push({ key: 'presence' });
  if (t.pausesTimer === true) out.push({ key: 'pauseClock' });
  // Only the duration this game's scoring reads, and only when changed from the type's suggestion.
  // `estimatedMinutes` is seeded on every mission, so it is never "set" (it would name itself always).
  if (!fieldIgnoredByPreset('expectedDurationMinutes', preset) && positive(t.expectedDurationMinutes)) {
    let suggested: number | null = null;
    try { suggested = defaultExpectedDurationMinutes(t as Task); } catch { suggested = null; }
    if (t.expectedDurationMinutes !== suggested) out.push({ key: 'duration', n: t.expectedDurationMinutes });
  }
  if (filled(t.hint) && (positive(t.hintAutoRevealMinutes) || positive(t.hintAutoRevealAttempts))) out.push({ key: 'hintFree' });
  const tagCount = Array.isArray(t.tags) ? t.tags.filter(filled).length : 0;
  if (tagCount > 0) out.push({ key: 'tags', n: tagCount });
  return out;
}

// ── what a row says ──────────────────────────────────────────────────────────
/** An i18n key under `t.builder.rows` plus its params. Never prose: the component owns the words. */
export type RowSummary =
  | { key: string; params?: Record<string, string | number> }
  | { key: 'moreList'; items: MoreItem[] };

export interface RowSummaryCtx {
  preset: unknown;
  /** A sibling mission's title by id ('' when unknown, e.g. a deleted prerequisite). */
  titleOf: (taskId: string) => string;
}

export function rowSummary(row: SettingsRowKey, task: Task, ctx: RowSummaryCtx | null | undefined): RowSummary {
  const t = obj(task);
  const preset = ctx?.preset;
  const titleOf = typeof ctx?.titleOf === 'function' ? ctx.titleOf : () => '';
  switch (row) {
    case 'scoring': {
      if (scoringRowFor(preset) === 'difficulty') {
        const d = typeof t.difficulty === 'number' && Number.isFinite(t.difficulty) ? t.difficulty : 5;
        return { key: d <= 3 ? 'difficultyEasy' : d >= 7 ? 'difficultyHard' : 'difficultyMid' };
      }
      const n = typeof t.pointValue === 'number' && Number.isFinite(t.pointValue) ? t.pointValue : DEFAULT_POINTS;
      return { key: 'points', params: { n } };
    }
    case 'hint':
      return filled(t.hint)
        ? { key: 'hintOn', params: { n: typeof t.hintPenalty === 'number' && Number.isFinite(t.hintPenalty) ? t.hintPenalty : DEFAULT_HINT_COST } }
        : { key: 'hintNone' };
    case 'opens': {
      const a = releaseAnswerOf(t as Task);
      if (a === 'start') return { key: 'opensStart' };
      if (a === 'afterStart') return { key: 'opensAfterStart', params: { n: t.releaseAfterMinutes as number } };
      if (a === 'atTime') return { key: 'opensAtTime', params: { iso: t.releaseAt as string } };
      if (a === 'afterMission') {
        const list = ids(t.unlockAfterTaskIds);
        const titles = list.map((id) => { try { return titleOf(id) || ''; } catch { return ''; } });
        return titles.every(filled)
          ? { key: 'opensAfterMission', params: { titles: titles.join(', ') } }
          : { key: 'opensAfterMissions', params: { n: list.length } };
      }
      const n = (ids(t.unlockAfterTaskIds).length > 0 ? 1 : 0) + (positive(t.releaseAfterMinutes) ? 1 : 0) + (validIso(t.releaseAt) ? 1 : 0);
      return { key: 'opensCombined', params: { n } };
    }
    case 'timeLimit':
      return positive(t.timeLimitMinutes) ? { key: 'timeLimitMinutes', params: { n: t.timeLimitMinutes } } : { key: 'timeLimitNone' };
    case 'more': {
      const items = moreSettingsActive(t as Task, preset);
      return items.length ? { key: 'moreList', items } : { key: 'moreNone' };
    }
    default:
      return { key: 'moreNone' };
  }
}

// The VISIBLE task estimate (change: visible-time-estimates).
//
// `Task.estimatedMinutes` is the number a creator actually reads (the task card
// badge and the Builder preview total), the number the gallery publishes
// (`sumEstimatedMinutes` -> publicGames.estimatedTotalMinutes), and the number the
// product SCORES against: the `smart_weighted` sigmoid
// (functions/src/runs/index.ts:918-921 and skipAward in scoringPresets.ts:229) and
// the routing pace model (computeSkillRatio, assignNextTask.ts:141-145). Until now
// `blankTask()` handed every task a flat 15.
//
// THE THING THAT MAKES THIS FIELD DIFFERENT from `expectedDurationMinutes`:
// `RunTaskRecord.startedAt` is stamped at ASSIGNMENT (functions/src/runs/index.ts:3059)
// and completeTaskForTeam measures from it (index.ts:853-857), so the span scored
// against `estimatedMinutes` is WALK + INTERACTION. Seeding it with an
// interaction-only number (a `field` check-in derives 1 minute) would make a team
// that walked six minutes score sigmoid(6) ~ 0.2 at every stop. So this module adds
// a TRANSIT ALLOWANCE on top of the interaction default, rather than restating it.
//
// NO SCORING PATH CALLS THIS. taskScoreSmart, scoreSmartWeighted, computeSkillRatio,
// buildRankings and skipAward keep reading the authored field exactly as before, so
// no run in flight and no finalised run moves by a single point. The default reaches
// stored data only at AUTHORING time: a brand new task, or an explicit creator tap.
// There is no migration, no backfill and no write-on-read.
//
// Pure and dependency free (no Firebase, no Node) so it runs in the Builder, in a
// callable and in a tsx assertion script alike.
import type { GeoPoint, Task } from './types';
import { haversineKm, isValidCoord, normalizeTriggerMode } from './geo';
import { defaultExpectedDurationMinutes } from './taskDuration';

/** Floor for any derived or effective estimate. Never 0: `taskScoreSmart` returns 0 for
 *  `estimatedMinutes <= 0` (scoringPresets.ts:116) and `computeSkillRatio` divides by it. */
export const TASK_ESTIMATE_MIN_MINUTES = 1;
/** Ceiling. One task is not an hour, and this bounds the published gallery total too. */
export const TASK_ESTIMATE_MAX_MINUTES = 60;

/** Routing's own walking model: great-circle distance at 5 km/h (assignNextTask.ts:58).
 *  Reused verbatim so the authoring estimate and the routing cost cannot drift. */
export const WALK_MINUTES_PER_KM = 12;
/** What "we cannot know this leg" costs. The SAME constant routing charges for a task
 *  with unusable coordinates or a hidden location (assignNextTask.ts:51,53,55). */
export const TRANSIT_UNKNOWN_MINUTES = 5;
/** Two stops in one courtyard still cost arriving, orienting and finding the marker.
 *  A 0 floor would collapse the estimate back to interaction-only, the exact bug. */
export const TRANSIT_MIN_MINUTES = 1;
/** One stop parked 4 km away must not push every sibling to an unreachable target.
 *  15 minutes is about 1.25 km on foot; past that the stage is mis-designed. */
export const TRANSIT_MAX_MINUTES = 15;

/** The builder's "not placed yet" sentinel (see taskPlacementState in wizardLogic.ts). */
function isPlaced(coords: GeoPoint | undefined | null): coords is GeoPoint {
  if (!coords || !isValidCoord(coords.lat, coords.lng)) return false;
  return coords.lat !== 0 || coords.lng !== 0;
}

/** A task carries no walk at all when it is locationless or instantly triggered — the
 *  same first branch `transitMinutes()` takes in the routing engine. */
function isLocationless(task: Partial<Task> | null | undefined): boolean {
  if (!task) return false;
  const mode = normalizeTriggerMode(task as Parameters<typeof normalizeTriggerMode>[0]);
  return Boolean(task.locationless) || mode === 'locationless' || mode === 'instant';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Minutes of walking to allow for reaching this task, approximated at AUTHORING time
 * where there is no "previous stop" (routing picks that per team, at run time, from
 * live station load).
 *
 * - locationless / instant  -> exactly 0
 * - own coordinates unusable, or NO sibling has usable coordinates (a single-stop
 *   stage) -> TRANSIT_UNKNOWN_MINUTES
 * - otherwise -> the MEDIAN leg to the placed siblings, clamped to
 *   [TRANSIT_MIN_MINUTES, TRANSIT_MAX_MINUTES].
 *
 * Median rather than minimum or mean: routing's first pick is the nearest stop, but it
 * CONSUMES stops, so the last task handed out in a stage is whatever is left (a minimum
 * under-estimates every late completion). A mean lets one outlier stop across town drag
 * every sibling's estimate up. The median sits between the two and is robust to a single
 * outlier by construction. See design.md section 2.
 *
 * Always finite and never negative, for every input including `null`, `NaN` coordinates,
 * out-of-range coordinates and a `siblings` argument that is not an array.
 */
export function transitAllowanceMinutes(
  task: Task | null | undefined,
  siblings?: ReadonlyArray<Task> | null,
): number {
  if (isLocationless(task)) return 0;
  const here = task?.coordinates;
  if (!isPlaced(here)) return TRANSIT_UNKNOWN_MINUTES;

  const list = Array.isArray(siblings) ? siblings : [];
  const legs: number[] = [];
  for (const other of list) {
    if (!other || other === task) continue;
    if (task?.id != null && other.id === task.id) continue;
    if (isLocationless(other)) continue;
    if (!isPlaced(other.coordinates)) continue;
    // isPlaced already guarantees haversineKm cannot throw, but a defensive guard here
    // keeps one malformed row from aborting the whole derivation.
    let km: number;
    try {
      km = haversineKm(here, other.coordinates);
    } catch {
      continue;
    }
    if (Number.isFinite(km)) legs.push(km * WALK_MINUTES_PER_KM);
  }
  if (legs.length === 0) return TRANSIT_UNKNOWN_MINUTES;

  const m = median(legs);
  if (!Number.isFinite(m)) return TRANSIT_UNKNOWN_MINUTES;
  return Math.min(TRANSIT_MAX_MINUTES, Math.max(TRANSIT_MIN_MINUTES, m));
}

/** Round and clamp to the whole minutes the field is rendered and re-typed in. */
function clampEstimate(minutes: number): number {
  if (!Number.isFinite(minutes)) return TASK_ESTIMATE_MIN_MINUTES;
  return Math.min(
    TASK_ESTIMATE_MAX_MINUTES,
    Math.max(TASK_ESTIMATE_MIN_MINUTES, Math.round(minutes)),
  );
}

/**
 * The realistic VISIBLE estimate for a task, in whole minutes: the interaction at the
 * stop plus the walk to it.
 *
 * The interaction half is `defaultExpectedDurationMinutes(task)` reused verbatim — those
 * per-type numbers live in ONE place (taskDuration.ts) and are not restated here.
 *
 * `siblings` are the other tasks of the SAME stage; they only inform the transit
 * allowance. Always returns a finite whole number within [TASK_ESTIMATE_MIN_MINUTES,
 * TASK_ESTIMATE_MAX_MINUTES], for every input including `null` and a non-array
 * `siblings`. It can never return NaN, zero or a negative number.
 */
export function defaultEstimatedMinutes(
  task: Task | null | undefined,
  siblings?: ReadonlyArray<Task> | null,
): number {
  return clampEstimate(
    defaultExpectedDurationMinutes(task) + transitAllowanceMinutes(task, siblings),
  );
}

/**
 * The estimate to USE for a task: the authored `estimatedMinutes` when it is a finite
 * number greater than zero, otherwise the derived default.
 *
 * An authored NaN / Infinity / 0 / negative / non-number value does NOT win — it falls
 * through to the default. A finite but absurd value is clamped to
 * TASK_ESTIMATE_MAX_MINUTES rather than trusted as written.
 *
 * NOTE: the scoring path deliberately does NOT call this (see the module header). It is
 * for the Builder and for any future caller that needs one resolved number.
 */
export function effectiveEstimatedMinutes(
  task: Task | null | undefined,
  siblings?: ReadonlyArray<Task> | null,
): number {
  const authored = (task ?? {}).estimatedMinutes;
  if (typeof authored === 'number' && Number.isFinite(authored) && authored > 0) {
    return Math.min(TASK_ESTIMATE_MAX_MINUTES, authored);
  }
  return defaultEstimatedMinutes(task, siblings);
}

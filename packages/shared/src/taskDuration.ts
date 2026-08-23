// Per-interaction default task durations (change: task-duration-defaults).
//
// `Task.expectedDurationMinutes` has existed since v2 and is read in exactly ONE
// place — the expected route total inside `scoreFixedPointsSpeed` (scoringPresets.ts)
// — but NOTHING in the product ever set it, and its required sibling
// `estimatedMinutes` was handed a flat 15 to every new task by `blankTask()`. So a
// 20 second photo snap and a 10 minute puzzle were estimated identically.
//
// This module derives a realistic number from the task's OWN interaction. It is a
// FUNCTION rather than a constant map because three types scale with their authored
// content: a 12 step `sequence` is not a 1 step one, an ordering `quiz` grows with
// its items, and a `survey` grows with its options (under a hard 2 minute ceiling,
// the product owner's stated number).
//
// TWO deliberate boundaries:
//
//   1. TRAVEL IS NOT IN HERE. Walking cost is a wholly separate routing term —
//      `transitMinutes()` in functions/src/routing/assignNextTask.ts, haversine at
//      5 km/h, weighted 0.3–0.4 of the priority score. Folding the walk into this
//      number would double count it, and would be meaningless for a `locationless`
//      task which has no walk at all. This number is the interaction AT the stop.
//
//   2. NO SCORING PATH CALLS THIS. `scoreFixedPointsSpeed`, `taskScoreSmart` and
//      `computeSkillRatio` keep reading the authored fields exactly as before, so
//      no in-flight run and no finalised run moves by a single point when this
//      ships. The default is applied at AUTHORING time only, by a creator action.
//      There is no migration, no backfill and no write-on-read.
//
// Pure and dependency free (no Firebase, no Node) so it runs in the Builder, in a
// callable and in a tsx assertion script alike.
import type { Task } from './types';

/** Floor for any derived or effective duration. A `geofence` auto check-in sits here. */
export const TASK_DURATION_MIN_MINUTES = 0.5;
/** Ceiling for any derived or effective duration. Also the clamp for an absurd authored value. */
export const TASK_DURATION_MAX_MINUTES = 30;
/** Hard ceiling for a `survey`, however many options it carries. The owner's stated number. */
export const SURVEY_MAX_DURATION_MINUTES = 2;
/** Used when the type is unknown, absent or not a string. Never 0 (a 0 estimate makes
 *  `taskScoreSmart` return 0) and never negative (it would invert the routing pace ratio). */
export const TASK_DURATION_FALLBACK_MINUTES = 2;

/** Length of a value only when it really is an array; anything else counts as 0. Keeps a
 *  hand written / imported game with `steps: "nope"` from producing NaN. */
function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** Nearest 0.25 of a minute, so the UI never renders 1.9500000000000002. */
function roundToQuarter(minutes: number): number {
  return Math.round(minutes * 4) / 4;
}

function clampDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return TASK_DURATION_FALLBACK_MINUTES;
  return Math.min(TASK_DURATION_MAX_MINUTES, Math.max(TASK_DURATION_MIN_MINUTES, minutes));
}

/**
 * The realistic duration, in minutes, of the interaction this task asks for — the
 * work done AT the stop, never the walk to it (see the module header).
 *
 * Always returns a finite number within [TASK_DURATION_MIN_MINUTES,
 * TASK_DURATION_MAX_MINUTES], for every input including `null`, a task with an
 * unknown/absent/non-string `type`, and a task carrying no content arrays.
 * It can never return NaN, zero or a negative number.
 */
export function defaultExpectedDurationMinutes(task: Task | null | undefined): number {
  const t = (task ?? {}) as Partial<Task> & Record<string, unknown>;
  const type = typeof t.type === 'string' ? t.type : '';
  // `captureKind` and `verificationType` live on `task.smart`, not at the top level.
  const smart = (t.smart ?? {}) as Record<string, unknown>;

  switch (type) {
    // Auto check-in: the server fires it on arrival, the player does nothing.
    case 'geofence':
      return clampDuration(0.5);

    // Arrive and tap one confirm button / read an instruction and tap "I did it".
    case 'field':
    case 'self_report':
      return clampDuration(1);

    // Count, read off or work out one number, then type it.
    case 'numeric':
      return clampDuration(1.5);

    // Frame, shoot, look at it, retake once, upload. An audio clip is the same shape.
    case 'photo':
      return clampDuration(2);

    // The slowest interaction in the product when it is a code: find the host, wait
    // your turn, be given the code, type it. A printed QR speeds up the typing, not
    // the finding or the queue, and is not an authored per task flag. A photo upload
    // station is just a photo capture.
    case 'smart_station':
      return clampDuration(smart.verificationType === 'photo_upload' ? 2 : 3);

    // An ordering quiz is a real puzzle: every item is read and placed relative to the
    // others. A choice/typed quiz scales only mildly, with how much there is to read.
    case 'quiz': {
      const orderItems = arrayLength(t.orderItems);
      if (orderItems > 0) return clampDuration(roundToQuarter(1 + 0.4 * orderItems));
      return clampDuration(roundToQuarter(1 + 0.25 * Math.max(arrayLength(t.choices), 1)));
    }

    // One considered pick, or a typed sentence on a phone (the slow case). Capped at
    // the owner's 2 minutes either way.
    case 'survey': {
      const choices = arrayLength(t.surveyChoices);
      const raw = choices > 0 ? 0.75 + 0.15 * choices : SURVEY_MAX_DURATION_MINUTES;
      return clampDuration(Math.min(SURVEY_MAX_DURATION_MINUTES, roundToQuarter(raw)));
    }

    // Each sub step is its own prompt and response at one stop; the 0.5 base is
    // arriving and reading the framing.
    case 'sequence':
      return clampDuration(roundToQuarter(0.5 + 0.75 * arrayLength(t.steps)));

    default:
      return clampDuration(TASK_DURATION_FALLBACK_MINUTES);
  }
}

/**
 * The duration to USE for a task: the authored `expectedDurationMinutes` when it is a
 * finite number greater than zero, otherwise the derived default.
 *
 * An authored NaN / Infinity / 0 / negative value does NOT win — it falls through to
 * the default. A finite but absurd value is clamped to TASK_DURATION_MAX_MINUTES
 * rather than trusted as written.
 *
 * NOTE: the scoring path deliberately does NOT call this (see the module header). It
 * is for the Builder and for any future caller that needs one resolved number.
 */
export function effectiveExpectedDurationMinutes(task: Task | null | undefined): number {
  const authored = (task ?? {}).expectedDurationMinutes;
  if (typeof authored === 'number' && Number.isFinite(authored) && authored > 0) {
    return Math.min(TASK_DURATION_MAX_MINUTES, authored);
  }
  return defaultExpectedDurationMinutes(task);
}

// Pure decisions behind the Builder's 2-option location picker
// (change: task-location-mode-consolidation).
//
// The creator sees EXACTLY TWO top-level choices:
//   Anywhere          — no map pin, playable from anywhere
//   Specific Location — arrive at a spot on the map
// Everything technical (the radius number, "skip GPS check", "hide location")
// lives in ONE Advanced panel nested under Specific Location, so a creator who
// touches nothing gets today's 40 m arrival check.
//
// ─── The invariant this file exists to protect ───────────────────────────────
// The four `TriggerMode` VALUES are unchanged and nothing is migrated. In
// particular 'instant' is deliberately NOT folded into 'locationless', even
// though the old UI showed them as sibling buttons:
//
//   instant      — HAS coordinates, IS routed to, contributes transit distance;
//                  it only skips the GPS check when the player arrives.
//   locationless — has no coordinates at all and zero transit.
//
// Collapsing them in the UI would have silently zeroed the transit term for every
// task already using 'instant' and moved its score. So 'instant' is exposed as a
// "skip GPS check" toggle INSIDE Specific Location instead — same side of the
// picker, same routing, one less top-level choice.
//
// Every function here is total: no throw, no undefined return, and a malformed or
// absent radius resolves to the WIDER gate (never a tighter one), because the
// failure a creator cannot debug is a task that refuses to complete on site.
//
// Unit-tested by scripts/test-location-picker.ts (in `npm test`).
import type { Task, TriggerMode } from '@rushpoint/shared';
import { normalizeTriggerMode, defaultRadiusFor } from '@rushpoint/shared';

/** The two choices the creator actually sees. */
export type LocationChoice = 'anywhere' | 'specific';

/**
 * The radius at or below which a located task is "precise" (`exact`) rather than
 * a normal arrival check (`radius`). This is exactly today's `exact` default, so
 * a creator picking the tight preset reproduces the old "Exact" button byte for
 * byte and no stored task changes meaning.
 */
export const TIGHT_RADIUS_M = defaultRadiusFor('exact');   // 4

/** The radius a fresh Specific Location task gets — today's `radius` default. */
export const DEFAULT_RADIUS_M = defaultRadiusFor('radius'); // 40

/**
 * The one-tap presets offered inside the Advanced panel. These are the two old
 * top-level buttons, demoted to presets on a single control: the information the
 * "Exact" button carried is preserved, just one level deeper.
 */
export const RADIUS_PRESETS: readonly number[] = [TIGHT_RADIUS_M, DEFAULT_RADIUS_M];

/** Which of the two buttons is lit for a stored task. */
export function locationChoiceOf(task: Pick<Task, 'triggerMode' | 'locationless'>): LocationChoice {
  return normalizeTriggerMode(task) === 'locationless' ? 'anywhere' : 'specific';
}

/** Does this task complete without a GPS check? (the Advanced toggle's state) */
export function skipsGpsCheck(task: Pick<Task, 'triggerMode' | 'locationless'>): boolean {
  return normalizeTriggerMode(task) === 'instant';
}

/**
 * Which GPS-checked mode a radius implies. `<= TIGHT_RADIUS_M` ⇒ 'exact', else
 * 'radius'. A non-finite or non-positive radius falls back to the wider gate.
 */
export function triggerModeFromRadius(radiusMeters: number): 'exact' | 'radius' {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return 'radius';
  return radiusMeters <= TIGHT_RADIUS_M ? 'exact' : 'radius';
}

/** The radius to reason about for a task, falling back to the default. */
function storedRadius(task: Pick<Task, 'geofenceRadiusMeters'>): number {
  const r = task.geofenceRadiusMeters;
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : DEFAULT_RADIUS_M;
}

/**
 * Patch for picking one of the two top-level buttons.
 *
 * Picking Specific on a task that is ALREADY located is a no-op on its mode and
 * radius — re-selecting the lit button must not stomp a tuned radius (or a
 * deliberate skip-GPS-check) back to the default. Picking Anywhere never clears
 * `coordinates`: a creator toggling between the two to compare would otherwise
 * lose their pin silently.
 */
export function locationChoicePatch(task: Task, choice: LocationChoice): Partial<Task> {
  if (choice === 'anywhere') {
    return { triggerMode: 'locationless', locationless: true };
  }
  const current = normalizeTriggerMode(task);
  if (current !== 'locationless') {
    // Already located (radius / exact / instant) — leave it exactly as authored.
    return { triggerMode: current, locationless: false, geofenceRadiusMeters: storedRadius(task) };
  }
  return {
    triggerMode: triggerModeFromRadius(storedRadius(task)),
    locationless: false,
    geofenceRadiusMeters: storedRadius(task),
  };
}

/**
 * Patch for the Advanced radius control. Editing the radius while "skip GPS
 * check" is on records the number but leaves the task on 'instant' — turning the
 * toggle back off is what re-arms the check, at the radius the creator chose.
 */
export function radiusPatch(task: Task, radiusMeters: number): Partial<Task> {
  const radius = Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : DEFAULT_RADIUS_M;
  if (skipsGpsCheck(task)) {
    // State the mode explicitly rather than relying on "absent ⇒ unchanged": the
    // patch is merged onto a task that may have moved on, and a patch that names
    // the mode it intends cannot be misread.
    return { triggerMode: 'instant', locationless: false, geofenceRadiusMeters: radius };
  }
  return { triggerMode: triggerModeFromRadius(radius), locationless: false, geofenceRadiusMeters: radius };
}

/**
 * Patch for the Advanced "skip GPS check" toggle. On ⇒ 'instant' (pin and
 * routing intact); off ⇒ back to the GPS-checked mode the stored radius implies.
 */
export function skipGpsPatch(task: Task, skip: boolean): Partial<Task> {
  const radius = storedRadius(task);
  if (skip) return { triggerMode: 'instant', locationless: false, geofenceRadiusMeters: radius };
  return { triggerMode: triggerModeFromRadius(radius), locationless: false, geofenceRadiusMeters: radius };
}

/** Developer-facing fallback labels (the UI reads t.builder.*). */
export const LOCATION_CHOICE_LABELS: Record<LocationChoice, string> = {
  anywhere: 'Anywhere',
  specific: 'Specific location',
};

/** The trigger modes each choice can produce — used by the icon lookup. */
export const CHOICE_ICON_MODE: Record<LocationChoice, TriggerMode> = {
  anywhere: 'locationless',
  specific: 'radius',
};

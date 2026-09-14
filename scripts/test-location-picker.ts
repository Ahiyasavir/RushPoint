// Pure-logic tests — the Builder's 2-option location picker
// (change: task-location-mode-consolidation).
//
// Real-user testing found the old 4-way trigger row (Radius / Exact / Instant /
// Anywhere) plus a disconnected "Hide location" checkbox too technical for a
// first-time creator. The redesign presents EXACTLY TWO top-level choices —
// Anywhere and Specific Location — and pushes every technical control (radius
// number, skip-GPS-check, hide-location) into one Advanced panel nested under
// Specific Location.
//
// The load-bearing invariant this file protects: the four `TriggerMode` VALUES are
// unchanged. 'instant' is NOT merged into 'locationless' — an 'instant' task keeps
// its coordinates and keeps being routed to (it only skips the GPS check on
// arrival), so collapsing the two would silently zero a task's transit distance and
// move its score. The UI collapses; the schema does not.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import type { Task, TriggerMode } from '@rushpoint/shared';
import { normalizeTriggerMode, ARRIVAL_RADIUS_FLOOR_M } from '@rushpoint/shared';
import {
  TIGHT_RADIUS_M, TIGHT_PRESET_M, DEFAULT_RADIUS_M, RADIUS_PRESETS,
  enforcedRadiusM, radiusBelowFloor,
  type LocationChoice,
  locationChoiceOf, triggerModeFromRadius, skipsGpsCheck,
  locationChoicePatch, radiusPatch, skipGpsPatch,
} from '../apps/creator-web/src/lib/locationPicker';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const base = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'x', type: 'field',
  coordinates: { lat: 31.77, lng: 35.21 },
  difficulty: 5, pointValue: 100, maxConcurrentTeams: 3, tags: [],
  estimatedMinutes: 15,
  ...over,
} as Task);

console.log('\n── 1. radius → triggerMode cutoff ──────────────────────────');
// The two old buttons become the two ends of ONE radius control: today's 'radius'
// default (40m) and today's 'exact' default (4m) must reproduce themselves exactly,
// so nothing already saved changes meaning.
eq('the default radius still derives radius mode', triggerModeFromRadius(DEFAULT_RADIUS_M), 'radius');
eq('the mode cutoff still derives exact at 4m', triggerModeFromRadius(TIGHT_RADIUS_M), 'exact');
eq('at the cutoff exactly ⇒ exact', triggerModeFromRadius(4), 'exact');
eq('just above the cutoff ⇒ radius', triggerModeFromRadius(5), 'radius');
eq('1m ⇒ exact', triggerModeFromRadius(1), 'exact');
eq('500m ⇒ radius', triggerModeFromRadius(500), 'radius');
// Total: a garbage radius must not throw or yield undefined — it falls back to the
// safer (larger) gate rather than silently making a task un-completable.
eq('NaN falls back to radius', triggerModeFromRadius(Number.NaN), 'radius');
eq('a negative radius falls back to radius', triggerModeFromRadius(-10), 'radius');
ok('both presets are offered, tight first-or-last but both present',
  RADIUS_PRESETS.includes(TIGHT_PRESET_M) && RADIUS_PRESETS.includes(DEFAULT_RADIUS_M));

console.log('\n── 2. every stored triggerMode maps to one of TWO choices ───');
const ALL_MODES: TriggerMode[] = ['radius', 'exact', 'instant', 'locationless'];
const CHOICES: LocationChoice[] = ['anywhere', 'specific'];
ok('every TriggerMode resolves to a known choice',
  ALL_MODES.every((m) => CHOICES.includes(locationChoiceOf(base({ triggerMode: m })))));
eq('radius ⇒ specific', locationChoiceOf(base({ triggerMode: 'radius' })), 'specific');
eq('exact ⇒ specific', locationChoiceOf(base({ triggerMode: 'exact' })), 'specific');
// The whole point of the design decision: instant is a LOCATED task.
eq('instant ⇒ specific (NOT anywhere)', locationChoiceOf(base({ triggerMode: 'instant' })), 'specific');
eq('locationless ⇒ anywhere', locationChoiceOf(base({ triggerMode: 'locationless' })), 'anywhere');
// Legacy tasks predate triggerMode and carry only the boolean.
eq('legacy locationless:true ⇒ anywhere',
  locationChoiceOf(base({ locationless: true, triggerMode: undefined })), 'anywhere');
eq('a task with neither field ⇒ specific',
  locationChoiceOf(base({ triggerMode: undefined })), 'specific');

console.log('\n── 3. skip-GPS-check is the instant toggle ─────────────────');
ok('instant reads as skipping the GPS check', skipsGpsCheck(base({ triggerMode: 'instant' })));
ok('radius does not skip the GPS check', !skipsGpsCheck(base({ triggerMode: 'radius' })));
ok('exact does not skip the GPS check', !skipsGpsCheck(base({ triggerMode: 'exact' })));
ok('locationless is not "skipping" a check it never had', !skipsGpsCheck(base({ triggerMode: 'locationless' })));

console.log('\n── 4. patches: choosing Anywhere / Specific ────────────────');
const toAnywhere = locationChoicePatch(base({ triggerMode: 'radius' }), 'anywhere');
eq('Anywhere writes locationless', toAnywhere.triggerMode, 'locationless');
eq('Anywhere sets the legacy boolean in step', toAnywhere.locationless, true);

const toSpecific = locationChoicePatch(base({ triggerMode: 'locationless', locationless: true }), 'specific');
eq('Specific writes a located mode', toSpecific.triggerMode, 'radius');
eq('Specific clears the legacy boolean', toSpecific.locationless, false);
eq('Specific seeds the default radius', toSpecific.geofenceRadiusMeters, DEFAULT_RADIUS_M);

// Re-picking Specific on a task that was ALREADY specific must not stomp the
// creator's tuned radius back to the default.
const keep = locationChoicePatch(base({ triggerMode: 'exact', geofenceRadiusMeters: 4 }), 'specific');
eq('re-picking Specific preserves a tuned radius', keep.geofenceRadiusMeters, 4);
eq('re-picking Specific preserves exact mode', keep.triggerMode, 'exact');

// Switching to Anywhere and back must not destroy the pin — the creator may be
// toggling to compare, and losing coordinates would be silent data loss.
ok('Anywhere does not clear coordinates', !('coordinates' in toAnywhere));

console.log('\n── 5. patches: the Advanced controls ───────────────────────');
const tightened = radiusPatch(base({ triggerMode: 'radius', geofenceRadiusMeters: 40 }), 4);
eq('dialing the radius down to 4 flips the mode to exact', tightened.triggerMode, 'exact');
eq('… and stores the radius', tightened.geofenceRadiusMeters, 4);
const widened = radiusPatch(base({ triggerMode: 'exact', geofenceRadiusMeters: 4 }), 40);
eq('widening back flips the mode to radius', widened.triggerMode, 'radius');
eq('… and stores the radius', widened.geofenceRadiusMeters, 40);

// The radius control must NOT resurrect a GPS check on a task the creator has
// explicitly set to skip it.
const tightenedWhileSkipping = radiusPatch(base({ triggerMode: 'instant', geofenceRadiusMeters: 40 }), 4);
eq('editing the radius while skipping GPS keeps instant', tightenedWhileSkipping.triggerMode, 'instant');
eq('… but still records the radius for when it is switched back',
  tightenedWhileSkipping.geofenceRadiusMeters, 4);

const skipOn = skipGpsPatch(base({ triggerMode: 'radius', geofenceRadiusMeters: 40 }), true);
eq('turning skip-GPS on writes instant', skipOn.triggerMode, 'instant');
ok('turning skip-GPS on does NOT clear coordinates', !('coordinates' in skipOn));
ok('turning skip-GPS on does NOT set locationless',
  skipOn.locationless !== true);
const skipOff = skipGpsPatch(base({ triggerMode: 'instant', geofenceRadiusMeters: 40 }), false);
eq('turning skip-GPS off restores a GPS-checked mode from the stored radius',
  skipOff.triggerMode, 'radius');
const skipOffTight = skipGpsPatch(base({ triggerMode: 'instant', geofenceRadiusMeters: 4 }), false);
eq('… honouring a tight stored radius', skipOffTight.triggerMode, 'exact');
const skipOffNoRadius = skipGpsPatch(base({ triggerMode: 'instant', geofenceRadiusMeters: undefined }), false);
eq('… and falling back to the default when no radius was stored',
  skipOffNoRadius.geofenceRadiusMeters, DEFAULT_RADIUS_M);

console.log('\n── 6. round-trip: opening a task must not change it ─────────');
// Viewing a task in the redesigned editor must be a pure read. For each stored
// mode, deriving the UI state and writing it straight back must be a no-op.
for (const m of ALL_MODES) {
  const task = base({ triggerMode: m, geofenceRadiusMeters: m === 'exact' ? 4 : 40 });
  const choice = locationChoiceOf(task);
  const rewritten = { ...task, ...locationChoicePatch(task, choice) };
  eq(`${m}: re-selecting the derived choice preserves triggerMode`,
    normalizeTriggerMode(rewritten), normalizeTriggerMode(task));
  eq(`${m}: … and preserves coordinates`, rewritten.coordinates, task.coordinates);
}


// ── The radius floor (change: arrival-needs-a-usable-fix) ───────────────────
//
// The tight preset on this very control is 4m, and the arrival gate floors every
// radius at ARRIVAL_RADIUS_FLOOR_M because a handset cannot resolve better. So the
// Builder hands out a value the game will not honour literally, and has to say so.
// THE PRESET NO LONGER OFFERS A NUMBER THE GAME IGNORES. It used to hand out
// TIGHT_RADIUS_M (4m) while the arrival gate floored everything at 25 - a button
// promising precision the hardware cannot deliver. It now offers the floor itself.
eq('the tight PRESET is never below the floor', radiusBelowFloor(TIGHT_PRESET_M), false);
eq('and what it offers is exactly what gets enforced',
  enforcedRadiusM(TIGHT_PRESET_M), TIGHT_PRESET_M);
eq('every preset is honest', RADIUS_PRESETS.every((r) => !radiusBelowFloor(r)), true);
// The mode cutoff is deliberately untouched: moving it would reclassify stored tasks.
eq('the mode cutoff constant still stands where it always did', TIGHT_RADIUS_M, 4);
// A hand-typed sub-floor value is still possible, so the explanatory note still has
// a job - it is the fallback now, not the primary answer.
eq('a hand-typed 4 still reports that it will be widened', radiusBelowFloor(4), true);
eq('the default preset is not', radiusBelowFloor(DEFAULT_RADIUS_M), false);
eq('a hand-typed 4m radius is really enforced at the floor', enforcedRadiusM(4), ARRIVAL_RADIUS_FLOOR_M);
eq('the floor never NARROWS a generous radius', enforcedRadiusM(DEFAULT_RADIUS_M), DEFAULT_RADIUS_M);
eq('a radius exactly at the floor is not flagged', radiusBelowFloor(ARRIVAL_RADIUS_FLOOR_M), false);
// Garbage in must not produce a note about a number the creator never typed.
for (const bad of [undefined, null, 0, -5, Number.NaN]) {
  eq(`radiusBelowFloor(${String(bad)}) is false`, radiusBelowFloor(bad as number), false);
}
eq('an absent radius reports the ordinary default, not the floor',
  enforcedRadiusM(undefined), DEFAULT_RADIUS_M);

if (failures > 0) {
  console.error(`\n✗ ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ location picker OK\n');

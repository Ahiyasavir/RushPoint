// ─── publicTasks legacy-coordinate backfill — the decision rule ───────────────
//
// `task-library-map-view` stopped publishGame from writing the exact authored
// `task.coordinates` into the world-readable `publicTasks/{id}` document, and
// replaced it with a coarse `approxLocation` that is omitted entirely for
// hideLocation / locationless / unplaced tasks (see ./publicTaskLocation).
//
// That fix only covers documents written AFTER it shipped. Every task published
// before it still sits in a `allow read: if true` collection carrying its exact
// point — including hideLocation tasks, whose coordinates are server-secret
// everywhere else. Re-publishing the game erases it, but nothing forces a
// creator to re-publish, so the exposure persists indefinitely. This module is
// the pure decision rule the maintenance sweep applies to close it.
//
// WHY THE SOURCE TASK IS REQUIRED
// A `publicTasks` document does NOT carry `locationless` — it is an authoring
// flag that was never denormalised — and it does not carry the authored
// coordinate the area is derived from. So the public document alone cannot say
// whether it should have an area or none. The sweep therefore reads the owning
// game and hands the authored task in. When it cannot be found (game deleted,
// unpublished, task removed), the rule FAILS CLOSED: strip the exact point,
// publish no area. Losing a map pin is recoverable by re-publishing; leaking an
// exact coordinate is not.
//
// SECOND JOB (change: hidden-location-map-visibility). Hidden-location tasks now
// publish a coarse area like every other task. Documents written for them under
// the previous rule carry NO location field at all, and no legacy `coordinates`
// key to trigger the repair above — so the sweep also fills in a missing area.
// See `mayNeedPublicTaskRepair`.

import type { GeoPoint } from './types';
import { isPlottablePublicTask, publicTaskLocation, isCoarsePublicPoint } from './publicTaskLocation';

/** The authored task, as much of it as the rule needs. `null` ⇒ not findable. */
export interface BackfillSourceTask {
  hideLocation?: boolean;
  locationless?: boolean;
  coordinates?: { lat?: unknown; lng?: unknown };
}

/** The stored public document, as much of it as the rule needs. */
export interface BackfillPublicTaskDoc {
  coordinates?: { lat?: unknown; lng?: unknown };
  approxLocation?: { lat?: unknown; lng?: unknown };
}

export interface PublicTaskRepair {
  /**
   * The area to write, or `undefined` ⇒ the document must end up with NO
   * location field at all (the `approxLocation` key is deleted too, so a
   * previously-written area for a task that has since become hidden is removed).
   */
  approxLocation?: GeoPoint;
}

/**
 * Does this stored document need repairing, and to what?
 *
 * Returns `null` when the document is already conformant — the sweep must skip
 * it and write nothing, so a second run is a no-op and the job is idempotent.
 *
 * A document needs repair exactly when the deprecated `coordinates` key is
 * PRESENT. Its presence is the marker of a pre-fix write; documents written by
 * the current publishGame never carry it. `coordinates: undefined` after a
 * Firestore read means the field is absent, so a plain presence check is the
 * whole test — an unparseable or out-of-range legacy value still counts as
 * present and still gets stripped.
 */
export function hasLegacyCoordinates(doc: BackfillPublicTaskDoc | null | undefined): boolean {
  return !!doc && doc.coordinates !== undefined && doc.coordinates !== null;
}

/**
 * The sweep's cheap pre-check: is it worth spending a game read on this document?
 *
 * THREE reasons a document can need work:
 *   1. it still carries the deprecated exact `coordinates` — the original
 *      exposure (change: task-library-map-view); or
 *   2. it carries no USABLE published area, and its authored task might now be
 *      able to supply one (change: hidden-location-map-visibility); or
 *   3. it carries a COARSE ~1 km area, but the rule now publishes EXACT points
 *      for every located task — so a hidden mission stored under the old coarsening
 *      rule needs re-repairing to its precise spot
 *      (change: gallery-exact-hidden-location). Without this, every hidden mission
 *      published before the change would stay a kilometre off / stacked on the map.
 *
 * "Usable" is `isPlottablePublicTask` — the READER's own predicate — so a stored
 * area that is non-finite, out of range or the null-island placeholder counts as
 * absent here exactly as it does on the map. One predicate, no drift.
 */
export function mayNeedPublicTaskRepair(doc: BackfillPublicTaskDoc | null | undefined): boolean {
  if (!doc) return false;
  return hasLegacyCoordinates(doc)
    || !isPlottablePublicTask(doc)
    || isCoarsePublicPoint(doc.approxLocation);
}

/** Two published points are equal iff both are finite and match — both sides are
 *  already round5'd by publicTaskLocation, so an exact numeric compare is right. */
function geoEquals(
  a: { lat?: unknown; lng?: unknown } | null | undefined,
  b: GeoPoint,
): boolean {
  return !!a && typeof a.lat === 'number' && typeof a.lng === 'number'
    && a.lat === b.lat && a.lng === b.lng;
}

export function repairPublicTask(
  doc: BackfillPublicTaskDoc | null | undefined,
  sourceTask: BackfillSourceTask | null | undefined,
): PublicTaskRepair | null {
  if (!mayNeedPublicTaskRepair(doc)) return null;
  const legacy = hasLegacyCoordinates(doc);
  // Fail closed when the authored task is gone: we cannot prove the location was
  // ever publishable, so we publish nothing. With nothing to strip either, the
  // document is left entirely alone rather than rewritten to the same state.
  if (!sourceTask) return legacy ? {} : null;
  const desired = publicTaskLocation(sourceTask);
  // A doc with no exact point to strip AND no area to gain is already in its
  // final state (a locationless or unplaced task). Returning null here is what
  // keeps the sweep idempotent and stops it rewriting every such document on
  // every run.
  if (!legacy && !desired) return null;
  // Already correct: no legacy point to strip and the stored area already equals
  // the rule's output. This keeps the sweep idempotent for an EXACT point that
  // merely happens to sit on the coarse grid (which trips the isCoarsePublicPoint
  // pre-check in mayNeedPublicTaskRepair) — it is not rewritten to itself forever.
  if (!legacy && desired && geoEquals(doc?.approxLocation, desired)) return null;
  return desired ? { approxLocation: desired } : {};
}

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
import { isPlottablePublicTask, publicTaskLocation } from './publicTaskLocation';

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
 * TWO reasons a document can need work (change: hidden-location-map-visibility):
 *   1. it still carries the deprecated exact `coordinates` — the original
 *      exposure; or
 *   2. it carries no USABLE published area, and its authored task might now be
 *      able to supply one.
 *
 * (2) exists because hidden-location tasks now publish an area. A hidden task
 * published AFTER `task-library-map-view` has neither a legacy `coordinates` key
 * nor an `approxLocation`, so rule (1) alone never fires on it and it would stay
 * off the map forever, no matter how many times the sweep is run.
 *
 * "Usable" is `isPlottablePublicTask` — the READER's own predicate — so a stored
 * area that is non-finite, out of range or the null-island placeholder counts as
 * absent here exactly as it does on the map. One predicate, no drift.
 */
export function mayNeedPublicTaskRepair(doc: BackfillPublicTaskDoc | null | undefined): boolean {
  if (!doc) return false;
  return hasLegacyCoordinates(doc) || !isPlottablePublicTask(doc);
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
  const approxLocation = publicTaskLocation(sourceTask);
  // A doc with no exact point to strip AND no area to gain is already in its
  // final state (a locationless or unplaced task). Returning null here is what
  // keeps the sweep idempotent and stops it rewriting every such document on
  // every run.
  if (!legacy && !approxLocation) return null;
  return approxLocation ? { approxLocation } : {};
}

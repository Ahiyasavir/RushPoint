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
// A `publicTasks` document does NOT carry `hideLocation` or `locationless` —
// they are authoring flags that were never denormalised. So the public document
// alone cannot say whether its point may be coarsened and republished or must
// vanish. The sweep therefore reads the owning game and hands the authored task
// in. When it cannot be found (game deleted, unpublished, task removed), the
// rule FAILS CLOSED: strip the exact point, publish no area. Losing a map pin is
// recoverable by re-publishing; leaking a hidden location is not.

import type { GeoPoint } from './types';
import { publicTaskLocation } from './publicTaskLocation';

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

export function repairPublicTask(
  doc: BackfillPublicTaskDoc | null | undefined,
  sourceTask: BackfillSourceTask | null | undefined,
): PublicTaskRepair | null {
  if (!hasLegacyCoordinates(doc)) return null;
  // Fail closed when the authored task is gone: we cannot prove the location was
  // ever publishable, so we publish nothing.
  if (!sourceTask) return {};
  const approxLocation = publicTaskLocation(sourceTask);
  return approxLocation ? { approxLocation } : {};
}

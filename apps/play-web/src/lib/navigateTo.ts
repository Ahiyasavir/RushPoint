// "Navigate here" hand-off to a real turn-by-turn app
// (change: play-navigate-handoff).
//
// Participants used to get a 208px static map and a "📍 400 m away" badge while
// standing outdoors in an unfamiliar area; the only waze/maps link in the whole
// participant app belonged to STAFF (the SOS alert). This module supplies the
// one decision that has to be right, and nothing else:
//
//   MAY this task's coordinates be handed to a navigation app?
//
// It matters because for a hidden-location (treasure-hunt) task THE COORDINATES
// ARE THE PUZZLE ANSWER. The server strips them while the spot is sealed, then
// deliberately re-releases them after arrival so the map can pin where the team
// already stands (see sanitizeTaskForParticipant). A client that turns those
// released coordinates into a "navigate here" button would hand the player the
// solution to the game they are playing.
//
// So the rule lives here, as a pure tested function that FAILS CLOSED, instead
// of as a condition inlined in JSX that happens to sit in a safe branch today.
// Covered by scripts/test-navigate-handoff.ts. No React, no Firebase.

/** The structural minimum this module needs — deliberately not `SafeTask`, so
 *  the rule stays reusable (a map popup, a stage overview) and testable without
 *  dragging the services layer into a tsx-free script. */
export interface NavigableTask {
  /** The location is part of the puzzle. */
  locationHidden?: boolean;
  /** The server has not confirmed arrival yet, so the spot is still secret. */
  arrivalPending?: boolean;
  /** No map pin at all; done from anywhere. */
  locationless?: boolean;
  coordinates?: { lat: number; lng: number };
  smart?: { stationCoords?: { lat: number; lng: number } };
}

export interface NavTarget { lat: number; lng: number }

/**
 * The coordinates it is legitimate to hand to a navigation app, or `null`.
 *
 * Refuses, in order: a missing task; a task awaiting arrival confirmation; a
 * hidden-location task (even a revealed one that really does carry coordinates);
 * a locationless task; and coordinates that are absent, non-finite, or the
 * (0, 0) "null island" sentinel a half-filled Builder form produces.
 *
 * The finiteness + null-island guard mirrors DistanceBadge's existing check
 * exactly, so the distance badge and the navigation link can never disagree
 * about whether a task has a usable location.
 */
export function navigationTarget(task: NavigableTask | null | undefined): NavTarget | null {
  if (!task) return null;
  if (task.arrivalPending) return null;
  if (task.locationHidden) return null;
  if (task.locationless) return null;

  const coords = task.smart?.stationCoords ?? task.coordinates;
  if (!coords) return null;
  const { lat, lng } = coords;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!lat && !lng) return null; // (0, 0) — never a real destination in this product

  // A fresh object with exactly two numeric fields: nothing else from the task
  // can ride along into a third-party URL.
  return { lat, lng };
}

/** Waze deep link. Plain https, so the OS opens the app when it is installed and
 *  falls back to the web when it is not. Takes a NavTarget, never a task. */
export function wazeUrl(target: NavTarget): string {
  return `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`;
}

/** Google Maps fallback, same shape as the staff SOS link that already ships. */
export function googleMapsUrl(target: NavTarget): string {
  return `https://www.google.com/maps?q=${target.lat},${target.lng}`;
}

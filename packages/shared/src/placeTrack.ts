// Parallel place tracks (Ahiya, 2.11: one place per stage must not pile a big event into one spot).
//
// In a big game a middle stage holds a full set of missions for each of two places, and a team plays one
// set. Routing spreads teams between the sets by load on the FIRST mission of the stage, and from then on
// keeps the team on the set it started: a team must never be sent across town between two missions of one
// stage. Pure and total. Fails open: when the team's set has nothing to give, the stage must still move.
import type { Task } from './types';

export function stickToPlaceTrack<T extends Pick<Task, 'id' | 'placeTrack'>>(
  candidates: readonly T[],
  stageTasks: readonly T[],
  completedTaskIds: readonly string[],
): T[] {
  const started = stageTasks.find((t) => t.placeTrack && completedTaskIds.includes(t.id))?.placeTrack;
  if (!started) return [...candidates];
  const sameTrack = candidates.filter((t) => t.placeTrack === started);
  return sameTrack.length > 0 ? sameTrack : [...candidates];
}

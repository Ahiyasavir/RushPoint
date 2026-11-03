// Parallel place tracks (Ahiya, 2.11: one place per stage must not pile a big event into one spot).
//
// In a big game a middle stage holds a full set of missions for each of two places, and a team plays one
// set. A team's first mission of the stage picks the set with fewer teams on it right now (a tie is split
// by the team, so teams that arrive one at a time still spread), and from then on the team stays on it: a
// team must never be sent across town between two missions of one stage. Pure and total. Fails open: when
// the team's set has nothing to give, the stage must still move.
//
// `stageTasks` is the WHOLE stage, done missions included: it is what remembers the set. Routing's
// candidates hold open missions only, so passing them here forgets the set (found by playing ten teams).
import type { Task } from './types';

export interface PlaceTrackSpread {
  /** Run.taskCounts: teams holding each mission right now. */
  taskCounts?: Readonly<Record<string, number>>;
  /** Stable per team, splits a tie. */
  spreadKey?: string;
}

function hashOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h;
}

export function stickToPlaceTrack<T extends Pick<Task, 'id' | 'placeTrack'>>(
  candidates: readonly T[],
  stageTasks: readonly T[],
  completedTaskIds: readonly string[],
  { taskCounts = {}, spreadKey = '' }: PlaceTrackSpread = {},
): T[] {
  const started = stageTasks.find((t) => t.placeTrack && completedTaskIds.includes(t.id))?.placeTrack;
  if (started) {
    const sameTrack = candidates.filter((t) => t.placeTrack === started);
    return sameTrack.length > 0 ? sameTrack : [...candidates];
  }
  const open = [...new Set(candidates.flatMap((t) => (t.placeTrack ? [t.placeTrack] : [])))].sort();
  if (open.length < 2) return [...candidates];
  const load = (track: string) => stageTasks
    .filter((t) => t.placeTrack === track)
    .reduce((sum, t) => sum + (taskCounts[t.id] ?? 0), 0);
  const lightest = Math.min(...open.map(load));
  const tied = open.filter((track) => load(track) === lightest);
  const chosen = tied[hashOf(spreadKey) % tied.length];
  return candidates.filter((t) => !t.placeTrack || t.placeTrack === chosen);
}

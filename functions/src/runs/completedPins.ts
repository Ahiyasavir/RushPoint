// completedTaskPins — the SAFE channel that lets the play map plot the trail of
// missions a team has ALREADY COMPLETED (change: hidden-mission-map).
//
// Why this is leak-safe BY CONSTRUCTION:
//   A completed mission is a place the team has physically been — the same
//   principle by which a hidden task's coordinates are released to the player
//   only AFTER arrival ("you can't un-find a spot you've stood on"). So a
//   completed mission's location reveals nothing new.
//
// The pins are built by CONSTRUCTION from the team's own completed RunTaskRecords,
// never by filtering a fuller list down: this function can ONLY ever emit a pin
// for a task whose team-record status === 'completed'. A hidden-not-yet-arrived
// task, an unassigned task, or the active SEALED target is structurally incapable
// of appearing here — there is no code path that reads a non-completed record.
// This is the wave-D lesson made mechanical: "withheld" means absent from the
// wire, so the new channel is built to be incapable of shipping a
// non-completed task's coordinates.
//
// A completed task with no usable coordinates (locationless, or missing / (0,0) /
// out-of-range coords) is simply omitted — there is nothing to pin.
import { isValidCoord, type GeoPoint } from '@rushpoint/shared';

export interface CompletedPin {
  id: string;
  coordinates: GeoPoint;
  title: string;
}

// Minimal structural shapes — kept loose so this pure helper can be unit-tested
// with plain literals and never drags the whole Task/RunTeam graph into a test.
interface TeamTaskLike {
  taskId: string;
  status: string;
}
interface TeamStageLike {
  tasks: TeamTaskLike[];
}
interface GameTaskLike {
  id: string;
  title?: string;
  coordinates?: GeoPoint;
  locationless?: boolean;
  smart?: { stationCoords?: GeoPoint | null } | null;
}

// Resolve the plottable coordinate of a game task: a smart station's injected
// coords take precedence over the top-level ones (mirrors how the live NavMap
// picks the active target's pin), else the task's own coordinates.
function pinCoords(task: GameTaskLike): GeoPoint | null {
  const c = task.smart?.stationCoords ?? task.coordinates;
  if (!c || !isValidCoord(c.lat, c.lng)) return null;
  // A (0,0) coordinate is the "unset" sentinel used across the codebase — never a
  // real mission location — so it is not a pin.
  if (c.lat === 0 && c.lng === 0) return null;
  return { lat: c.lat, lng: c.lng };
}

/**
 * Build the completed-mission pins for a team: for EVERY completed task record
 * across ALL of the team's stages, join to the game task's coordinates + title.
 * Only status==='completed' records ever contribute. Locationless / coordinate-less
 * completed tasks are omitted. Deduped by task id.
 */
export function buildCompletedPins(
  teamStages: TeamStageLike[] | undefined,
  gameTasks: GameTaskLike[] | undefined,
): CompletedPin[] {
  const byId = new Map<string, GameTaskLike>();
  for (const t of gameTasks ?? []) byId.set(t.id, t);

  const pins: CompletedPin[] = [];
  const seen = new Set<string>();
  for (const stage of teamStages ?? []) {
    for (const rec of stage.tasks ?? []) {
      if (rec.status !== 'completed') continue;      // ← the ONLY records that qualify
      if (seen.has(rec.taskId)) continue;
      const task = byId.get(rec.taskId);
      if (!task || task.locationless) continue;      // locationless completed task → no pin
      const coordinates = pinCoords(task);
      if (!coordinates) continue;                    // no usable coords → no pin
      seen.add(rec.taskId);
      pins.push({ id: rec.taskId, coordinates, title: task.title ?? 'Task' });
    }
  }
  return pins;
}

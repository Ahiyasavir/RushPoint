// Located missions open on arrival, and the map shows where to go (change: located-mission-arrival).
//
// Field report 2026-09-27 + Ahiya's decisions of 2026-09-28:
//  * EVERY located mission opens only when the team arrives (not a setting). Fixed per run at launch
//    (`Run.arrivalGate`), so a run already live is never re-sealed under a team mid-mission.
//  * The map shows every mission, locked ones too; a hidden mission shows only its search circle.
//  * A new located mission gets a line and an arrowhead from the team to it (`bearingDeg`).
// Pure and total. The sanitizer builds the sealed payload through `locatedSealedStub`, BY
// CONSTRUCTION, exactly like the hidden-location stub: a field added to `Task` tomorrow is withheld.

import { normalizeTriggerMode } from './geo';

type Coord = { lat: number; lng: number };

function realCoord(c: unknown): c is Coord {
  if (!c || typeof c !== 'object') return false;
  const { lat, lng } = c as { lat?: unknown; lng?: unknown };
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Is this mission sealed until the team arrives, in this run? Hidden missions have their own seal. */
export function arrivalGateApplies(
  task: { coordinates?: unknown; triggerMode?: unknown; locationless?: unknown; hideLocation?: unknown; type?: unknown } | null | undefined,
  run: { arrivalGate?: unknown } | null | undefined,
): boolean {
  if (!task || typeof task !== 'object' || !run || run.arrivalGate !== true) return false;
  if (task.hideLocation === true || task.locationless === true) return false;
  if (!realCoord(task.coordinates)) return false;
  const mode = normalizeTriggerMode(task as never);
  return mode === 'radius' || mode === 'exact';
}

/** The ONLY keys a located-but-not-arrived mission ships to a player. */
export const LOCATED_STUB_KEYS = [
  'id', 'title', 'titleHe', 'coordinates', 'geofenceRadiusMeters',
  'pointValue', 'difficulty', 'estimatedMinutes', 'media', 'arrivalPending',
] as const;

/**
 * The payload of a located mission before arrival: its name, its place and what it is worth, so the
 * team knows where to go. No instructions, no type, no inputs, no answer key, and nothing that is not
 * listed above: built by copying named fields OUT, never by deleting from the whole task.
 */
export function locatedSealedStub(task: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { arrivalPending: true };
  for (const k of LOCATED_STUB_KEYS) {
    if (k === 'arrivalPending') continue;
    if (task && task[k] !== undefined && task[k] !== null) out[k] = task[k];
  }
  return out;
}

export type MissionPinState = 'done' | 'current' | 'open' | 'locked';
export interface MissionPin { id: string; lat: number; lng: number; title: string; state: MissionPinState }

/**
 * Every mission with a real location, in game order, with its state for this team. Hidden missions
 * are EXCLUDED (their search circle is drawn elsewhere, never the pin) and so are locationless ones.
 * `locked` = in a stage the team has not reached; `open` = in its stage, not done, not current.
 */
export function missionPins(
  game: { stages?: { id: string; tasks?: Record<string, unknown>[] }[] } | null | undefined,
  team: { stages?: { stageId: string; status?: string; tasks?: { taskId: string; status?: string }[] }[] } | null | undefined,
): MissionPin[] {
  if (!game || !Array.isArray(game.stages)) return [];
  const stageStatus = new Map<string, string>();
  const recStatus = new Map<string, string>();
  for (const s of Array.isArray(team?.stages) ? team!.stages! : []) {
    if (!s) continue;
    stageStatus.set(s.stageId, s.status ?? '');
    for (const r of Array.isArray(s.tasks) ? s.tasks : []) if (r) recStatus.set(r.taskId, r.status ?? '');
  }
  const out: MissionPin[] = [];
  for (const s of game.stages) {
    for (const t of Array.isArray(s?.tasks) ? s.tasks : []) {
      if (!t || typeof t.id !== 'string') continue;
      if (t.hideLocation === true || t.locationless === true || !realCoord(t.coordinates)) continue;
      // An "anywhere" mission with a stale pin is not a place to go (the Builder shows it as anywhere).
      if (t.triggerMode === 'locationless') continue;
      const st = recStatus.get(t.id);
      const state: MissionPinState = st === 'completed' || st === 'skipped' ? 'done'
        : st === 'assigned' ? 'current'
          : stageStatus.get(s.id) === 'active' ? 'open' : 'locked';
      const c = t.coordinates as Coord;
      out.push({ id: t.id, lat: c.lat, lng: c.lng, title: typeof t.title === 'string' ? t.title : '', state });
    }
  }
  return out;
}

/** Initial great-circle bearing from `a` to `b`, degrees clockwise from north, in [0, 360). */
export function bearingDeg(a: Coord, b: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  if (x === 0 && y === 0) return 0;
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

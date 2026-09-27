// The staff event map (change: staff-event-map). Pure and total (scripts/test-staff-map.ts).

/** A team that has not reported for five minutes is drawn faded: its dot is a guess by now. */
export const STALE_LOCATION_MS = 5 * 60_000;

/** Whole minutes since the team's last position, and whether that is stale. Unknown ⇒ stale. */
export function locationAge(updatedAt: unknown, nowMs: number): { minutes: number | null; stale: boolean } {
  const ms = typeof updatedAt === 'string' ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(ms)) return { minutes: null, stale: true };
  const age = Math.max(0, nowMs - ms);
  return { minutes: Math.floor(age / 60_000), stale: age > STALE_LOCATION_MS };
}

export interface MissionSpot { id: string; title: string; lat: number; lng: number; hidden: boolean; stage: number }

interface OutlineLike {
  stages?: { tasks?: { id?: unknown; title?: unknown; spot?: { lat?: unknown; lng?: unknown; hidden?: unknown } }[] }[];
}

const validCoord = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Every mission with a real spot, in stage order, numbered by stage (1 based). */
export function missionSpots(outline: OutlineLike | null | undefined): MissionSpot[] {
  const stages = Array.isArray(outline?.stages) ? outline!.stages! : [];
  const out: MissionSpot[] = [];
  stages.forEach((st, i) => {
    for (const t of Array.isArray(st?.tasks) ? st.tasks : []) {
      const s = t?.spot;
      if (typeof t?.id !== 'string' || !s || !validCoord(s.lat, s.lng)) continue;
      out.push({ id: t.id, title: typeof t.title === 'string' ? t.title : '', lat: s.lat as number, lng: s.lng as number, hidden: s.hidden === true, stage: i + 1 });
    }
  });
  return out;
}

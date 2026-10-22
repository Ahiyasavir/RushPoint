// Areas from the pins: one stage per area, in walking order (change: composer-v2-zones).
//
// The founder: "כשבוחרים כמה אזורים של תחרות אני רוצה לוודא שהם לא יתרתרו יותר מידי בין האזורים
// (שלא ילכו הלוך חזור)". The composer knows nothing about geography: it picks missions, and the
// creator drops the pins afterwards in Quick Setup. Within a stage every mission is open at once, so
// a stage holding a mission in the park and one in the city centre sends teams back and forth.
//
// He also ruled out asking the creator about areas ("מאיפה תשיג עכשיו מידע על כל סיכה?"), so the
// areas come from the pins the creator ALREADY placed:
//
//   1. CLUSTER. Pins closer than ZONE_EPS_METERS to one another are one area (single-linkage, the
//      DBSCAN of Turf's `clustersDbscan` with minPoints 1). Nothing about the place is needed,
//      only distances.
//   2. ORDER. The areas form a walking route: nearest neighbour from the opener's area, then 2-opt
//      until no two legs cross. The finale's area stays last when it has one.
//   3. STAGES. One stage per area, in route order. Missions with no pin keep their place in the
//      story: each joins the stage of the located mission before it.
//   4. ARRIVAL. An area far from the previous one opens with a geofence "get to the area" mission,
//      and the stage's other missions unlock after it (`unlockAfterTaskIds`, which the product
//      already enforces). A near area does not need one.
//
// Pure, deterministic and total: no React, no Firebase, no clock, no randomness, and `null` (never
// a throw) when the game is not one this can improve. The result passes the same structural
// validators `updateGame` runs, asserted in scripts/test-zone-plan.ts. Language-free: every word a
// creator or player reads arrives through `copy`, the rule lib/composeGame.ts lives by.
import type { Game, Stage, Task, TemplateWizardStep } from '@rushpoint/shared';
import { haversineKm } from '@rushpoint/shared';

// ═══════════════════════════════════════════════════════════════════════════
// Tuning — named so a test asserts against the NAME, not the number
// ═══════════════════════════════════════════════════════════════════════════

/** Pins closer than this are one area: about three minutes on foot. */
export const ZONE_EPS_METERS = 250;
/** An area further than this from the previous one opens with an arrival mission (~5 min walk). */
export const ARRIVAL_GATE_MIN_METERS = 400;
/** More areas than this are merged, closest first: a stage per street corner is a stutter. */
export const MAX_ZONES = 6;
/** The composer's floor (MIN_MISSIONS_PER_STAGE): a one-mission stage is ceremony, not a stage. */
export const MIN_TASKS_PER_ZONE_STAGE = 2;
/** Arrival missions are recognised by this id prefix, so a re-plan replaces them instead of stacking. */
export const ARRIVAL_ID_PREFIX = 'zone-arrival-';
/** The arrival circle: the area's own spread plus this margin, never smaller than the floor. */
export const ARRIVAL_RADIUS_MARGIN_METERS = 40;
export const ARRIVAL_RADIUS_FLOOR_METERS = 60;

export interface ZonePlanCopy {
  /** The title of the stage for area `n` (1-based). */
  stageTitle: (n: number) => string;
  /** The arrival mission's title and description, shown to players. */
  arrivalTitle: (n: number) => string;
  arrivalDescription: string;
}

export interface Point { lat: number; lng: number }

export interface ZonePlan {
  stages: Stage[];
  /** Quick Setup steps re-pointed at the stage each mission now lives in. */
  wizardSteps?: TemplateWizardStep[];
  zoneCount: number;
  arrivalCount: number;
  /** How many missions changed stage: the Builder says so, and skips the offer when it is 0. */
  movedCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Geometry
// ═══════════════════════════════════════════════════════════════════════════

export function metersBetween(a: Point, b: Point): number {
  return haversineKm(a, b) * 1000;
}

/** A mission's pin, or null when it has none (locationless, the null-island sentinel, garbage). */
export function pinOf(task: Partial<Task> | null | undefined): Point | null {
  if (!task || typeof task !== 'object' || task.locationless === true) return null;
  const c = task.coordinates as Partial<Point> | undefined;
  if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return null;
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return null;
  if (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180 || (c.lat === 0 && c.lng === 0)) return null;
  return { lat: c.lat, lng: c.lng };
}

export function centroid(points: readonly Point[]): Point {
  const n = Math.max(1, points.length);
  return {
    lat: points.reduce((a, p) => a + p.lat, 0) / n,
    lng: points.reduce((a, p) => a + p.lng, 0) / n,
  };
}

/**
 * Group point indexes so that any two points within `eps` of each other share a group, transitively
 * (single-linkage; DBSCAN with minPoints 1). Groups come out ordered by their first member, members
 * ascending, so the result never depends on iteration order.
 */
export function clusterPoints(points: readonly Point[], eps = ZONE_EPS_METERS): number[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (metersBetween(points[i], points[j]) <= eps) {
        const a = find(i), b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map<number, number[]>();
  points.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()].sort((a, b) => a[0] - b[0]);
}

function routeLength(order: readonly number[], at: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) total += metersBetween(at[order[i - 1]], at[order[i]]);
  return total;
}

/**
 * A short walking order over `at`: nearest neighbour from `start`, then 2-opt (reverse any segment
 * whose reversal shortens the route) until nothing improves. With `end`, that point stays last.
 * Exact enough for the handful of areas a game has, and instant.
 */
export function orderRoute(at: readonly Point[], start = 0, end?: number): number[] {
  const n = at.length;
  if (n === 0) return [];
  const s = Number.isInteger(start) && start >= 0 && start < n ? start : 0;
  const e = end !== undefined && Number.isInteger(end) && end >= 0 && end < n && end !== s ? end : undefined;

  const order = [s];
  const left = new Set(at.map((_, i) => i).filter((i) => i !== s && i !== e));
  while (left.size > 0) {
    const last = at[order[order.length - 1]];
    let best = -1, bestD = Infinity;
    for (const i of left) {
      const d = metersBetween(last, at[i]);
      if (d < bestD || (d === bestD && i < best)) { best = i; bestD = d; }
    }
    order.push(best);
    left.delete(best);
  }
  if (e !== undefined) order.push(e);

  // 2-opt, keeping both ends fixed: only interior segments are reversed.
  const lastMovable = e !== undefined ? order.length - 2 : order.length - 1;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 100) {
    improved = false;
    for (let i = 1; i < lastMovable; i++) {
      for (let k = i + 1; k <= lastMovable; k++) {
        const next = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        if (routeLength(next, at) + 1e-6 < routeLength(order, at)) {
          order.splice(0, order.length, ...next);
          improved = true;
        }
      }
    }
  }
  return order;
}

// ═══════════════════════════════════════════════════════════════════════════
// The plan
// ═══════════════════════════════════════════════════════════════════════════

interface Zone { members: number[]; center: Point }

function isArrival(t: Task): boolean {
  return typeof t.id === 'string' && t.id.startsWith(ARRIVAL_ID_PREFIX);
}

/** Merge the two zones whose centres are closest, until at most `max` remain. */
function mergeClosest(zones: Zone[], pins: Point[], max: number): Zone[] {
  const out = zones.map((z) => ({ members: [...z.members], center: z.center }));
  while (out.length > max) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const d = metersBetween(out[i].center, out[j].center);
        if (d < bd) { bi = i; bj = j; bd = d; }
      }
    }
    const members = [...out[bi].members, ...out[bj].members].sort((a, b) => a - b);
    out.splice(bj, 1);
    out[bi] = { members, center: centroid(members.map((m) => pins[m])) };
  }
  return out;
}

/**
 * Can this game be planned by area at all, and would it change anything? Cheap enough for a render:
 * the Builder shows its offer only when this is true.
 */
export function zonePlanWorthIt(game: Pick<Game, 'stages'> | null | undefined, copy: ZonePlanCopy): boolean {
  const plan = planZoneStages(game, copy);
  return plan !== null && plan.movedCount > 0;
}

/**
 * The game regrouped one stage per area, or null when there is nothing to do: fewer than two areas,
 * an authored unlock graph or exclusive group (the creator's own logic is never rewritten), or a
 * malformed game.
 *
 * `newId` mints ids for new stages and arrival missions; injected so tests are deterministic.
 */
export function planZoneStages(
  game: (Pick<Game, 'stages'> & Partial<Pick<Game, 'wizardSteps'>>) | null | undefined,
  copy: ZonePlanCopy,
  newId: (seed: string) => string = (seed) => seed,
): ZonePlan | null {
  try {
    return plan(game, copy, newId);
  } catch {
    return null;
  }
}

function plan(
  game: (Pick<Game, 'stages'> & Partial<Pick<Game, 'wizardSteps'>>) | null | undefined,
  copy: ZonePlanCopy,
  newId: (seed: string) => string,
): ZonePlan | null {
  const oldStages = Array.isArray(game?.stages) ? game!.stages : [];
  if (oldStages.length === 0) return null;

  // The creator's own logic is never rewritten: an authored gate or exclusive group means hands off.
  const authored = oldStages.some((s) =>
    (Array.isArray(s.exclusiveGroups) && s.exclusiveGroups.length > 0)
    || (s.tasks ?? []).some((t) => !isArrival(t) && Array.isArray(t.unlockAfterTaskIds)
      // A gate on one of OUR arrival missions is ours to re-derive, not the creator's logic.
      && t.unlockAfterTaskIds.some((dep) => typeof dep !== 'string' || !dep.startsWith(ARRIVAL_ID_PREFIX))));
  if (authored) return null;

  // Flatten in story order, dropping arrival missions from an earlier plan (they are re-derived).
  const flat: { task: Task; stageId: string }[] = [];
  for (const s of oldStages) for (const t of s.tasks ?? []) if (!isArrival(t)) flat.push({ task: t, stageId: s.id });
  if (flat.length < MIN_TASKS_PER_ZONE_STAGE * 2) return null;

  // Not before the pins are in. A mission that is played at a spot (not locationless) but has no pin
  // yet would follow the last located mission into ITS area, and a half-pinned game collapses into a
  // couple of stuffed stages (found in the browser: five stages became two, one of nine missions).
  if (flat.some((f) => f.task.locationless !== true && pinOf(f.task) === null)) return null;

  const located = flat.map((f, i) => ({ i, pin: pinOf(f.task) })).filter((x): x is { i: number; pin: Point } => x.pin !== null);
  if (located.length < 2) return null;
  const pins = located.map((x) => x.pin);

  let zones: Zone[] = clusterPoints(pins).map((members) => ({ members, center: centroid(members.map((m) => pins[m])) }));
  if (zones.length < 2) return null;
  zones = mergeClosest(zones, pins, MAX_ZONES);

  // Which zone each flat index belongs to (located ones only).
  const zoneOfFlat = new Map<number, number>();
  zones.forEach((z, zi) => z.members.forEach((m) => zoneOfFlat.set(located[m].i, zi)));

  // Route: from the opener's zone (or the first located mission's), ending at the finale's zone.
  const openerZone = zoneOfFlat.get(0) ?? zoneOfFlat.get(located[0].i)!;
  const finaleZone = zoneOfFlat.get(flat.length - 1);
  const route = orderRoute(zones.map((z) => z.center), openerZone, finaleZone);

  // Buckets per route position. A located mission goes to its zone; a pin-less one follows the
  // located mission before it in the story (or the first stage when none came before).
  const posOfZone = new Map(route.map((zi, pos) => [zi, pos]));
  const buckets: number[][] = route.map(() => []);
  let lastPos = 0;
  flat.forEach((_, i) => {
    const zi = zoneOfFlat.get(i);
    if (zi !== undefined) lastPos = posOfZone.get(zi)!;
    buckets[zi !== undefined ? posOfZone.get(zi)! : lastPos].push(i);
  });
  // The bookends keep their ends: the opener first of all, the finale last of all.
  const pin = (i: number, pos: number, front: boolean) => {
    for (const b of buckets) { const k = b.indexOf(i); if (k >= 0) b.splice(k, 1); }
    if (front) buckets[pos].unshift(i); else buckets[pos].push(i);
  };
  pin(0, 0, true);
  pin(flat.length - 1, buckets.length - 1, false);

  // A stage below the floor: borrow a pin-less mission from the fullest stage, or merge the stage
  // into its route neighbour when nothing can be borrowed.
  for (let guard = 0; guard < 50; guard++) {
    const thin = buckets.findIndex((b) => b.length < MIN_TASKS_PER_ZONE_STAGE);
    if (thin < 0) break;
    const donor = buckets
      .map((b, pos) => ({ pos, free: b.filter((i) => zoneOfFlat.get(i) === undefined && i !== 0 && i !== flat.length - 1) }))
      .filter((d) => d.pos !== thin && d.free.length > 0 && buckets[d.pos].length > MIN_TASKS_PER_ZONE_STAGE)
      .sort((a, b) => buckets[b.pos].length - buckets[a.pos].length)[0];
    if (donor) {
      const moved = donor.free[donor.free.length - 1];
      buckets[donor.pos].splice(buckets[donor.pos].indexOf(moved), 1);
      buckets[thin].push(moved);
      continue;
    }
    if (buckets.length <= 1) break;
    const into = thin === buckets.length - 1 ? thin - 1 : thin + 1;
    const merged = into < thin ? [...buckets[into], ...buckets[thin]] : [...buckets[thin], ...buckets[into]];
    buckets[Math.min(into, thin)] = merged;
    buckets.splice(Math.max(into, thin), 1);
    route.splice(Math.max(into, thin), 1);
  }
  if (buckets.length < 2) return null;

  // Fewer areas than the game had stages: keep the game's stages (found in the browser: a five-stage
  // composed game over two areas came out as two long stages, losing its difficulty arc and every
  // stage transition). The largest area is split into CONSECUTIVE stages, so there is still no back
  // and forth; `areaOf` remembers which area each stage belongs to, so only a change of area opens
  // with an arrival mission.
  const areaOf = [...route];
  const targetStages = Math.min(oldStages.length, Math.floor(flat.length / MIN_TASKS_PER_ZONE_STAGE));
  while (buckets.length < targetStages) {
    let bi = -1;
    buckets.forEach((b, i) => {
      if (b.length >= MIN_TASKS_PER_ZONE_STAGE * 2 && (bi < 0 || b.length > buckets[bi].length)) bi = i;
    });
    if (bi < 0) break;
    const b = buckets[bi];
    const cut = Math.ceil(b.length / 2);
    buckets.splice(bi, 1, b.slice(0, cut), b.slice(cut));
    areaOf.splice(bi, 0, areaOf[bi]);
  }

  // Partial completion: keep the game's own ratio of required to offered missions.
  const offered = oldStages.reduce((a, s) => a + (s.tasks ?? []).filter((t) => !isArrival(t)).length, 0);
  const required = oldStages.reduce((a, s) => {
    const n = (s.tasks ?? []).filter((t) => !isArrival(t)).length;
    return a + (typeof s.requiredTaskCount === 'number' && s.requiredTaskCount > 0 ? Math.min(s.requiredTaskCount, n) : n);
  }, 0);
  const ratio = offered > 0 ? required / offered : 1;

  // Build. The first stages keep their ids (anything pointing at a stage keeps resolving).
  // A stage's centre is its own pins'; a split-off stage with no pins borrows its area's.
  const centers: Point[] = [];
  buckets.forEach((b, pos) => {
    const pins = b.map((i) => pinOf(flat[i].task)).filter((p): p is Point => p !== null);
    centers.push(pins.length > 0 ? centroid(pins) : (centers[pos - 1] ?? zones[areaOf[pos]]?.center ?? centroid(pins)));
  });
  const stages: Stage[] = buckets.map((b, pos) => {
    const keep = oldStages[pos];
    const id = keep?.id ?? newId(`zone-stage-${pos + 1}`);
    let tasks = b.map((i) => flat[i].task);

    // Only a CHANGE of area can need an arrival; a stage split from the same area never does.
    const far = pos > 0 && areaOf[pos] !== areaOf[pos - 1]
      && metersBetween(centers[pos - 1], centers[pos]) > ARRIVAL_GATE_MIN_METERS;
    let arrival: Task | null = null;
    if (far) {
      const spread = Math.max(0, ...b.map((i) => pinOf(flat[i].task)).filter((p): p is Point => p !== null)
        .map((p) => metersBetween(p, centers[pos])));
      arrival = {
        id: `${ARRIVAL_ID_PREFIX}${newId(`${id}`)}`,
        title: copy.arrivalTitle(pos + 1),
        description: copy.arrivalDescription,
        type: 'geofence',
        coordinates: centers[pos],
        triggerMode: 'radius',
        geofenceRadiusMeters: Math.round(Math.max(ARRIVAL_RADIUS_FLOOR_METERS, spread + ARRIVAL_RADIUS_MARGIN_METERS)),
        difficulty: 1,
        estimatedMinutes: Math.max(1, Math.round(metersBetween(centers[pos - 1], centers[pos]) / 80)),
        pointValue: 20,
        maxConcurrentTeams: 99,
      } as Task;
      tasks = [arrival, ...tasks.map((t) => ({ ...t, unlockAfterTaskIds: [arrival!.id] }))];
    } else {
      tasks = tasks.map((t) => {
        if (!Array.isArray(t.unlockAfterTaskIds)) return t;
        const { unlockAfterTaskIds: _gone, ...rest } = t;
        return rest as Task;
      });
    }

    const own = b.length;
    const need = ratio >= 1 ? own : Math.max(1, Math.min(own, Math.round(own * ratio)));
    const stage: Stage = {
      ...(keep ?? {}),
      id,
      order: pos,
      title: keep?.title ?? copy.stageTitle(pos + 1),
      tasks,
      isFinal: pos === buckets.length - 1 ? true : undefined,
    } as Stage;
    if (stage.isFinal === undefined) delete (stage as { isFinal?: boolean }).isFinal;
    // Always explicit, like every composed stage: the arrival mission is one more required one.
    stage.requiredTaskCount = need + (arrival ? 1 : 0);
    return stage;
  });

  // How many missions changed stage.
  const newStageOf = new Map<string, string>();
  stages.forEach((s) => s.tasks.forEach((t) => newStageOf.set(t.id, s.id)));
  const movedCount = flat.filter((f) => newStageOf.get(f.task.id) !== f.stageId).length;

  // Quick Setup steps follow their mission to its new stage; a step on a removed stage drops its
  // stage pointer rather than dangling.
  const wizardSteps = Array.isArray(game?.wizardSteps)
    ? game!.wizardSteps!.map((st) => {
      if (st.taskId && newStageOf.has(st.taskId)) return { ...st, stageId: newStageOf.get(st.taskId)! };
      return st;
    })
    : undefined;

  return {
    stages,
    ...(wizardSteps ? { wizardSteps } : {}),
    // Areas, not stages: a large area can span consecutive stages.
    zoneCount: new Set(areaOf).size,
    arrivalCount: stages.filter((s) => s.tasks.some(isArrival)).length,
    movedCount,
  };
}

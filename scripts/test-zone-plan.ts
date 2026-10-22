// Areas from the pins: one stage per area, in walking order (change: composer-v2-zones).
// The pure planner in apps/creator-web/src/lib/zonePlan.ts, checked on synthetic games with real
// Jerusalem coordinates, plus the exact structural battery `updateGame` runs on save.
//   npx tsx scripts/test-zone-plan.ts
import {
  gameStructureProblems, requiredTaskCountProblem, validateUnlockGraph, maxCompletableTasks,
  type Stage, type Task,
} from '@rushpoint/shared';
import {
  clusterPoints, orderRoute, metersBetween, pinOf, planZoneStages, zonePlanWorthIt,
  ZONE_EPS_METERS, ARRIVAL_GATE_MIN_METERS, ARRIVAL_ID_PREFIX, MAX_ZONES, MIN_TASKS_PER_ZONE_STAGE,
  type Point, type ZonePlanCopy,
} from '../apps/creator-web/src/lib/zonePlan';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

const COPY: ZonePlanCopy = {
  stageTitle: (n) => `Area ${n}`,
  arrivalTitle: (n) => `Get to area ${n}`,
  arrivalDescription: 'Walk to the area on the map.',
};

// Three real areas, each about a kilometre from the next.
const PARK: Point = { lat: 31.7810, lng: 35.2060 };   // Sacher Park-ish
const CENTER: Point = { lat: 31.7820, lng: 35.2170 }; // city centre-ish
const MARKET: Point = { lat: 31.7850, lng: 35.2120 }; // market-ish
const near = (p: Point, dLat: number, dLng: number): Point => ({ lat: p.lat + dLat, lng: p.lng + dLng });

let seq = 0;
const located = (at: Point, extra: Partial<Task> = {}): Task => ({
  id: `t${++seq}`, title: `M${seq}`, type: 'photo', coordinates: at, triggerMode: 'radius',
  difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 5, ...extra,
} as Task);
const anywhere = (extra: Partial<Task> = {}): Task => ({
  id: `t${++seq}`, title: `M${seq}`, type: 'self_report', coordinates: { lat: 0, lng: 0 }, locationless: true,
  triggerMode: 'locationless', difficulty: 3, estimatedMinutes: 5, pointValue: 50, maxConcurrentTeams: 5, ...extra,
} as Task);
const stage = (id: string, tasks: Task[], extra: Partial<Stage> = {}): Stage => ({ id, order: 0, title: id, tasks, requiredTaskCount: tasks.length, ...extra } as Stage);

// ── Geometry ────────────────────────────────────────────────────────────────
ok('three far areas cluster into three', clusterPoints([PARK, near(PARK, 0.0005, 0), CENTER, near(CENTER, 0, 0.0005), MARKET]).length === 3);
ok('pins within the radius join, transitively',
  clusterPoints([PARK, near(PARK, 0.0018, 0), near(PARK, 0.0036, 0)]).length === 1
  && metersBetween(PARK, near(PARK, 0.0036, 0)) > ZONE_EPS_METERS);
ok('a pin-less mission has no pin', pinOf(anywhere()) === null && pinOf({ coordinates: { lat: 0, lng: 0 } } as Task) === null);
ok('garbage coordinates have no pin', pinOf({ coordinates: { lat: 'x', lng: 1 } } as never) === null && pinOf(null) === null);

// A square walked as a bow tie crosses itself; 2-opt must uncross it.
const sq: Point[] = [{ lat: 0.001, lng: 0.001 }, { lat: 0.001, lng: 0.011 }, { lat: 0.011, lng: 0.001 }, { lat: 0.011, lng: 0.011 }];
const r = orderRoute(sq, 0);
const len = (o: number[]) => o.slice(1).reduce((a, i, k) => a + metersBetween(sq[o[k]], sq[i]), 0);
ok('the route starts where it is told', r[0] === 0);
ok('the route visits every point once', [...r].sort().join() === '0,1,2,3');
ok('the route is no longer than walking the square', len(r) <= len([0, 1, 3, 2]) + 1);
const fixed = orderRoute([PARK, CENTER, MARKET], 0, 1);
ok('a fixed end stays last', fixed[0] === 0 && fixed[fixed.length - 1] === 1);

// ── A composed game whose pins zig-zag across three areas ───────────────────
seq = 0;
const zigzag = () => {
  const opener = anywhere({ title: 'Opener' });
  const a1 = located(near(PARK, 0.0002, 0));
  const b1 = located(near(CENTER, 0, 0.0002));
  const free1 = anywhere();
  const c1 = located(near(MARKET, 0.0003, 0));
  const a2 = located(near(PARK, -0.0002, 0.0002));
  const b2 = located(near(CENTER, 0.0003, 0));
  const free2 = anywhere();
  const c2 = located(near(MARKET, 0, -0.0003));
  const finale = located(near(MARKET, 0.0001, 0.0001), { title: 'Finale' });
  return {
    stages: [
      stage('s1', [opener, a1, b1, free1]),
      stage('s2', [c1, a2, b2]),
      stage('s3', [free2, c2, finale], { isFinal: true }),
    ],
    wizardSteps: [{ id: 'w1', stageId: 's1', taskId: b1.id, targetFieldPath: 'coordinates', instructionPrompt: 'pin it', isRequired: true }],
    ids: { opener, a1, a2, b1, b2, c1, c2, finale, free1, free2 },
  };
};
const g = zigzag();
const plan = planZoneStages(g, COPY);
ok('a zig-zag game gets a plan', plan !== null);
if (plan) {
  const real = (s: Stage) => s.tasks.filter((t) => !t.id.startsWith(ARRIVAL_ID_PREFIX));
  ok('one stage per area', plan.stages.length === 3 && plan.zoneCount === 3, String(plan.stages.length));
  const areasOf = (s: Stage) => new Set(real(s).map((t) => pinOf(t)).filter((p): p is Point => !!p)
    .map((p) => [PARK, CENTER, MARKET].map((a) => metersBetween(a, p)).reduce((bi, d, i, arr) => (d < arr[bi] ? i : bi), 0)));
  ok('every stage holds pins of ONE area', plan.stages.every((s) => areasOf(s).size === 1), plan.stages.map((s) => [...areasOf(s)].join('+')).join(' | '));
  ok('the opener is still the first mission', real(plan.stages[0])[0].id === g.ids.opener.id);
  const last = plan.stages[plan.stages.length - 1];
  ok('the finale is still the last mission', last.tasks[last.tasks.length - 1].id === g.ids.finale.id);
  ok('the finale\'s area is the last stage', areasOf(last).has(2));
  ok('exactly one final stage, and it is the last', plan.stages.filter((s) => s.isFinal).length === 1 && last.isFinal === true);
  ok('no mission lost or duplicated',
    plan.stages.flatMap(real).map((t) => t.id).sort().join() === Object.values(g.ids).map((t) => t.id).sort().join());
  ok('every stage meets the floor', plan.stages.every((s) => real(s).length >= MIN_TASKS_PER_ZONE_STAGE));
  ok('a pin-less mission follows the located mission before it',
    plan.stages.findIndex((s) => s.tasks.some((t) => t.id === g.ids.free1.id)) === plan.stages.findIndex((s) => s.tasks.some((t) => t.id === g.ids.b1.id))
    || plan.stages.findIndex((s) => s.tasks.some((t) => t.id === g.ids.free1.id)) === 0);
  ok('missions moved, and the plan says how many', plan.movedCount > 0);

  // Arrival gates on far areas.
  const far = plan.stages.slice(1).filter((s) => s.tasks[0].id.startsWith(ARRIVAL_ID_PREFIX));
  ok('a far area opens with an arrival mission', plan.arrivalCount >= 1 && far.length === plan.arrivalCount);
  ok('the arrival is a geofence at the area', far.every((s) => s.tasks[0].type === 'geofence' && pinOf(s.tasks[0]) !== null
    && (s.tasks[0].geofenceRadiusMeters ?? 0) >= 60));
  ok('the area\'s missions unlock after the arrival', far.every((s) => s.tasks.slice(1).every((t) => t.unlockAfterTaskIds?.[0] === s.tasks[0].id)));
  ok('the arrival carries player copy from the copy object', far.every((s) => s.tasks[0].title.startsWith('Get to area') && s.tasks[0].description === COPY.arrivalDescription));
  ok('the first stage never needs an arrival', !plan.stages[0].tasks[0].id.startsWith(ARRIVAL_ID_PREFIX));
  ok('arrival threshold is the named constant', ARRIVAL_GATE_MIN_METERS === 400);

  // Server battery.
  const problems = gameStructureProblems(plan.stages);
  ok('gameStructureProblems: none', problems.length === 0, problems.join('; '));
  ok('requiredTaskCount is valid on every stage', plan.stages.every((s) => requiredTaskCountProblem(s as never) === null
    && typeof s.requiredTaskCount === 'number' && s.requiredTaskCount >= 1 && s.requiredTaskCount <= maxCompletableTasks(s as never)));
  ok('the unlock graph is valid on every stage', plan.stages.every((s) => validateUnlockGraph(s).errors.length === 0));

  // Quick Setup steps follow their mission.
  const step = plan.wizardSteps?.find((w) => w.id === 'w1');
  const stageOfB1 = plan.stages.find((s) => s.tasks.some((t) => t.id === g.ids.b1.id))!.id;
  ok('a Quick Setup step follows its mission to the new stage', step?.stageId === stageOfB1);

  // Idempotent: planning a planned game changes nothing and does not stack arrivals.
  const again = planZoneStages({ stages: plan.stages, wizardSteps: plan.wizardSteps }, COPY);
  ok('re-planning moves nothing', again !== null && again.movedCount === 0, String(again?.movedCount));
  ok('re-planning does not stack arrival missions', again !== null && again.arrivalCount === plan.arrivalCount
    && again.stages.every((s) => s.tasks.filter((t) => t.id.startsWith(ARRIVAL_ID_PREFIX)).length <= 1));
  ok('worth-it is false once planned', !zonePlanWorthIt({ stages: plan.stages }, COPY) && zonePlanWorthIt(g, COPY));
}

// ── Near areas: no arrival needed ───────────────────────────────────────────
seq = 100;
const closeA = PARK, closeB = near(PARK, 0.0030, 0); // ~330 m: two areas, but a short walk
const nearGame = { stages: [
  stage('n1', [located(closeA), located(closeB), located(near(closeA, 0.0002, 0))]),
  stage('n2', [located(near(closeB, 0.0002, 0)), anywhere()], { isFinal: true }),
] };
const np = planZoneStages(nearGame, COPY);
ok('two near areas still split', np !== null && np.zoneCount === 2);
ok('a near area needs no arrival mission', np !== null && np.arrivalCount === 0 && np.stages.every((s) => s.tasks.every((t) => !t.unlockAfterTaskIds)));

// ── Partial completion keeps its ratio ──────────────────────────────────────
seq = 200;
const partial = { stages: [
  stage('p1', [located(PARK), located(near(PARK, 0.0002, 0)), located(CENTER), located(near(CENTER, 0.0002, 0))], { requiredTaskCount: 2 }),
  stage('p2', [located(near(PARK, -0.0002, 0)), located(near(CENTER, -0.0002, 0))], { requiredTaskCount: 1, isFinal: true }),
] };
const pp = planZoneStages(partial, COPY);
ok('partial completion keeps roughly its ratio', pp !== null && pp.stages.every((s) => {
  const own = s.tasks.filter((t) => !t.id.startsWith(ARRIVAL_ID_PREFIX)).length;
  const gate = s.tasks.some((t) => t.id.startsWith(ARRIVAL_ID_PREFIX)) ? 1 : 0;
  return (s.requiredTaskCount ?? 0) - gate < own;
}));

// ── Not before the pins are in ─────────────────────────────────────────────
// Found in the browser: offered while most missions still awaited their pin, every unpinned mission
// followed the last located one, and a five-stage game collapsed into two. A mission that needs a pin
// (not locationless) and has none yet means "not ready": no plan, no offer.
seq = 250;
const waiting = { stages: [
  stage('w1', [located(PARK), located(CENTER), located(PARK, { coordinates: { lat: 0, lng: 0 } } as never)]),
  stage('w2', [located(near(PARK, 0.0002, 0)), located(near(CENTER, 0.0002, 0))], { isFinal: true }),
] };
ok('no plan while a mission still awaits its pin', planZoneStages(waiting, COPY) === null && !zonePlanWorthIt(waiting, COPY));
const waitingDone = { stages: waiting.stages.map((st) => ({ ...st, tasks: st.tasks.map((t) => (pinOf(t) ? t : { ...t, coordinates: near(PARK, 0.0001, 0.0001) })) })) };
ok('once that pin is placed, the plan is offered', planZoneStages(waitingDone, COPY) !== null);

// ── Fewer areas than stages: keep the game's stages ─────────────────────────
// Found in the browser: a five-stage composed game over two areas came out as two long stages, losing
// the difficulty arc and every stage transition. An area larger than its share is split into
// CONSECUTIVE stages (still no back and forth), and only a change of area gets an arrival mission.
seq = 260;
const five = { stages: Array.from({ length: 5 }, (_, si) => stage(`f${si + 1}`, [
  located(near(si % 2 === 0 ? PARK : MARKET, 0.0001 * si, 0)),
  located(near(si % 2 === 0 ? MARKET : PARK, 0, 0.0001 * si)),
], si === 4 ? { isFinal: true } : {})) };
const fp = planZoneStages(five, COPY);
// Two areas of five missions each, at least two per stage: at most 2 + 2 stages without a one-mission
// stage or a mixed one. So "keep the stages" means as many as the areas can honestly hold.
const maxHonest = Math.min(5, 2 * Math.floor(5 / MIN_TASKS_PER_ZONE_STAGE));
ok('a five-stage game over two areas keeps as many stages as the areas can hold', fp !== null && fp.stages.length === maxHonest, `${fp?.stages.length} vs ${maxHonest}`);
const areaOfStage = (s: Stage) => {
  const pins = s.tasks.filter((t) => !t.id.startsWith(ARRIVAL_ID_PREFIX)).map((t) => pinOf(t)).filter((p): p is Point => !!p);
  return new Set(pins.map((p) => (metersBetween(p, PARK) < metersBetween(p, MARKET) ? 'park' : 'market')));
};
ok('still one area per stage', fp !== null && fp.stages.every((s) => areaOfStage(s).size === 1));
const order = fp ? fp.stages.map((s) => [...areaOfStage(s)][0]) : [];
const changes = order.filter((a, i) => i > 0 && a !== order[i - 1]).length;
ok('the stages of an area follow one another (one change of area for two areas)', changes === 1, order.join(' > '));
ok('only the change of area gets an arrival mission', fp !== null && fp.arrivalCount === 1);
ok('the offer counts AREAS, not stages (found in the browser: "4 areas" for two)', fp !== null && fp.zoneCount === 2, String(fp?.zoneCount));
ok('a split game still passes the battery', fp !== null && gameStructureProblems(fp.stages).length === 0
  && fp.stages.every((s) => validateUnlockGraph(s).errors.length === 0 && requiredTaskCountProblem(s as never) === null));

// ── Hands off ───────────────────────────────────────────────────────────────
seq = 300;
const authoredGate = { stages: [
  stage('g1', [located(PARK, { id: 'x1' }), located(CENTER, { id: 'x2', unlockAfterTaskIds: ['x1'] }), anywhere()]),
  stage('g2', [located(MARKET), anywhere()], { isFinal: true }),
] };
ok('an authored unlock graph is never rewritten', planZoneStages(authoredGate, COPY) === null);
const grouped = { stages: [
  stage('e1', [located(PARK), located(CENTER), anywhere()], { exclusiveGroups: [['a', 'b']] } as never),
  stage('e2', [located(MARKET), anywhere()], { isFinal: true }),
] };
ok('an exclusive group is never rewritten', planZoneStages(grouped, COPY) === null);
const oneArea = { stages: [stage('o1', [located(PARK), located(near(PARK, 0.0003, 0)), anywhere(), anywhere()], { isFinal: true })] };
ok('one area: nothing to plan', planZoneStages(oneArea, COPY) === null && !zonePlanWorthIt(oneArea, COPY));
ok('garbage never throws', [null, undefined, {}, { stages: 'x' }, { stages: [{ tasks: null }] }]
  .every((v) => { try { return planZoneStages(v as never, COPY) === null; } catch { return false; } }));

// ── Too many areas merge ────────────────────────────────────────────────────
seq = 400;
const spots = Array.from({ length: 9 }, (_, i) => near(PARK, i * 0.006, (i % 3) * 0.006));
const many = { stages: [
  stage('m1', spots.slice(0, 5).flatMap((p) => [located(p), located(near(p, 0.0002, 0))])),
  stage('m2', spots.slice(5).flatMap((p) => [located(p), located(near(p, 0.0002, 0))]), { isFinal: true }),
] };
const mp = planZoneStages(many, COPY);
ok(`at most ${MAX_ZONES} areas`, mp !== null && mp.zoneCount <= MAX_ZONES && mp.zoneCount >= 2, String(mp?.zoneCount));
ok('a merged game still passes the battery', mp !== null && gameStructureProblems(mp.stages).length === 0
  && mp.stages.every((s) => validateUnlockGraph(s).errors.length === 0 && requiredTaskCountProblem(s as never) === null));

console.log(failures === 0 ? '\n✅ zone plan: ALL PASS' : `\n❌ zone plan: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

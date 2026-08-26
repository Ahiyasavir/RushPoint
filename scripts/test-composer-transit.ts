// Pure-logic tests — a mission is priced from ITS OWN profile, not a flat constant
// (change: smart-game-composer).
//
// The composer used to size every game with one number: seven minutes per
// mission, everywhere, forever. That number silently bundled about five minutes
// of walking into every mission — including missions played from a living room.
// The result was a locationless two-hour game built from two hours' worth of
// mission slots holding about thirty minutes of actual content, and a `setting`
// answer that changed nothing about the game's length.
//
// The model is now `interaction + overhead + transit`:
//   • interaction — DERIVED from the built mission (effectiveExpectedDurationMinutes),
//     so it cannot drift from the mission's own content;
//   • overhead    — uniform, the part of the old constant that really was uniform;
//   • transit     — DECLARED per bank entry, because how long it takes to reach a
//     mission is a property of where that mission is sited.
//
// What this file pins is the consequence a creator feels: two pools that differ
// ONLY in transit must produce differently sized games for the same answer, and
// the minutes reported back must be the real total rather than the interaction
// half of it.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import {
  composeGame,
  seededRng,
  missionCostMinutes,
  averageMissionCost,
  targetTaskCount,
  MINUTES_PER_TASK,
  MISSION_OVERHEAD_MINUTES,
  INDOOR_WALK_MINUTES,
  PLACED_TRANSIT_MINUTES,
  type ComposerAnswers,
  type ComposerDescriptionCopy,
} from '../apps/creator-web/src/lib/composeGame';
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}

const COPY: ComposerDescriptionCopy = {
  lead: () => 'LEAD',
  ageLabel: (b) => `AGE[${b}]`,
  ageTag: (b) => `agetag-${b}`,
  durationTag: (m) => `durtag-${m}`,
  composedLead: () => 'COMPOSED',
  activityPhrase: (t) => `phrase-${t}`,
  activityJoin: (p) => `joined(${p.join(',')})`,
  activityTag: (t) => `tag-${t}`,
  placeMissionPrompt: () => 'PLACE_IT',
  stageNames: () => ['S1', 'S2', 'S3', 'S4', 'S5'],
} as ComposerDescriptionCopy;

const base: ComposerAnswers = {
  audience: 'mixed',
  setting: 'outdoor',
  people: 20,
  minutes: 120,
  ageBandId: 'adults',
  difficultyPreference: 'balanced',
};

// The real bank already declares transit on its sited missions, so it is NOT a
// transit-free baseline. These two build explicit poles from it instead: strip
// every walk, or give every mission the same walk. Comparing those isolates the
// transit term from whatever the real bank happens to declare today.

/** The same missions with every declared walk removed. */
const NO_TRANSIT: TaskBankEntry[] = TASK_BANK.map((e) => ({ ...e, transitMinutes: 0 }));

/** The same missions with one uniform walk on every one of them. */
const withTransit = (minutes: number): TaskBankEntry[] =>
  TASK_BANK.map((e) => ({ ...e, key: `${e.key}-t`, transitMinutes: minutes }));

// ── 1. A mission's cost includes its own walk ───────────────────────────────
console.log('cost = interaction + overhead + transit');
{
  const entry = TASK_BANK[0];
  const flat = missionCostMinutes(entry);
  const sited = missionCostMinutes({ ...entry, transitMinutes: 6 });

  ok('a transit-free mission still costs its interaction plus overhead',
    flat > MISSION_OVERHEAD_MINUTES);
  ok('declaring six minutes of walking adds exactly six',
    Math.abs((sited - flat) - 6) < 1e-9);
  ok('a negative transit is floored at zero, never a discount',
    Math.abs(missionCostMinutes({ ...entry, transitMinutes: -30 }) - flat) < 1e-9);
  ok('a malformed transit is ignored rather than poisoning the sum',
    Number.isFinite(missionCostMinutes({ ...entry, transitMinutes: NaN as number })));
  ok('a non-entry costs nothing instead of throwing',
    missionCostMinutes(undefined as unknown as TaskBankEntry) === 0);
}

// ── 2. The pool prices the budget, and transit changes it ───────────────────
console.log('the pool sets the budget, so siting changes the mission count');
{
  const anywhere = averageMissionCost(NO_TRANSIT);
  const sited = averageMissionCost(withTransit(6));

  ok(`a sited pool costs more per mission (${anywhere.toFixed(2)} → ${sited.toFixed(2)})`,
    sited > anywhere);
  ok('the gap is exactly the declared walk', Math.abs((sited - anywhere) - 6) < 1e-9);

  // The real bank sits between the two poles, because only some of it is sited.
  const real = averageMissionCost(TASK_BANK);
  ok(`the real bank prices between the poles (${anywhere.toFixed(2)} < ${real.toFixed(2)} < ${sited.toFixed(2)})`,
    real > anywhere && real < sited);

  const nAnywhere = targetTaskCount(120, TASK_BANK.length, anywhere);
  const nSited = targetTaskCount(120, TASK_BANK.length, sited);
  ok(`the same two hours buys fewer sited missions (${nAnywhere} → ${nSited})`, nSited < nAnywhere);

  ok('an empty pool falls back to the flat constant rather than dividing by zero',
    averageMissionCost([]) === MINUTES_PER_TASK);
  ok('a pool that prices at zero falls back too',
    averageMissionCost([{ ...TASK_BANK[0], build: () => { throw new Error('x'); } }]) > 0);
}

// ── 3. targetTaskCount keeps its two-argument behaviour ─────────────────────
console.log('the third argument is additive, not a replacement');
{
  ok('omitting the cost reproduces the old flat sizing',
    targetTaskCount(120, 99) === targetTaskCount(120, 99, MINUTES_PER_TASK));
  ok('a zero cost falls back instead of exploding to Infinity',
    targetTaskCount(120, 99, 0) === targetTaskCount(120, 99, MINUTES_PER_TASK));
  ok('a malformed cost falls back',
    targetTaskCount(120, 99, 'abc') === targetTaskCount(120, 99, MINUTES_PER_TASK));
}

// ── 4. End to end: the same answer, two differently sited banks ─────────────
console.log('two banks differing only in transit compose differently');
{
  const a = composeGame(TASK_BANK, base, COPY, seededRng(7));
  const b = composeGame(withTransit(6), base, COPY, seededRng(7));

  const count = (r: typeof a) => (r?.stages ?? []).reduce((n, s) => n + s.tasks.length, 0);
  ok('both compose', !!a && !!b);
  ok(`the sited bank yields fewer missions (${count(a)} → ${count(b)})`, count(b) < count(a));
}

// ── 5. The reported minutes are the REAL total ──────────────────────────────
console.log('estimatedMinutes reports the whole cost, walking included');
{
  for (const transit of [0, 4, 9]) {
    const bank = transit === 0 ? TASK_BANK : withTransit(transit);
    const r = composeGame(bank, base, COPY, seededRng(21));
    if (!r) { ok(`transit=${transit}: composed`, false); continue; }

    const missions = r.stages.reduce((n, s) => n + s.tasks.length, 0);
    // Every mission carries overhead plus its walk, so the floor is exact and
    // independent of how the interaction model happens to price content.
    const floor = missions * (MISSION_OVERHEAD_MINUTES + transit);
    ok(`transit=${transit}: reported ${r.estimatedMinutes}min covers ${missions} missions (>= ${Math.round(floor)})`,
      r.estimatedMinutes >= Math.floor(floor));
  }

  // The headline claim: a two-hour answer no longer reports a half-hour game.
  const r = composeGame(TASK_BANK, base, COPY, seededRng(21));
  ok(`a two-hour answer reports something near two hours (${r?.estimatedMinutes}min)`,
    !!r && r.estimatedMinutes > 60);
}

// ── 6. Duration still matters across the range ─────────────────────────────
console.log('a longer answer still buys a longer game');
{
  const counts = [30, 60, 90, 120].map((minutes) => {
    const r = composeGame(TASK_BANK, { ...base, minutes }, COPY, seededRng(5));
    return (r?.stages ?? []).reduce((n, s) => n + s.tasks.length, 0);
  });
  ok(`mission count rises with the answer (${counts.join(' → ')})`,
    counts.every((c, i) => i === 0 || c >= counts[i - 1])
    && counts[counts.length - 1] > counts[0]);
}


// ── 7. Walking and pinning are SEPARATE questions ───────────────────────────
//
// They were one boolean, and conflating them cost accuracy in one direction and
// creator effort in the other. Pinning makes a mission's location REQUIRED, so
// every pin is a map interaction before launch: outdoors that is the route and
// worth it, indoors it was twelve mandatory pins inside one building for
// missions like "two truths and a lie", which happen wherever the team stands.
// But an indoor team still crosses the building, so charging it nothing made
// indoor games come out about an eighth short.
//
// So: `missionCostMinutes` takes MINUTES, not a flag, and the caller decides.
console.log('the walk is a number the caller supplies, not a flag');
{
  const placeless = TASK_BANK.find((e) => !e.tags.includes('locationBased'))!;
  const sitedEntry = TASK_BANK.find((e) => e.tags.includes('locationBased'))!;

  const noWalk = missionCostMinutes(placeless, 0);
  ok(`a play-from-anywhere mission with no walk costs less than with one (${noWalk.toFixed(1)})`,
    missionCostMinutes(placeless, 4) > noWalk);
  ok('the difference is exactly the walk supplied',
    Math.abs((missionCostMinutes(placeless, 4) - noWalk) - 4) < 1e-9);
  ok('an indoor-sized walk costs less than an outdoor-sized one',
    missionCostMinutes(placeless, INDOOR_WALK_MINUTES) < missionCostMinutes(placeless, PLACED_TRANSIT_MINUTES));

  // A mission that declares its own transit is describing a real leg of a real
  // route. No setting-wide default may overwrite that, in either direction.
  const declared = missionCostMinutes(sitedEntry, 0);
  ok('a declared transit ignores the supplied walk',
    Math.abs(missionCostMinutes(sitedEntry, 30) - declared) < 1e-9);

  ok('a malformed walk is treated as none',
    Math.abs(missionCostMinutes(placeless, NaN as number) - noWalk) < 1e-9);
  ok('a negative walk is treated as none',
    Math.abs(missionCostMinutes(placeless, -10) - noWalk) < 1e-9);
  ok('a boolean walk is treated as none, not as 1',
    Math.abs(missionCostMinutes(placeless, true as unknown as number) - noWalk) < 1e-9);
}

// ── 8. The three settings price differently, end to end ────────────────────
console.log('each setting produces its own shape of game');
{
  const ask = 120;
  const shape = (
    setting: 'outdoor' | 'indoor' | 'fromAnywhere',
    areas: string[],
    locationMissions = false,
  ) => {
    const r = composeGame(TASK_BANK,
      { ...base, setting, areas, minutes: ask, locationMissions } as unknown as ComposerAnswers,
      COPY, seededRng(4));
    const tasks = (r?.stages ?? []).flatMap((s) => s.tasks);
    return {
      est: r?.estimatedMinutes ?? 0,
      missions: tasks.length,
      pins: tasks.filter((t) => t.locationless === false).length,
    };
  };

  const out = shape('outdoor', ['park']);
  const ind = shape('indoor', ['office']);
  const any = shape('fromAnywhere', []);

  ok(`outdoor fills the time (${out.est}m of ${ask}m)`, out.est >= ask * 0.9);
  ok(`indoor fills the time (${ind.est}m of ${ask}m)`, ind.est >= ask * 0.8);
  ok(`no-venue fills the time (${any.est}m of ${ask}m)`, any.est >= ask * 0.9);

  ok('a walk costs missions, so a no-venue game holds the most',
    any.missions > out.missions);
}

// ── 9. Pinning is OPT-IN; walking is not ────────────────────────────────────
//
// These are two different questions and they used to be one flag, twice over.
// First, inferring "pin everything" from an outdoor venue handed an office day
// twelve mandatory map pins. Then, fixing THAT by gating the walk on the pin
// flag made an hour-long indoor game price every mission as if the team stood
// still, so it asked for more missions than the bank has and reported a
// shortfall that was really a costing error.
//
// The contract: a venue always costs a walk. A PIN is only ever requested when
// the creator asked for one.
console.log('pinning is opt-in, walking is a property of the venue');
{
  const ask = 120;
  const shape = (setting: 'outdoor' | 'indoor' | 'fromAnywhere', areas: string[], loc: boolean) => {
    const r = composeGame(TASK_BANK,
      { ...base, setting, areas, minutes: ask, locationMissions: loc } as unknown as ComposerAnswers,
      COPY, seededRng(4));
    const tasks = (r?.stages ?? []).flatMap((s) => s.tasks);
    return {
      est: r?.estimatedMinutes ?? 0,
      pins: tasks.filter((t) => t.locationless === false).length,
    };
  };

  const outOff = shape('outdoor', ['park'], false);
  const outOn = shape('outdoor', ['park'], true);
  const indOff = shape('indoor', ['office'], false);
  const indOn = shape('indoor', ['office'], true);
  const anyOn = shape('fromAnywhere', [], true);

  // Opting in is what adds pins — in EITHER venue, not just outdoors.
  ok(`outdoor: opting in adds pins (${outOff.pins} -> ${outOn.pins})`, outOn.pins > outOff.pins);
  ok(`indoor: opting in adds pins (${indOff.pins} -> ${indOn.pins})`, indOn.pins > indOff.pins);

  // With no venue there is nowhere to pin anything, whatever was asked for.
  ok(`no venue never pins, even when asked (${anyOn.pins})`, anyOn.pins === 0);

  // And the walk survives the flag being off, which is the regression above.
  ok(`outdoor still fills its time with pins off (${outOff.est}m of ${ask}m)`,
    outOff.est >= ask * 0.9);
  ok(`indoor still fills its time with pins off (${indOff.est}m of ${ask}m)`,
    indOff.est >= ask * 0.85);
}


console.log(failures === 0 ? '\n✅ composer transit model OK' : `\n❌ ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);

// Pure-logic tests — a team that joins a run already in progress
// (change: late-joiner-autostart).
//
// In production run ijI9JMITSf8C9heN1Cwp team גלעד joined after the organizer had
// pressed "start all teams". They sat 27 minutes with nothing on screen, pressed SOS
// to be noticed, and finished having completed zero missions.
//
// Nothing was broken. `startTeams` is point in time: it launches the teams that exist
// when it runs, and nothing ever asks the question again, so the team stayed
// `launched:false` forever. The console did not flag them either, because an
// unlaunched team is not "at risk" — it is simply not playing, and no triage rule
// fires for that.
//
// Two separate decisions live here, and keeping them separate is the point:
//   • `lateJoinerVerdict` — may this team start ITSELF right now? Off by default,
//     and guardian consent is upstream of it, never bypassed by it.
//   • `pendingLateJoiners` — who is stranded and needs a human told about it? This
//     one is NOT optional and does not consult the setting: the safety net has to
//     work for the organizer who never turned auto start on.
import {
  lateJoinerVerdict, pendingLateJoiners, LATE_JOIN_GRACE_MS,
} from '../packages/shared/src/lateJoiner';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}
function eqJson(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const T0 = '2026-09-10T18:00:00.000Z';
const T5 = '2026-09-10T18:05:00.000Z';
const T_BEFORE = '2026-09-10T17:55:00.000Z';

console.log('\nlate-joiner — lateJoinerVerdict');

// ── 1. Off by default: today's behaviour must be byte for byte unchanged ──────
{
  const base = { teamsStartedAt: T0, joinedAt: T5, hasStages: true };
  const v = lateJoinerVerdict({ ...base });
  eq('a late joiner IS recognised as late', v.isLate, true);
  eq('but does NOT auto start without the setting', v.autoStart, false);
  eq('and the reason names the setting, not consent', v.blockedBy, 'setting');

  eq('the setting explicitly false is still no auto start',
    lateJoinerVerdict({ ...base, autoStartLateJoiners: false }).autoStart, false);
  // A truthy-but-not-true value must NOT enable it. This flag starts play for a
  // team on its own; "not false" is not consent to that.
  for (const loose of ['true', 1, {}, [] as unknown]) {
    eq(`a ${JSON.stringify(loose)} setting does not enable auto start`,
      lateJoinerVerdict({ ...base, autoStartLateJoiners: loose as boolean }).autoStart, false);
  }
  eq('the setting literally true DOES auto start',
    lateJoinerVerdict({ ...base, autoStartLateJoiners: true }).autoStart, true);
}

// ── 2. Guardian consent is UPSTREAM and is never bypassed ────────────────────
// The retro decision was explicit: auto start must not become the one door that
// starts a minor playing without a guardian. This is the assertion that pins it.
{
  const v = lateJoinerVerdict({
    teamsStartedAt: T0, joinedAt: T5, hasStages: true,
    autoStartLateJoiners: true, requiresGuardianConsent: true,
  });
  eq('a consent-gated game never auto starts a late joiner', v.autoStart, false);
  eq('and says consent is what blocked it', v.blockedBy, 'consent');
  eq('the team is STILL reported as late, so a human is told', v.isLate, true);
  // Consent outranks the setting whichever order they are given in.
  eq('consent outranks the setting',
    lateJoinerVerdict({
      teamsStartedAt: T0, joinedAt: T5, hasStages: true,
      requiresGuardianConsent: true, autoStartLateJoiners: true,
    }).blockedBy, 'consent');
}

// ── 3. A run that has NOT started has no late joiners ────────────────────────
// This is what keeps the organizer's "everyone ready?" moment intact: before the
// start button, joining is simply joining.
{
  for (const notStarted of [undefined, null, '', '   ', 'not-a-date', 0, {}]) {
    const v = lateJoinerVerdict({
      teamsStartedAt: notStarted as string, joinedAt: T5, hasStages: true,
      autoStartLateJoiners: true,
    });
    eq(`teamsStartedAt ${JSON.stringify(notStarted)} ⇒ not late`, v.isLate, false);
    eq(`teamsStartedAt ${JSON.stringify(notStarted)} ⇒ no auto start`, v.autoStart, false);
  }
  const early = lateJoinerVerdict({
    teamsStartedAt: T0, joinedAt: T_BEFORE, hasStages: true, autoStartLateJoiners: true,
  });
  eq('a team that joined BEFORE the start is not a late joiner', early.isLate, false);
  eq('and is not auto started — the start button already covers it', early.autoStart, false);
}

// ── 4. A game with no missions cannot start anybody ──────────────────────────
{
  const v = lateJoinerVerdict({
    teamsStartedAt: T0, joinedAt: T5, hasStages: false, autoStartLateJoiners: true,
  });
  eq('an empty game does not auto start a late joiner', v.autoStart, false);
  eq('and says so', v.blockedBy, 'noStages');
}

// ── 5. Totality — this runs inside joinRun, so it must never throw ───────────
{
  const bad: unknown[] = [null, undefined, 42, 'x', [], true];
  for (const b of bad) {
    let threw = false;
    let v: ReturnType<typeof lateJoinerVerdict> | null = null;
    try { v = lateJoinerVerdict(b as never); } catch { threw = true; }
    ok(`a ${String(typeof b)} input is refused safely and never throws`,
      !threw && !!v && v.isLate === false && v.autoStart === false, JSON.stringify(v));
  }
  // The fail-safe direction is DO NOT START. A malformed run must not hand a team
  // a mission the organizer never released.
  const v = lateJoinerVerdict({
    teamsStartedAt: T0, joinedAt: 'garbage', hasStages: true, autoStartLateJoiners: true,
  });
  eq('an unparseable join time fails toward NOT starting', v.autoStart, false);
}

console.log('\nlate-joiner — pendingLateJoiners');

// ── 6. The safety net does not consult the setting ───────────────────────────
// An organizer who never turned auto start on is EXACTLY the organizer this run
// stranded. If the strip only listed teams the platform had already rescued, it
// would be silent in the only case that matters.
{
  const teams = [
    { id: 'a', displayName: 'גלעד', joinedAt: T5, launched: false },
    { id: 'b', displayName: 'Started', joinedAt: T5, launched: true },
    { id: 'c', displayName: 'Early', joinedAt: T_BEFORE, launched: false },
  ];
  const late = pendingLateJoiners(teams, T0);
  eqJson('only the stranded late joiner is listed', late.map((t) => t.id), ['a']);
  eq('and it carries a name a human can read', late[0]?.displayName, 'גלעד');
  eq('a team that WAS started is not listed', late.some((t) => t.id === 'b'), false);
  eq('a team that joined before the start is not listed', late.some((t) => t.id === 'c'), false);
}

// ── 7. How long it has been waiting — the number that makes it urgent ────────
{
  const teams = [{ id: 'a', displayName: 'x', joinedAt: T0, launched: false }];
  const late = pendingLateJoiners(teams, T_BEFORE, { nowMs: Date.parse(T5) });
  eq('the wait is measured from the JOIN, not from the run start',
    late[0]?.waitingMs, Date.parse(T5) - Date.parse(T0));
  eq('and in whole minutes for the copy', late[0]?.waitingMinutes, 5);
  // A clock that disagrees must not produce a negative wait a UI would render as
  // "waiting for -3 minutes".
  const skewed = pendingLateJoiners(teams, T_BEFORE, { nowMs: Date.parse(T_BEFORE) });
  ok('a backwards clock clamps the wait at zero',
    (skewed[0]?.waitingMs ?? -1) >= 0, String(skewed[0]?.waitingMs));
  const unknown = pendingLateJoiners(
    [{ id: 'a', displayName: 'x', joinedAt: 'garbage', launched: false }], T0,
  );
  eqJson('a team with no usable join time is still LISTED, with an unknown wait',
    unknown.map((t) => [t.id, t.waitingMs]), [['a', null]]);
}

// ── 8. Ordering and totality ─────────────────────────────────────────────────
{
  const teams = [
    { id: 'new', displayName: 'n', joinedAt: '2026-09-10T18:20:00.000Z', launched: false },
    { id: 'old', displayName: 'o', joinedAt: '2026-09-10T18:02:00.000Z', launched: false },
  ];
  eqJson('the longest wait comes first', pendingLateJoiners(teams, T0).map((t) => t.id),
    ['old', 'new']);

  for (const b of [null, undefined, 42, 'x', {}]) {
    let threw = false;
    let r: unknown;
    try { r = pendingLateJoiners(b as never, T0); } catch { threw = true; }
    ok(`a ${String(typeof b)} team list yields [] and never throws`,
      !threw && Array.isArray(r) && (r as unknown[]).length === 0, JSON.stringify(r));
  }
  eqJson('a run that never started strands nobody',
    pendingLateJoiners([{ id: 'a', displayName: 'x', joinedAt: T5, launched: false }], null), []);
  // A malformed team row must not take the strip down with it.
  const mixed = pendingLateJoiners(
    [null, { id: 'a', displayName: 'x', joinedAt: T5, launched: false }, 7] as never, T0,
  );
  eqJson('malformed rows are skipped, good rows survive', mixed.map((t) => t.id), ['a']);
}

// ── 9. The grace window ──────────────────────────────────────────────────────
// A team joining in the same second the organizer presses start is not "late" in
// any sense a human would recognise, and flagging them would make the strip cry
// wolf on the busiest moment of the run.
{
  ok('the grace window is a positive finite number of ms',
    typeof LATE_JOIN_GRACE_MS === 'number' && LATE_JOIN_GRACE_MS > 0
    && Number.isFinite(LATE_JOIN_GRACE_MS), String(LATE_JOIN_GRACE_MS));
  const withinGrace = new Date(Date.parse(T0) + Math.floor(LATE_JOIN_GRACE_MS / 2)).toISOString();
  eq('a join inside the grace window is not late',
    lateJoinerVerdict({ teamsStartedAt: T0, joinedAt: withinGrace, hasStages: true }).isLate, false);
  const past = new Date(Date.parse(T0) + LATE_JOIN_GRACE_MS + 1000).toISOString();
  eq('a join past the grace window is late',
    lateJoinerVerdict({ teamsStartedAt: T0, joinedAt: past, hasStages: true }).isLate, true);
  eqJson('the strip applies the same window',
    pendingLateJoiners([{ id: 'a', displayName: 'x', joinedAt: withinGrace, launched: false }], T0), []);
}

console.log('');
if (failures > 0) {
  console.error(`✗ late-joiner: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ late-joiner: all assertions passed');

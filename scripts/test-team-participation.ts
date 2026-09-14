// Pure-logic tests — how many of a team's people are actually here, and acting
// (change: every-member-plays).
//
// THE REPORTED PROBLEM. "It is enough for one participant to watch the video or do the
// mission for the team to advance, which leads to some members being inactive."
//
// THAT IS THE DESIGN, NOT A DEFECT. `types/index.ts` states it: "one phone per attached
// participant; EXACTLY ONE (controllerUid) may submit". Every mutating participant
// callable passes `{ requireController: true }` and `assertController` rejects every
// other device with `not-controller`. A teammate on their own phone is, by
// construction, a spectator.
//
// And a team could not even all attach: `MAX_TEAM_DEVICES = 3`, with `canAttachDevice`
// refusing the fourth as 'full'. The six-person teams in this run were physically
// unable to satisfy "everyone on their own device" before anyone tried.
//
// Meanwhile `RunTeam` already carried BOTH numbers this needs - `memberCount` (people
// the team said they are) and `deviceUids` (phones that turned up) - and nothing in the
// product ever compared them. A team of six sharing one phone was indistinguishable
// from a solo player on every screen.
//
// THE RULE THAT SHAPES EVERYTHING HERE: UNKNOWN IS A FIRST-CLASS ANSWER. `memberCount`
// is only meaningful when the game actually collects member names; in individual mode,
// and in team mode with no names field, it is 1. Reporting "five people missing" for a
// game that never asked how many people there are would be a confident lie, and a gate
// built on it would hold teams for a question they were never asked. So the shortfall is
// `null` when it cannot be known, and the gate reads null as "do not block".
import {
  teamAttendance,
  teamDeviceAllowance,
  effectiveContributorRequirement,
  contributorsSatisfied,
  teamShouldWaitForMembers,
  MEMBERS_OFFLINE_HOLD,
  TEAM_DEVICE_FLOOR,
  TEAM_DEVICE_HARD_CAP,
} from '../packages/shared/src/teamParticipation';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

/** The minimum of a team this module needs. */
const team = (memberCount: unknown, deviceUids?: unknown, id = 'founder'): never =>
  ({ id, memberCount, deviceUids } as never);

console.log('\nteam-participation — teamAttendance');

// ── 1. The reported case: six people, one phone ─────────────────────────────
{
  const a = teamAttendance(team(6, ['founder']));
  eq('six declared', a.declared, 6);
  eq('one attached', a.attached, 1);
  eq('five people are not connected', a.missing, 5);
  ok('and the team is flagged as short', a.short === true);
}

// ── 2. A full team, and an over-full one, report no gap ────────────────────
{
  const full = teamAttendance(team(3, ['a', 'b', 'c']));
  eq('a fully attached team is missing nobody', full.missing, 0);
  ok('and is not short', full.short === false);

  // More phones than declared people is legitimate (a spare handset, a parent
  // watching) and must never read as an error or a negative shortfall.
  const over = teamAttendance(team(2, ['a', 'b', 'c']));
  eq('more devices than declared members is not a shortfall', over.missing, 0);
  ok('and is not short', over.short === false);
  eq('and the attached count is reported honestly', over.attached, 3);
}

// ── 3. UNKNOWN is a first-class answer, not zero and not "all of them" ─────
{
  for (const unknown of [undefined, null, 0, Number.NaN, -3, 'six', {}]) {
    const a = teamAttendance(team(unknown, ['founder']));
    eq(`a ${JSON.stringify(unknown)} headcount yields an unknown shortfall`, a.missing, null);
    ok(`and is NOT flagged short (a gate must not block on this)`, a.short === false);
    eq(`while the attached count is still reported`, a.attached, 1);
  }
  // memberCount 1 is the DEFAULT the join path writes when a game collects no names,
  // so it cannot be distinguished from a genuine solo player. Treated as unknown for
  // the purpose of a shortfall - never as "fully attended", which would be a lie in
  // the other direction.
  const solo = teamAttendance(team(1, ['founder']));
  eq('a headcount of 1 is treated as unknown, because it is also the default', solo.missing, null);
}

// ── 4. A legacy team doc has no deviceUids — the founder is the device ─────
{
  const legacy = teamAttendance(team(4, undefined, 'founder-uid'));
  eq('a legacy doc counts the founding uid as the one attached device', legacy.attached, 1);
  eq('and reports three missing', legacy.missing, 3);
  eq('an empty deviceUids array is also just the founder', teamAttendance(team(4, [])).attached, 1);
  // Duplicated uids in a legacy/corrupt array must not inflate the count.
  eq('duplicate uids count once', teamAttendance(team(4, ['a', 'a', 'b'])).attached, 2);
  eq('non-string entries are ignored', teamAttendance(team(4, ['a', null, 7, 'b'])).attached, 2);
}

// ── 5. Totality ────────────────────────────────────────────────────────────
{
  for (const bad of [null, undefined, 42, 'x', [], true]) {
    let threw = false;
    let a: { attached: number; missing: number | null } | null = null;
    try { a = teamAttendance(bad as never); } catch { threw = true; }
    ok(`a ${String(typeof bad)} team does not throw and yields a count`,
      !threw && !!a && Number.isFinite(a.attached) && a.attached >= 0, JSON.stringify(a));
  }
}

console.log('\nteam-participation — teamDeviceAllowance');

// ── 6. A big team can finally put everyone on a phone ──────────────────────
{
  eq('a team of six may attach six devices', teamDeviceAllowance(team(6, ['a'])), 6);
  eq('a team of four may attach four', teamDeviceAllowance(team(4, ['a'])), 4);
}

// ── 7. NO team loses capacity it has today ─────────────────────────────────
// The floor is the old constant. A solo player who wants a second handset, and every
// team whose headcount is unknown, must keep exactly what they have now.
{
  eq(`the floor is today's constant :: ${TEAM_DEVICE_FLOOR}`, TEAM_DEVICE_FLOOR, 3);
  eq('a team of one keeps the floor', teamDeviceAllowance(team(1, ['a'])), TEAM_DEVICE_FLOOR);
  eq('a team of two keeps the floor', teamDeviceAllowance(team(2, ['a'])), TEAM_DEVICE_FLOOR);
  for (const unknown of [undefined, null, 0, Number.NaN, -5, 'x']) {
    eq(`an ${JSON.stringify(unknown)} headcount keeps the floor`,
      teamDeviceAllowance(team(unknown, ['a'])), TEAM_DEVICE_FLOOR);
  }
}

// ── 8. A team cannot write itself an unbounded budget ──────────────────────
{
  ok(`the hard cap is a finite number above the floor :: ${TEAM_DEVICE_HARD_CAP}`,
    Number.isFinite(TEAM_DEVICE_HARD_CAP) && TEAM_DEVICE_HARD_CAP > TEAM_DEVICE_FLOOR);
  eq('an absurd headcount is bounded by the hard cap',
    teamDeviceAllowance(team(999, ['a'])), TEAM_DEVICE_HARD_CAP);
  eq('Infinity is bounded too', teamDeviceAllowance(team(Number.POSITIVE_INFINITY, ['a'])), TEAM_DEVICE_FLOOR);
}

console.log('\nteam-participation — contributions');

// ── 9. Distinct devices only ───────────────────────────────────────────────
{
  ok('two distinct devices satisfy a two-contributor mission',
    contributorsSatisfied(['a', 'b'], 2) === true);
  ok('one device twice does NOT satisfy it',
    contributorsSatisfied(['a', 'a'], 2) === false);
  ok('one device three times still does not',
    contributorsSatisfied(['a', 'a', 'a'], 3) === false);
  ok('three distinct devices satisfy a two-contributor mission',
    contributorsSatisfied(['a', 'b', 'c'], 2) === true);
  ok('nobody satisfies a one-contributor mission', contributorsSatisfied([], 1) === false);
}

// ── 10. No requirement means nothing to satisfy ────────────────────────────
{
  for (const none of [undefined, null, 0, Number.NaN, -1, 'x']) {
    ok(`a ${JSON.stringify(none)} requirement is satisfied by nobody`,
      contributorsSatisfied([], none as number) === true);
  }
}

// ── 11. A requirement larger than the team is REDUCED, never impossible ────
// The same rule planTaskSkip applies to missions, applied to people: a mission
// authored for four contributors, played by a team of two, must not be unwinnable.
{
  eq('a four-contributor mission in a team of two requires two',
    effectiveContributorRequirement(4, 2), 2);
  eq('a two-contributor mission in a team of six requires two',
    effectiveContributorRequirement(2, 6), 2);
  eq('a requirement never exceeds the devices present',
    effectiveContributorRequirement(10, 1), 1);
  eq('no requirement stays no requirement', effectiveContributorRequirement(undefined, 6), 0);
  eq('a team with no devices requires nobody', effectiveContributorRequirement(3, 0), 0);
  for (const bad of [Number.NaN, -2, 'x', null]) {
    eq(`a ${JSON.stringify(bad)} requirement is zero`,
      effectiveContributorRequirement(bad as number, 5), 0);
    ok(`a ${JSON.stringify(bad)} device count never throws`,
      Number.isFinite(effectiveContributorRequirement(3, bad as number)));
  }
}

// ── 12. The invariants, swept ──────────────────────────────────────────────
{
  let seed = 0x51ab33c7;
  const rnd = (n: number): number => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed % n;
  };
  const SWEEPS = 6000;
  let violations = 0;
  let sawBig = 0;
  for (let i = 0; i < SWEEPS; i++) {
    const members = rnd(3) === 0 ? (undefined as unknown as number) : rnd(1200);
    const devices = Array.from({ length: rnd(8) }, (_, k) => `d${k}`);
    const allowance = teamDeviceAllowance(team(members, devices));
    // The allowance never costs a team capacity it has today, and never exceeds the cap.
    if (allowance < TEAM_DEVICE_FLOOR || allowance > TEAM_DEVICE_HARD_CAP) violations++;
    if (allowance > TEAM_DEVICE_FLOOR) sawBig++;

    const a = teamAttendance(team(members, devices));
    // A shortfall is never negative, and `short` agrees with it.
    if (a.missing !== null && a.missing < 0) violations++;
    if (a.short !== (a.missing !== null && a.missing > 0)) violations++;

    // A reduced requirement is always satisfiable by the devices present.
    const req = effectiveContributorRequirement(rnd(10), devices.length);
    if (req > devices.length) violations++;
    if (!contributorsSatisfied(devices, req)) violations++;
  }
  ok(`allowance, shortfall and requirement invariants hold :: ${SWEEPS} sweeps`,
    violations === 0, `${violations} violation(s)`);
  ok(`the sweep exercised the raised allowance :: ${sawBig} above the floor`, sawBig > 100);
}


console.log('');
console.log('team-participation — the attendance gate');

// ── 13. Off by default: today's behaviour is untouched ─────────────────────
{
  ok('a game that never set the option holds nobody',
    teamShouldWaitForMembers(team(6, ['founder']), {}) === false);
  ok('the option explicitly false holds nobody',
    teamShouldWaitForMembers(team(6, ['founder']), { requireAllMembersOnline: false }) === false);
  // Only a LITERAL true. This holds a team out of a game they came to play, so
  // "not false" is not consent to that.
  for (const loose of ['true', 1, {}, []]) {
    ok(`a ${JSON.stringify(loose)} setting holds nobody`,
      teamShouldWaitForMembers(team(6, ['founder']),
        { requireAllMembersOnline: loose as boolean }) === false);
  }
}

// ── 14. On, a short team waits ─────────────────────────────────────────────
{
  ok('a team of six with one phone waits',
    teamShouldWaitForMembers(team(6, ['founder']), { requireAllMembersOnline: true }) === true);
  ok('a fully attached team does not wait',
    teamShouldWaitForMembers(team(3, ['a', 'b', 'c']), { requireAllMembersOnline: true }) === false);
  ok('more phones than people does not wait',
    teamShouldWaitForMembers(team(2, ['a', 'b', 'c']), { requireAllMembersOnline: true }) === false);
}

// ── 15. FAILS OPEN on an unknown headcount ─────────────────────────────────
// This is the assertion that keeps the gate honest. `memberCount` is only meaningful
// when the game collects member names, so holding on it would block teams for a
// question they were never asked.
{
  for (const unknown of [undefined, null, 0, 1, Number.NaN, -2, 'six', {}]) {
    ok(`an ${JSON.stringify(unknown)} headcount never holds`,
      teamShouldWaitForMembers(team(unknown, ['founder']),
        { requireAllMembersOnline: true }) === false);
  }
}

// ── 16. Totality — this decides whether a child gets to play ──────────────
{
  for (const bad of [null, undefined, 42, 'x', [], true]) {
    let threw = false;
    let held: unknown;
    try { held = teamShouldWaitForMembers(bad as never, { requireAllMembersOnline: true }); }
    catch { threw = true; }
    ok(`a ${String(typeof bad)} team does not throw and does not hold`,
      !threw && held === false, String(held));
    let threw2 = false;
    try { teamShouldWaitForMembers(team(6, ['a']), bad as never); } catch { threw2 = true; }
    ok(`a ${String(typeof bad)} game does not throw`, !threw2);
  }
  ok('the hold reason is a stable, non-empty wire string',
    typeof MEMBERS_OFFLINE_HOLD === 'string' && MEMBERS_OFFLINE_HOLD.length > 0
    && MEMBERS_OFFLINE_HOLD === MEMBERS_OFFLINE_HOLD.trim(), MEMBERS_OFFLINE_HOLD);
}

console.log('');
if (failures > 0) {
  console.error(`✗ team-participation: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ team-participation: all assertions passed');

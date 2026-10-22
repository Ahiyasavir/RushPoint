// Pure-logic test for a run prepared ahead of the day (change: prepared-run).
//
// A prepared run is `status: 'draft'`: it has its join code, staff codes, prints and console,
// but nobody can be started and nothing is scored until the organizer opens it. Every decision
// about that phase lives in packages/shared/src/preparedRun.ts and is pinned here.
//   npx tsx scripts/test-prepared-run.ts
import {
  runPhase, runOpenProblem, registrationOpen, cleanRunEventDetails, preparedRunChecklist,
  DRAFT_REFUSED_CALLABLES, RUN_EVENT_MEETING_POINT_MAX, RUN_EVENT_NOTE_MAX,
  type PreparedRunChecklistRow,
} from '../packages/shared/src/preparedRun';

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) { passes++; return; }
  console.log(`FAIL  ${label}${detail ? ' :: ' + detail : ''}`);
  failures++;
}

// ── runPhase: what the run IS, for every label in both apps ────────────────────
check('draft is preparing', runPhase({ status: 'draft' }) === 'preparing');
check('live is live', runPhase({ status: 'live' }) === 'live');
check('finished is finished', runPhase({ status: 'finished' }) === 'finished');
check('finished + cancelledAt is cancelled', runPhase({ status: 'finished', cancelledAt: '2026-10-08T10:00:00Z' }) === 'cancelled');
check('blank cancelledAt is not a cancel', runPhase({ status: 'finished', cancelledAt: '  ' }) === 'finished');
check('a cancelledAt on a live run does not end it', runPhase({ status: 'live', cancelledAt: '2026-10-08T10:00:00Z' }) === 'live');
// The listings that feed these labels have always read an absent status as live.
check('absent status reads as live', runPhase({}) === 'live');
check('null run reads as live', runPhase(null) === 'live');
check('garbage status reads as live', runPhase({ status: 42 as unknown as string }) === 'live');

// ── runOpenProblem: the server's one question before starting or scoring ───────
check('draft is not open', runOpenProblem({ status: 'draft' }) === 'run-not-open');
check('finished is finished', runOpenProblem({ status: 'finished' }) === 'run-finished');
check('live is open', runOpenProblem({ status: 'live' }) === null);
// Fail OPEN for a missing status: legacy runs carry `live`, and refusing an unknown run would
// stop a real event. The refusal is only for a status that says so.
check('absent status is open', runOpenProblem({}) === null);
check('null run is open', runOpenProblem(null) === null);

// ── registrationOpen ──────────────────────────────────────────────────────────
check('draft registers by default', registrationOpen({ status: 'draft' }) === true);
check('draft with early registration off refuses', registrationOpen({ status: 'draft', earlyRegistration: false }) === false);
check('only a literal false closes it', registrationOpen({ status: 'draft', earlyRegistration: 'false' as unknown as boolean }) === true);
check('live always registers', registrationOpen({ status: 'live', earlyRegistration: false }) === true);
check('finished never registers', registrationOpen({ status: 'finished' }) === false);

// ── cleanRunEventDetails: what updateRunEventDetails accepts ──────────────────
{
  const r = cleanRunEventDetails({ plannedStartAt: '2026-10-15T07:00:00.000Z', meetingPoint: '  גן סאקר, הכניסה מרחוב בורלא ', eventNote: 'להביא מים', earlyRegistration: false });
  check('valid details are ok', r.ok === true, JSON.stringify(r));
  if (r.ok) {
    check('date normalised to ISO', r.set.plannedStartAt === '2026-10-15T07:00:00.000Z');
    check('meeting point trimmed', r.set.meetingPoint === 'גן סאקר, הכניסה מרחוב בורלא');
    check('note kept', r.set.eventNote === 'להביא מים');
    check('early registration kept', r.set.earlyRegistration === false);
    check('nothing cleared', r.clear.length === 0);
  }
}
{
  // Absent = untouched; empty string or null = clear (the transport turns undefined into null).
  const r = cleanRunEventDetails({ meetingPoint: '', eventNote: null });
  check('empty and null clear', r.ok === true && r.clear.includes('meetingPoint') && r.clear.includes('eventNote'), JSON.stringify(r));
  check('absent keys are untouched', r.ok === true && !r.clear.includes('plannedStartAt') && !('plannedStartAt' in r.set));
}
{
  // A date in the past is accepted: fixing a typo on the morning must not be refused.
  const r = cleanRunEventDetails({ plannedStartAt: '2020-01-01T08:00:00Z' });
  check('a past date is accepted', r.ok === true);
}
check('an unparseable date is refused', cleanRunEventDetails({ plannedStartAt: 'next thursday' }).ok === false);
check('a number date is refused', cleanRunEventDetails({ plannedStartAt: 1760000000000 }).ok === false);
check('a far-future date is refused', cleanRunEventDetails({ plannedStartAt: '2999-01-01T00:00:00Z' }).ok === false);
check('a too-long meeting point is refused', cleanRunEventDetails({ meetingPoint: 'א'.repeat(RUN_EVENT_MEETING_POINT_MAX + 1) }).ok === false);
check('a too-long note is refused', cleanRunEventDetails({ eventNote: 'א'.repeat(RUN_EVENT_NOTE_MAX + 1) }).ok === false);
check('a non-boolean early registration is refused', cleanRunEventDetails({ earlyRegistration: 'yes' }).ok === false);
check('a whitespace-only meeting point clears', (() => { const r = cleanRunEventDetails({ meetingPoint: '   ' }); return r.ok && r.clear.includes('meetingPoint'); })());
check('newlines in the meeting point become spaces', (() => { const r = cleanRunEventDetails({ meetingPoint: 'שער\nצפוני' }); return r.ok && r.set.meetingPoint === 'שער צפוני'; })());
check('unknown keys are refused', cleanRunEventDetails({ status: 'live' }).ok === false);
check('a non-object is refused', cleanRunEventDetails('x').ok === false && cleanRunEventDetails(null).ok === false && cleanRunEventDetails([]).ok === false);
check('an empty object is refused (nothing to do)', cleanRunEventDetails({}).ok === false);

// ── preparedRunChecklist ──────────────────────────────────────────────────────
const row = (rows: PreparedRunChecklistRow[], id: string) => rows.find((r) => r.id === id);
{
  const rows = preparedRunChecklist({});
  check('empty facts: date todo', row(rows, 'date')?.state === 'todo');
  check('empty facts: staff todo', row(rows, 'staff')?.state === 'todo');
  check('empty facts: host sheet todo', row(rows, 'hostSheet')?.state === 'todo');
  check('empty facts: join sign todo', row(rows, 'joinSign')?.state === 'todo');
  check('empty facts: rehearsal todo', row(rows, 'rehearsal')?.state === 'todo');
  check('no stations: station row hidden', row(rows, 'stationQr') === undefined);
  check('registrations is information', row(rows, 'registrations')?.state === 'info' && row(rows, 'registrations')?.count === 0);
}
{
  const rows = preparedRunChecklist({
    plannedStartAt: '2026-10-15T07:00:00Z',
    staffInviteCount: 2,
    hasStations: true,
    prints: {
      hostSheet: { printedAt: '2026-10-08T09:00:00Z', fingerprint: 'aaa' },
      stationQr: { printedAt: '2026-10-08T09:00:00Z', fingerprint: 'bbb' },
      joinSign: { printedAt: '2026-10-08T09:00:00Z', fingerprint: 'ccc' },
    },
    currentFingerprints: { hostSheet: 'aaa', stationQr: 'CHANGED', joinSign: 'ccc' },
    lastRehearsalAt: '2026-10-08T10:00:00Z',
    gameUpdatedAt: '2026-10-08T09:30:00Z',
    registeredTeams: 5,
  });
  check('date done', row(rows, 'date')?.state === 'done');
  check('staff done with count', row(rows, 'staff')?.state === 'done' && row(rows, 'staff')?.count === 2);
  check('host sheet current = done', row(rows, 'hostSheet')?.state === 'done' && row(rows, 'hostSheet')?.at === '2026-10-08T09:00:00Z');
  check('station QR changed = stale', row(rows, 'stationQr')?.state === 'stale');
  check('join sign done', row(rows, 'joinSign')?.state === 'done');
  check('rehearsal after the last edit = done', row(rows, 'rehearsal')?.state === 'done');
  check('registrations counts', row(rows, 'registrations')?.count === 5);
}
{
  const rows = preparedRunChecklist({
    lastRehearsalAt: '2026-10-08T09:00:00Z', gameUpdatedAt: '2026-10-08T10:00:00Z',
    prints: { hostSheet: { printedAt: '2026-10-08T09:00:00Z', fingerprint: 'aaa' } },
    // The current fingerprint is not known yet (the console has not built it): never claim stale.
    currentFingerprints: {},
  });
  check('edited after the rehearsal = stale', row(rows, 'rehearsal')?.state === 'stale');
  check('unknown current fingerprint = done, never a false stale', row(rows, 'hostSheet')?.state === 'done');
}
{
  // Garbage never throws and never claims done.
  let threw = false;
  let rows: PreparedRunChecklistRow[] = [];
  try {
    rows = preparedRunChecklist({
      plannedStartAt: 'nope', staffInviteCount: -3 as number, prints: { hostSheet: { printedAt: 5 as unknown as string, fingerprint: '' } },
      lastRehearsalAt: 'garbage', gameUpdatedAt: 'garbage', registeredTeams: NaN,
    } as never);
    preparedRunChecklist(null as never);
    preparedRunChecklist(undefined as never);
  } catch { threw = true; }
  check('garbage never throws', !threw);
  check('garbage date is todo', row(rows, 'date')?.state === 'todo');
  check('negative staff count is todo', row(rows, 'staff')?.state === 'todo');
  check('a print with no fingerprint is todo', row(rows, 'hostSheet')?.state === 'todo');
  check('garbage rehearsal time is todo', row(rows, 'rehearsal')?.state === 'todo');
  check('NaN registrations reads 0', row(rows, 'registrations')?.count === 0);
}
{
  // A rehearsal with an unreadable game edit time is done (we know one happened).
  const rows = preparedRunChecklist({ lastRehearsalAt: '2026-10-08T09:00:00Z' });
  check('rehearsal with no edit time = done', row(rows, 'rehearsal')?.state === 'done');
}
{
  // The order is the order an organizer works in, and it is stable.
  const ids = preparedRunChecklist({ hasStations: true }).map((r) => r.id).join(',');
  check('row order', ids === 'date,staff,rehearsal,hostSheet,stationQr,joinSign,registrations', ids);
}

// ── DRAFT_REFUSED_CALLABLES: the doors that start or score play ────────────────
const refused = DRAFT_REFUSED_CALLABLES as readonly string[];
for (const name of ['startTeams', 'finalizeRun', 'pushFlashMission', 'activateHotZone', 'skipStage', 'skipTaskForTeam', 'adjustTeamScore']) {
  check(`${name} refuses a draft`, refused.includes(name));
}
check('the list is unique', new Set(refused).size === refused.length);
// A draft must still be usable for what preparing means.
for (const name of ['joinRun', 'getJoinInfo', 'inviteStaff', 'staffSignIn', 'pushAnnouncement', 'listRunTeams']) {
  check(`${name} stays open on a draft`, !refused.includes(name));
}

console.log(`\n${failures === 0 ? `ALL PREPARED-RUN TESTS PASSED (${passes})` : `${failures} FAILED, ${passes} passed`}`);
process.exit(failures === 0 ? 0 : 1);

// What was printed, and has the game moved on since? (change: prepared-run; Ahiya 2026-10-08:
// "when you edit, the host sheet updates"). The sheet on screen is rebuilt from the game every
// time; the PAPER is what goes stale. The console compares a fingerprint of what was printed
// with what would print now, and names what changed.
//   npx tsx scripts/test-print-fingerprint.ts
import { printSummary, printFingerprint, diffPrintSummary, type PrintSummary } from '../apps/creator-web/src/lib/printFingerprint';

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { passes++; return; }
  failures++;
  console.log(`FAIL  ${label}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
}

const at = { lat: 31.77, lng: 35.21 };
const base = { difficulty: 3, estimatedMinutes: 8, pointValue: 100, maxConcurrentTeams: 99, coordinates: at };
type G = Record<string, unknown> & { stages: Array<{ id: string; title: string; tasks: Array<Record<string, unknown>> }> };
const makeGame = (): G => ({
  id: 'g1', title: 'Old City Hunt', description: 'A hunt', scoringPreset: 'fixed_points_speed', mode: 'team',
  hostSheetFields: { emergency: '050-0000000' },
  stages: [{
    id: 's1', title: 'Warm up', tasks: [
      { ...base, id: 't-quiz', title: 'Gate riddle', type: 'quiz', choices: ['Lion', 'Bear'], answers: ['SECRET_LION'] },
      { ...base, id: 't-num', title: 'Count steps', type: 'numeric', numericAnswer: 37, numericTolerance: 2 },
      { ...base, id: 't-code', title: 'Station', type: 'smart_station', smart: { enabled: true, verificationType: 'code_verification', secretCode: 'SECRET_CODE_4821' } },
    ],
  }],
});
const run = { id: 'r1', accessCode: 'JOIN42', plannedStartAt: '2026-10-15T07:00:00.000Z', meetingPoint: 'Sacher Park' };
const staff = [{ id: 'c1', label: 'Marshal', pin: 'SECRET_PIN_111', capabilities: ['announce'], legacy: false, usedUp: false, disabled: false, people: [] }];
const input = (game: G, r: Record<string, unknown> = run, s: unknown[] = staff) => ({ game, run: r, staffCodes: s as never });

const host0 = printSummary('host', input(makeGame()));
const fp0 = printFingerprint(host0);
check('fingerprint is a non-empty string', typeof fp0 === 'string' && fp0.length >= 8, fp0);
check('same input, same fingerprint', printFingerprint(printSummary('host', input(makeGame()))) === fp0);

// ── The summary carries no answer, code or PIN text (it is stored on the run) ─────
{
  const json = JSON.stringify([host0, printSummary('stations', input(makeGame())), printSummary('join', input(makeGame()))]);
  for (const secret of ['SECRET_LION', 'SECRET_CODE_4821', 'SECRET_PIN_111', '"37"', ':37']) {
    check(`summary does not carry ${secret}`, !json.includes(secret));
  }
  check('summary names the missions', host0.missions?.map((m) => m.title).join() === 'Gate riddle,Count steps,Station', host0.missions);
}

// ── What moves the host sheet fingerprint ─────────────────────────────────────
const mutate = (fn: (g: G) => void): PrintSummary => { const g = makeGame(); fn(g); return printSummary('host', input(g)); };
const moved = (label: string, s: PrintSummary) => check(`${label} moves the host sheet`, printFingerprint(s) !== fp0);
const added = mutate((g) => { g.stages[0].tasks.push({ ...base, id: 't-new', title: 'The well', type: 'field' }); });
moved('adding a mission', added);
moved('removing a mission', mutate((g) => { g.stages[0].tasks.splice(1, 1); }));
moved('renaming a mission', mutate((g) => { g.stages[0].tasks[0].title = 'Lion gate'; }));
moved('changing an answer key', mutate((g) => { g.stages[0].tasks[1].numericAnswer = 38; }));
moved('changing a station code', mutate((g) => { (g.stages[0].tasks[2].smart as Record<string, unknown>).secretCode = 'OTHER'; }));
moved('moving a mission', mutate((g) => { g.stages[0].tasks[0].coordinates = { lat: 31.78, lng: 35.22 }; }));
moved('changing the typed host fields', mutate((g) => { g.hostSheetFields = { emergency: '052-1111111' }; }));
check('changing the date moves the host sheet', printFingerprint(printSummary('host', input(makeGame(), { ...run, plannedStartAt: '2026-10-16T07:00:00.000Z' }))) !== fp0);
check('a new staff code moves the host sheet', printFingerprint(printSummary('host', input(makeGame(), run, [...staff, { ...staff[0], id: 'c2', label: 'Gate', pin: 'P2' }]))) !== fp0);

// ── What does NOT move it: an edit the paper never shows ──────────────────────
const still = (label: string, s: PrintSummary) => check(`${label} does not move the host sheet`, printFingerprint(s) === fp0);
still('a Builder-only field', mutate((g) => { g.updatedAt = '2026-10-09T00:00:00Z'; g.tags = ['family']; }));
still('the print options of the moment', printSummary('host', { ...input(makeGame()), options: { includeAnswers: false, cardPerPage: true, includeMap: false } } as never));

// ── Each document has its own fingerprint ─────────────────────────────────────
{
  const join0 = printFingerprint(printSummary('join', input(makeGame())));
  const st0 = printFingerprint(printSummary('stations', input(makeGame())));
  check('a new mission does not move the join sign', printFingerprint(printSummary('join', input(makeGame(), run))) === join0
    && printFingerprint(printSummary('join', { ...input(makeGame()), game: (() => { const g = makeGame(); g.stages[0].tasks.push({ ...base, id: 'x', title: 'X', type: 'field' }); return g; })() })) === join0);
  check('a new join code moves the join sign', printFingerprint(printSummary('join', input(makeGame(), { ...run, accessCode: 'OTHER1' }))) !== join0);
  check('a new meeting point moves the join sign', printFingerprint(printSummary('join', input(makeGame(), { ...run, meetingPoint: 'Gate 2' }))) !== join0);
  check('a station code moves the station sheet', printFingerprint(printSummary('stations', input((() => { const g = makeGame(); (g.stages[0].tasks[2].smart as Record<string, unknown>).secretCode = 'NEW'; return g; })()))) !== st0);
  check('a quiz answer does not move the station sheet', printFingerprint(printSummary('stations', input((() => { const g = makeGame(); g.stages[0].tasks[0].answers = ['X']; return g; })()))) === st0);
}

// ── diffPrintSummary names what changed ───────────────────────────────────────
{
  const kinds = (old: unknown, now: PrintSummary) => diffPrintSummary(old, now).map((c) => c.kind);
  const d1 = diffPrintSummary(host0, added);
  check('names an added mission by title', d1.some((c) => c.kind === 'missionAdded' && c.title === 'The well'), d1);
  const d2 = diffPrintSummary(host0, mutate((g) => { g.stages[0].tasks.splice(1, 1); }));
  check('names a removed mission', d2.some((c) => c.kind === 'missionRemoved' && c.title === 'Count steps'), d2);
  const d3 = diffPrintSummary(host0, mutate((g) => { g.stages[0].tasks[0].title = 'Lion gate'; }));
  check('names a rename from and to', d3.some((c) => c.kind === 'missionRenamed' && c.from === 'Gate riddle' && c.to === 'Lion gate'), d3);
  check('a rename is not also "details"', !kinds(host0, mutate((g) => { g.stages[0].tasks[0].title = 'Lion gate'; })).includes('detailsChanged'));
  check('an answer change is named', kinds(host0, mutate((g) => { g.stages[0].tasks[1].numericAnswer = 38; })).includes('answersChanged'));
  check('a move is "details"', kinds(host0, mutate((g) => { g.stages[0].tasks[0].coordinates = { lat: 31.78, lng: 35.22 }; })).includes('detailsChanged'));
  check('a date change is named', kinds(host0, printSummary('host', input(makeGame(), { ...run, plannedStartAt: '2026-10-16T07:00:00.000Z' }))).includes('dateChanged'));
  check('a staff change is named', kinds(host0, printSummary('host', input(makeGame(), run, []))).includes('staffChanged'));
  check('typed fields are named', kinds(host0, mutate((g) => { g.hostSheetFields = {}; })).includes('fieldsChanged'));
  check('no change, no diff', diffPrintSummary(host0, printSummary('host', input(makeGame()))).length === 0);
  // An old record from another version, or garbage, says "changed" without naming, never throws.
  let threw = false;
  let g: string[] = [];
  try { g = kinds({ v: 999 }, host0); kinds(null, host0); kinds('x', host0); } catch { threw = true; }
  check('garbage never throws', !threw);
  check('an unreadable record says "other"', g.join() === 'other', g);
}

console.log(`\n${failures === 0 ? `ALL PRINT-FINGERPRINT TESTS PASSED (${passes})` : `${failures} FAILED, ${passes} passed`}`);
process.exit(failures === 0 ? 0 : 1);

// Pure-logic test for the participant progress readout (change: test-mode-game-feel).
//
// WHY THIS EXISTS: PlayScreen rendered `<Progress done={completedStages}
// total={team.stages.length} />` — it counted STAGES. A 24-question assessment is
// authored as ONE stage, so the whole run showed a single empty segment that never
// moved until the end: twenty answers, a ~15 minute median, and no way for a player
// to know whether they were on question 3 or question 17.
//
// `missionProgress` counts the MISSIONS a team actually has to finish, which is
// also what makes the "question 8 of 20" counter honest. It runs on every render
// of the only screen a player has, over a document written by the server, so it is
// TOTAL: a malformed stage degrades to zero, never to a throw.
//
//   npx tsx scripts/test-mission-progress.ts
import { missionProgress } from '../apps/play-web/src/lib/missionProgress';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

type T = { status: string };
function stage(status: string, tasks: T[], requiredTaskCount?: number): unknown {
  return { stageId: 's', order: 0, status, tasks, ...(requiredTaskCount != null ? { requiredTaskCount } : {}) };
}
const done = (n: number): T[] => Array.from({ length: n }, () => ({ status: 'completed' }));
const pending = (n: number): T[] => Array.from({ length: n }, () => ({ status: 'pending' }));

// ── The bug this exists for ──────────────────────────────────────────────────
console.log('\n── one stage, many questions ──');
{
  // The assessment shape: ONE stage, 20 questions, 7 answered.
  const p = missionProgress([stage('active', [...done(7), ...pending(13)])]);
  check('counts questions, not stages', p.total === 20 && p.done === 7, JSON.stringify(p));
  check('current is the question being answered', p.current === 8, String(p.current));
  check('stage counters still available', p.stageTotal === 1 && p.stageDone === 0);
}

// ── requiredTaskCount (partial stages) ───────────────────────────────────────
console.log('\n── partial stages ──');
{
  // A team must finish 3 of 5; the other 2 auto-skip. The finish line is 3.
  const p = missionProgress([stage('active', [...done(1), ...pending(4)], 3)]);
  check('total is the REQUIRED count', p.total === 3, String(p.total));
}
{
  // Auto-skip can leave MORE completions than required. done must not exceed total.
  const p = missionProgress([stage('active', [...done(5)], 3)]);
  check('done clamps to required', p.done === 3 && p.total === 3, JSON.stringify(p));
  check('current clamps to total', p.current === 3, String(p.current));
}
{
  // requiredTaskCount larger than the stage can yield is nonsense; the tasks win.
  const p = missionProgress([stage('active', pending(2), 9)]);
  check('required is capped by task count', p.total === 2, String(p.total));
}
{
  // Nonsense values must not shrink or inflate the finish line.
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    const p = missionProgress([stage('active', pending(4), bad as number)]);
    check(`required ${String(bad)} falls back to all tasks`, p.total === 4, String(p.total));
  }
}

// ── a completed stage always reads as fully done ─────────────────────────────
console.log('\n── completed stages ──');
{
  // skipStage completes a stage WITHOUT completing its tasks. Counting task
  // records alone would leave the bar permanently short of full.
  const p = missionProgress([stage('completed', [...done(1), ...pending(3)])]);
  check('a completed stage credits its whole requirement', p.done === 4 && p.total === 4, JSON.stringify(p));
}
{
  const p = missionProgress([
    stage('completed', [...done(2)]),
    stage('active', [...done(1), ...pending(2)]),
  ]);
  check('sums across stages', p.total === 5 && p.done === 3, JSON.stringify(p));
  check('stage counters sum too', p.stageDone === 1 && p.stageTotal === 2, JSON.stringify(p));
}

// ── totality: nothing here may throw ─────────────────────────────────────────
console.log('\n── malformed input ──');
const junk: unknown[] = [
  null, undefined, 'stages', 42, {}, [],
  [null], [undefined], ['x'], [{}], [{ tasks: null }], [{ tasks: 'no' }],
  [{ tasks: [null, undefined, 'x', 7, {}] }],
  [{ status: 'completed' }],
  [{ status: 'completed', tasks: [] }],
];
for (const input of junk) {
  let p: ReturnType<typeof missionProgress> | null = null;
  let threw = false;
  try { p = missionProgress(input as never); } catch { threw = true; }
  const ok = !threw && !!p
    && Number.isInteger(p.done) && Number.isInteger(p.total)
    && p.done >= 0 && p.total >= 0 && p.done <= p.total
    && Number.isInteger(p.current) && p.current >= 0 && p.current <= Math.max(p.total, 0);
  check(`total for ${JSON.stringify(input) ?? String(input)}`, ok, threw ? 'THREW' : JSON.stringify(p));
}

// A stage with no tasks contributes nothing — the caller hides the bar at total 0.
{
  const p = missionProgress([stage('active', [])]);
  check('empty stage yields total 0', p.total === 0 && p.done === 0 && p.current === 0, JSON.stringify(p));
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

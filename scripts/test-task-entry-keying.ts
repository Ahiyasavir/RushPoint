// Every mission-entry component must be keyed by task id
// (change: entry-state-must-not-outlive-its-mission).
//
// TaskRunner does not remount when routing hands out the next mission. Its own
// reset is `useEffect(..., [assignedRec?.taskId])`, which is proof the instance
// survives a task change. So when two consecutive missions render the SAME entry
// component, React reuses that instance and its local state crosses the mission
// boundary:
//
//   NumericEntry   — the number typed for the previous mission
//   CodeEntry      — the station code
//   QuizEntry      — the free-text answer, and the `picked` highlight
//   SequenceRunner — the half-typed step answer
//   PhotoEntry     — the captured `file` AND its `preview`, primed to submit
//
// The photo case is the one that scores a wrong answer: a player photographs
// mission A, gets routed to mission B (a staff skip, or a partial-completion
// stage auto-skipping the rest), and mission B is already holding mission A's
// picture with nothing on screen to say it is stale.
//
// `OrderingEntry` and `GeofenceAuto` were already keyed, each with a comment
// describing this failure for its own case — the rule simply never travelled to
// the other seven. A source scan is the right shape of guard here because the
// defect is a missing JSX attribute in one branch: there is no runtime value to
// assert, and play-web has no component test runner.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '../apps/play-web/src/components/TaskRunner.tsx');
const src = readFileSync(FILE, 'utf8');

let failures = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
}

// Declared, never inferred — the same shape as callableHardening's allowlists, so
// a component that LOSES its key fails, and a component that disappears fails too
// (a stale entry is as much a defect as a missing key).
const ENTRY_COMPONENTS = [
  'CodeEntry',
  'QuizEntry',
  'OrderingEntry',
  'NumericEntry',
  'GeofenceAuto',
  'SequenceRunner',
  'SurveyEntry',
  'AudioEntry',
  'VideoEntry',
  'PhotoEntry',
] as const;

console.log('\n[task entry keying] every entry component is keyed by task id');

for (const name of ENTRY_COMPONENTS) {
  // Find the JSX USE (`<Name ...`), not the declaration (`function Name(`).
  const uses = [...src.matchAll(new RegExp(`<${name}\\b([^>]*?)/?>`, 'gs'))];
  if (uses.length === 0) {
    failures += 1;
    console.error(`  ✗ ${name} is declared in this list but never rendered — remove the stale entry or restore the component`);
    continue;
  }
  for (const m of uses) {
    const attrs = m[1] ?? '';
    const keyed = /\bkey=\{task\.id\}/.test(attrs);
    const line = src.slice(0, m.index ?? 0).split('\n').length;
    ok(keyed, `${name} is keyed by task.id`,
      keyed ? '' : `TaskRunner.tsx:${line} — without key={task.id} this component's local state (a typed answer, a captured photo) survives into the NEXT mission`);
  }
}

console.log('\n[task entry keying] the reason is recorded where the branch lives');
ok(/entry-state-must-not-outlive-its-mission/.test(src),
  'the branch carries the change name, so the next person adding a task type finds the rule',
  'the explanatory comment above the entry <div> was removed');
ok(/TaskRunner does NOT remount/i.test(src),
  'and states the load-bearing fact — that the parent survives a task change',
  'without this, "why is there a key here?" reads as cargo cult and gets deleted');

// ── Sibling keys must be DISTINCT ─────────────────────────────────────────────
// Found by RUNNING the app, not by reading it: the browser logged
//   Encountered two children with the same key, `spy-quiz-intro`
// twelve times on the first mission of the flagship demo. <ExpiryCountdown> and
// <MissionExtras> are both direct children of the same <Card> and both were keyed
// to a bare `task.id`, so one parent had two children with the identical key.
// React keys only have to be unique among SIBLINGS, and under a duplicate key
// reconciliation is explicitly undefined ("may cause children to be duplicated
// and/or omitted"). That voids the exact guarantee both keys were added for: a
// countdown, or an overflow menu left open, surviving into the next mission.
console.log('\n[task entry keying] sibling keys under the same parent are distinct');
{
  const SIBLINGS: Array<[string, string]> = [
    ['ExpiryCountdown', 'expiry-'],
    ['MissionExtras', 'extras-'],
  ];
  const used = new Set<string>();
  const KEY_OF: Record<string, RegExp> = {
    ExpiryCountdown: /<ExpiryCountdown[\s\S]{0,300}?key=\{`([^`]*)`/,
    MissionExtras: /<MissionExtras[\s\S]{0,300}?key=\{`([^`]*)`/,
  };
  for (const [comp, prefix] of SIBLINGS) {
    const m = src.match(KEY_OF[comp]);
    ok(!!m, comp + ' still uses a template-literal key');
    const key = m?.[1] ?? '';
    ok(key.startsWith(prefix),
      comp + " key is prefixed with '" + prefix + "'",
      'got `' + key + '` — a bare task.id here collides with its sibling under the same <Card>');
    ok(!used.has(key), comp + ' key is distinct from its siblings');
    used.add(key);
  }
}

console.log('\n[task entry keying] the premise still holds');
ok(/useEffect\(\(\) => \{[^}]*\}, \[assignedRec\?\.taskId\]\)/.test(src),
  'TaskRunner still resets its own per-task state with an effect rather than remounting — the reason child state needs explicit keys');

console.log(failures === 0 ? '\n✅ task entry keying: ALL PASS\n' : `\n❌ task entry keying: ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

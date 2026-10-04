// Pure-logic tests — grouping identical readiness problems
// (change: quick-setup-reachable).
//
// Measured on a composed birthday game at 375px: the readiness list showed six
// identical rows "this mission has no spot on the map", one per mission. The
// list is the creator's to-do list before launch; six copies of one sentence read
// as a wall, not as one job. Grouping is DISPLAY only — `computeGameReadiness`,
// `canLaunchGame` and the launch refusal still see every issue.
import { groupReadinessIssues, type ReadinessIssue } from '../apps/creator-web/src/lib/gameReadiness';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const pin = (n: number): ReadinessIssue => ({
  code: 'taskNotPlaced', stageId: 's1', stageTitle: 'S1', taskId: `t${n}`, taskTitle: `T${n}`,
});
const unnamed: ReadinessIssue = { code: 'taskNotNamed', stageId: 's2', stageTitle: 'S2', taskId: 'x', taskTitle: '' };

console.log('\nreadiness grouping');
{
  const issues = [pin(1), pin(2), unnamed, pin(3), pin(4), pin(5), pin(6)];
  const groups = groupReadinessIssues(issues);
  eq('one group per kind, in first-appearance order', groups.map((g) => g.code), ['taskNotPlaced', 'taskNotNamed']);
  eq('the counts are right', groups.map((g) => g.count), [6, 1]);
  eq('first is the first issue of that kind', groups.map((g) => g.first.taskId), ['t1', 'x']);
  eq('every issue is kept inside its group', groups.map((g) => g.issues.length), [6, 1]);
  eq('nothing is lost overall', groups.reduce((n, g) => n + g.count, 0), issues.length);

  eq('an empty list has no groups', groupReadinessIssues([]), []);
  for (const junk of [null, undefined, 'x', 42, {}]) {
    let threw = false; let out: unknown = null;
    try { out = groupReadinessIssues(junk as never); } catch { threw = true; }
    ok(`junk ${JSON.stringify(junk)} does not throw`, !threw);
    eq(`junk ${JSON.stringify(junk)} yields no groups`, out, []);
  }
  // A malformed row inside a real list is skipped, not fatal.
  eq('a malformed row is skipped', groupReadinessIssues([pin(1), null as never, { nope: 1 } as never]).map((g) => g.count), [1]);
}

console.log(failures === 0 ? '\n✅ readiness grouping: ALL PASS' : `\n❌ readiness grouping: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

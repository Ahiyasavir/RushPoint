// Benched missions — `Task.hidden` (change: mission-card-actions).
//
// A benched mission is kept in the template and takes no part in the game. The
// dangerous half of that sentence is the second one: this predicate decides
// whether a mission is removed from every run, from the gallery and from the
// readiness surface, so a reading that is too eager empties a live creator's game
// and a reading that is too shy quietly puts a benched mission back on the map.
//
// The rule under test is ABSENT MEANS PLAYABLE. Almost every mission stored today
// predates this field; if anything other than a literal `true` counted as benched,
// those missions would vanish from the next run their game launches.
//
// No emulator, no DOM.
//   npx tsx scripts/test-hidden-task.ts
import { readFileSync } from 'node:fs';
import { isTaskHidden, playableTasks, hiddenTaskCount } from '../packages/shared/src/hiddenTask';
import { maxCompletableTasks, requiredTaskCountProblem } from '../packages/shared/src/mutualExclusion';
import { EXPORTED_TASK_KEYS } from '../packages/shared/src/gameFile';

let failures = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
function eq<T>(label: string, got: T, want: T): void {
  const a = JSON.stringify(got); const e = JSON.stringify(want);
  ok(label, a === e, a === e ? '' : `got ${a}, want ${e}`);
}

console.log('\nbenched missions');

// ── absent means playable ───────────────────────────────────────────────────
console.log('\n only a literal true benches a mission');
eq('hidden: true', isTaskHidden({ hidden: true }), true);
for (const [label, value] of [
  ['absent', undefined],
  ['false', false],
  ['null', null],
  ['the string "true"', 'true'],
  ['the number 1', 1],
  ['an empty string', ''],
  ['zero', 0],
  ['an object', {}],
] as const) {
  eq(`${label} ⇒ playable`, isTaskHidden({ hidden: value } as never), false);
}
eq('a null task is playable', isTaskHidden(null), false);
eq('an undefined task is playable', isTaskHidden(undefined), false);

// ── playableTasks ───────────────────────────────────────────────────────────
console.log('\n playableTasks');
{
  const stage = { tasks: [{ id: 'a' }, { id: 'b', hidden: true }, { id: 'c', hidden: false }] };
  eq('drops only the benched one', playableTasks(stage).map((t) => t.id), ['a', 'c']);
  eq('order is preserved', playableTasks({ tasks: [{ id: 'z' }, { id: 'y' }] }).map((t) => t.id), ['z', 'y']);
  ok('returns a NEW array, never the stored one', playableTasks(stage) !== (stage.tasks as unknown));
  eq('a stage with no tasks yields []', playableTasks({} as never), []);
  eq('a null stage yields []', playableTasks(null), []);
  eq('a non-array tasks yields []', playableTasks({ tasks: 'nope' } as never), []);
  eq('every mission benched yields []', playableTasks({ tasks: [{ id: 'a', hidden: true }] }), []);
  eq('the counter agrees', hiddenTaskCount(stage), 1);
  eq('the counter tolerates rubbish', hiddenTaskCount(null), 0);
}

// ── what a stage can YIELD ──────────────────────────────────────────────────
// Every helper in mutualExclusion is built on one enumerator, so filtering there
// is what makes a benched mission invisible to all of them at once.
console.log('\n a benched mission is not part of what a stage can yield');
{
  const three = { tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  eq('three playable missions yield 3', maxCompletableTasks(three), 3);
  eq('benching one yields 2',
    maxCompletableTasks({ tasks: [{ id: 'a' }, { id: 'b', hidden: true }, { id: 'c' }] }), 2);

  // THE REASON THIS MATTERS: "complete 3 of 3" with one benched is a stage no
  // team can finish, and both the server's save validation and the Builder's
  // readiness read this one function.
  eq('3-of-3 is fine while all three play',
    requiredTaskCountProblem({ ...three, requiredTaskCount: 3 }), null);
  ok('3-of-3 becomes a problem once one is benched',
    requiredTaskCountProblem({
      tasks: [{ id: 'a' }, { id: 'b', hidden: true }, { id: 'c' }],
      requiredTaskCount: 3,
    }) !== null);

  // An exclusive group whose alternatives are benched cannot keep yielding one.
  const pair = {
    tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    exclusiveGroups: [{ id: 'g', taskIds: ['a', 'b'] }],
  };
  eq('a live pair yields one completion plus the ungrouped mission', maxCompletableTasks(pair), 2);
  eq('benching one member leaves a single-member (inert) group, still 1 + 1',
    maxCompletableTasks({ ...pair, tasks: [{ id: 'a' }, { id: 'b', hidden: true }, { id: 'c' }] }), 2);
  eq('benching BOTH members leaves only the ungrouped mission',
    maxCompletableTasks({ ...pair, tasks: [{ id: 'a', hidden: true }, { id: 'b', hidden: true }, { id: 'c' }] }), 1);
}

// ── it has to survive a round trip ──────────────────────────────────────────
console.log('\n the field is carried by every path that copies a game');
ok('export/import carries `hidden`', (EXPORTED_TASK_KEYS as readonly string[]).includes('hidden'),
  'a file that dropped it would un-bench every benched mission on import');

// ── the enforcement points are DECLARED, not assumed ────────────────────────
// A field like this fails silently: forget one reader and a benched mission is
// back in a run, or a live one disappears from the gallery. Each site below is
// named with the reason it must filter, and the scan fails if one stops.
console.log('\n every enforcement point still filters');
{
  const sites: [string, string, string][] = [
    ['functions/src/runs/index.ts', 'const tasks = playableTasks(stage);',
      'buildInitialStages — the ONE gameplay choke point: a benched mission never enters a run'],
    ['functions/src/games/index.ts', 'const allTasks = game.stages.flatMap((s) => playableTasks(s));',
      'publishGame — a benched mission is not advertised in the world-readable gallery'],
    ['functions/src/games/index.ts', 'const allTasks = merged.stages.flatMap((s) => playableTasks(s));',
      'resyncPublicGameSummary — the published mission COUNT matches what is published'],
    ['apps/creator-web/src/lib/gameReadiness.ts', 'const tasks: Task[] = playableTasks(stage) as Task[];',
      'readiness — no name, answer key or pin is demanded of a benched mission'],
    ['packages/shared/src/mutualExclusion.ts', 'stage.tasks.filter((t) => !isTaskHidden(t))',
      'stageTaskIds — the one enumerator every exclusion/ceiling helper is built on'],
  ];
  for (const [file, needle, why] of sites) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    ok(`${file} — ${why}`, src.includes(needle), src.includes(needle) ? '' : `missing: ${needle}`);
  }
}

console.log(failures === 0 ? '\n✅ benched missions OK\n' : `\n❌ ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);

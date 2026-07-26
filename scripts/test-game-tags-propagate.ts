// Pure-logic suite for propagateGameTagsToTasks (feature: game-tags-propagate).
//
// A game's tags are UNIONED into EVERY mission (task) so tagging the game once makes
// its missions inherit those tags — the foundation for gallery tag-search. The union
// is applied on the client (keeping the Builder dirty-check honest) AND on the server
// (updateGame / importGameFile), so all layers must agree. Because the helper reuses
// the shared `normalizeTags`, it inherits its dedup/cap/casing contract.
// DOM-free, emulator-free; run by scripts/run-unit-tests.mjs (`npm test`).
//   npx tsx scripts/test-game-tags-propagate.ts
import { propagateGameTagsToTasks, normalizeTags, MAX_TAGS } from '../packages/shared/src/tags';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A minimal structural game shape, deep-cloneable and easy to reason about.
type S = { id: string; order: number; title: string; tasks: { id: string; tags?: string[] }[] };
const makeStages = (): S[] => [
  { id: 's1', order: 0, title: 'Stage 1', tasks: [
    { id: 't1', tags: ['puzzle'] },
    { id: 't2' }, // no tags field at all
  ] },
  { id: 's2', order: 1, title: 'Stage 2', tasks: [
    { id: 't3', tags: ['jerusalem'] }, // already carries one of the game tags
  ] },
];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ── unions game tags into EVERY task ─────────────────────────────────────────
{
  const stages = makeStages();
  const out = propagateGameTagsToTasks(['jerusalem', 'fun'], stages) as unknown as S[];
  let allHave = true;
  for (const st of out) for (const t of st.tasks) {
    if (!(t.tags ?? []).includes('jerusalem') || !(t.tags ?? []).includes('fun')) allHave = false;
  }
  check('every task carries both game tags', allHave, JSON.stringify(out));
  // prior tags survive
  check('prior task tag survives the union', (out[0].tasks[0].tags ?? []).includes('puzzle'));
  check('a task with no tags field gets exactly the game tags',
    eq(out[0].tasks[1].tags, ['jerusalem', 'fun']));
  // a task already holding a game tag does not duplicate it
  check('a task already holding a game tag does not duplicate it',
    eq(out[1].tasks[0].tags, ['jerusalem'].concat(normalizeTags(['jerusalem', 'fun', 'jerusalem']).filter((x) => x !== 'jerusalem'))),
    JSON.stringify(out[1].tasks[0].tags));
  // game tags come FIRST (they win when over the cap)
  check('game tags are listed before the task-own tags',
    eq(out[0].tasks[0].tags, ['jerusalem', 'fun', 'puzzle']),
    JSON.stringify(out[0].tasks[0].tags));
}

// ── idempotent ───────────────────────────────────────────────────────────────
{
  const g = ['jerusalem', 'fun'];
  const once = propagateGameTagsToTasks(g, makeStages());
  const twice = propagateGameTagsToTasks(g, once as never);
  check('propagate(g, propagate(g, s)) deep-equals propagate(g, s)', eq(twice, once));
}

// ── never mutates input ──────────────────────────────────────────────────────
{
  const stages = makeStages();
  const before = clone(stages);
  const out = propagateGameTagsToTasks(['jerusalem', 'fun'], stages);
  check('the passed stages array is unchanged', eq(stages, before));
  check('returns a NEW stages array (identity differs)', (out as unknown) !== (stages as unknown));
  check('each stage is rebuilt (identity differs)', (out as unknown[])[0] !== (stages as unknown[])[0]);
  check('each task is rebuilt (identity differs)',
    (out as unknown as S[])[0].tasks[0] !== stages[0].tasks[0]);
  // the task.tags array itself must be a new array, never the same reference mutated
  check('a task.tags array is not the same reference as the input',
    (out as unknown as S[])[0].tasks[0].tags !== stages[0].tasks[0].tags);
}

// ── MAX_TAGS + dedup/casing ──────────────────────────────────────────────────
{
  // game tags first: when over the cap, the game tags survive and the task-own tail is dropped.
  const gameTags = Array.from({ length: MAX_TAGS }, (_, i) => `g${i}`);
  const stages: S[] = [{ id: 's1', order: 0, title: 'S', tasks: [{ id: 't1', tags: ['extra1', 'extra2'] }] }];
  const out = propagateGameTagsToTasks(gameTags, stages) as unknown as S[];
  const tags = out[0].tasks[0].tags ?? [];
  check('over-cap union clamps to MAX_TAGS', tags.length === MAX_TAGS);
  check('the game tags win the cap (all present)', gameTags.every((g) => tags.includes(g)));
  check('the task-own tail is dropped when over the cap', !tags.includes('extra1') && !tags.includes('extra2'));
}
{
  // a task tag differing only in case from a game tag collapses (first casing = game's).
  const out = propagateGameTagsToTasks(['Park'], [
    { id: 's1', order: 0, title: 'S', tasks: [{ id: 't1', tags: ['park', 'PARK'] }] },
  ] as never) as unknown as S[];
  check('case-only-differing task tag collapses onto the game tag', eq(out[0].tasks[0].tags, ['Park']),
    JSON.stringify(out[0].tasks[0].tags));
}

// ── empty / absent game tags ─────────────────────────────────────────────────
{
  const stages = makeStages();
  const outEmpty = propagateGameTagsToTasks([], stages) as unknown as S[];
  check('empty game tags leave each task tags equal to its normalized own',
    eq(outEmpty[0].tasks[0].tags, normalizeTags(['puzzle'])));
  check('empty game tags: a task with no tags becomes []',
    eq(outEmpty[0].tasks[1].tags, []));
  const outUndef = propagateGameTagsToTasks(undefined, stages) as unknown as S[];
  check('undefined game tags behave like empty', eq(outUndef[1].tasks[0].tags, normalizeTags(['jerusalem'])));
  // still a new array even when values are unchanged
  check('undefined game tags still returns a new array', (outUndef as unknown) !== (stages as unknown));
}

console.log(`\n${failures === 0 ? 'ALL GAME-TAGS-PROPAGATE TESTS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

// Pure-logic tests for the task-media diagnose/repair planner
// (change: task-media-durability).
//
// A picture that `normalizeStagesMedia` silently dropped is NOT gone: the object is
// still under `gameMedia/{ownerUid}/games/{gameId}/…`, only the Firestore reference was
// eaten. These assertions pin the recovery: which objects are orphans, which task each
// belonged to, and that reattaching them never mutates the stored array in place.
//
//   npx tsx scripts/test-task-media-repair.ts
import {
  safeTaskId, referencedMediaUrls, planMediaRepair, applyMediaRepair, mediaKindForName,
} from './lib/taskMediaRepair.mjs';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}
const eq = (label: string, got: unknown, want: unknown) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

const PREFIX = 'gameMedia/owner1/games/g1/';
const ORIGIN = 'https://api.rush-point.com';
const urlFor = (name: string) => `${ORIGIN}/uploads/${name}`;

// ── safeTaskId mirrors the upload path exactly ────────────────────────────────
eq('uuid task id passes through', safeTaskId('a1b2-c3d4'), 'a1b2-c3d4');
eq('unsafe chars become underscores', safeTaskId('task/1.2 x'), 'task_1_2_x');
eq('null-ish id is empty', safeTaskId(undefined), '');

// ── mediaKindForName ──────────────────────────────────────────────────────────
eq('jpg is an image', mediaKindForName('t-1.jpg'), 'image');
eq('MP4 is a video (case-insensitive)', mediaKindForName('t-1.MP4'), 'video');
eq('no extension defaults to image', mediaKindForName('t-1'), 'image');

// ── referencedMediaUrls is total ──────────────────────────────────────────────
check('malformed stages yield an empty set', referencedMediaUrls(undefined).size === 0);
check('a stage with no tasks is fine', referencedMediaUrls([{ id: 's' }]).size === 0);
check('a task with a non-array media is fine',
  referencedMediaUrls([{ tasks: [{ id: 't', media: 'nope' }] }]).size === 0);

// ── The core case: the reference was eaten, the file survived ─────────────────
const TASK_ID = 'task-abc-123';
const SAFE = safeTaskId(TASK_ID);
const ORPHAN = `${PREFIX}${SAFE}-1755300000000.jpg`;
const INTACT = `${PREFIX}${SAFE}-1755399999999.png`;
const damagedStages = [{
  id: 's1',
  tasks: [
    { id: TASK_ID, title: 'כתב סתרים' },                      // media field deleted
    { id: 'other', title: 'x', media: [{ id: 'm', kind: 'image', url: urlFor(INTACT) }] },
  ],
}];
{
  const plan = planMediaRepair([ORPHAN, INTACT], damagedStages);
  eq('exactly one orphan', plan.orphans.length, 1);
  eq('the orphan is the unreferenced object', plan.orphans[0].objectName, ORPHAN);
  eq('the orphan is traced back to its task', plan.orphans[0].taskId, TASK_ID);
  eq('the orphan kind comes from its extension', plan.orphans[0].kind, 'image');
  eq('the still-referenced object is not an orphan', plan.referencedCount, 1);
}
{
  // A Firebase download URL carries the object path percent-encoded — the intact file
  // must still be recognised as referenced, or a repair would DUPLICATE it.
  const fbStages = [{ tasks: [{ id: 'other', media: [{ url: `https://x/o/${encodeURIComponent(INTACT)}?alt=media` }] }] }];
  const plan = planMediaRepair([INTACT], fbStages);
  eq('percent-encoded reference counts as intact', plan.orphans.length, 0);
}
{
  // The mission itself was deleted: report it, never guess a task to attach it to.
  const plan = planMediaRepair([`${PREFIX}gone_task-1.jpg`], damagedStages);
  eq('an orphan with no surviving task reports taskId null', plan.orphans[0].taskId, null);
}
{
  const plan = planMediaRepair([`${PREFIX}`, ''], damagedStages);
  eq('a directory marker and an empty name are ignored', plan.orphans.length, 0);
}
check('planMediaRepair is total on junk',
  planMediaRepair(undefined as never, undefined as never).orphans.length === 0);

// ── applyMediaRepair ──────────────────────────────────────────────────────────
{
  const plan = planMediaRepair([ORPHAN, INTACT], damagedStages);
  const out = applyMediaRepair(damagedStages, plan.orphans, urlFor, (n) => `r-${n.length}`);
  const repaired = out.stages[0].tasks[0];
  eq('the picture is back on its task', repaired.media?.length, 1);
  eq('with the right url', repaired.media?.[0].url, urlFor(ORPHAN));
  eq('one reattachment reported', out.reattached.length, 1);
  eq('nothing skipped', out.skipped.length, 0);
  // Never mutate: this repo rewrites arrays, it does not edit them in place.
  check('the input stages were not mutated', damagedStages[0].tasks[0].media === undefined);
  check('a NEW stages array is returned', out.stages !== damagedStages);
  // The untouched task keeps exactly what it had.
  eq('the intact task is unchanged', out.stages[0].tasks[1].media?.length, 1);
}
{
  const out = applyMediaRepair(damagedStages, [{ objectName: 'x', fileName: 'x', taskId: null, kind: 'image' }], urlFor, () => 'i');
  eq('an orphan with no task is skipped, not attached', out.skipped.length, 1);
  eq('and nothing was reattached', out.reattached.length, 0);
}
{
  // Two orphans on one task come back in upload order (the epochMs suffix).
  const a = `${PREFIX}${SAFE}-1000000000000.jpg`;
  const b = `${PREFIX}${SAFE}-2000000000000.jpg`;
  const plan = planMediaRepair([b, a], damagedStages);
  const out = applyMediaRepair(damagedStages, plan.orphans, urlFor, (n) => n);
  eq('reattached oldest-first', out.stages[0].tasks[0].media?.map((m: { url: string }) => m.url),
    [urlFor(a), urlFor(b)]);
}
{
  // Appends, never replaces: a task that still has one picture keeps it.
  const partial = [{ tasks: [{ id: TASK_ID, media: [{ id: 'k', kind: 'image', url: urlFor(INTACT) }] }] }];
  const out = applyMediaRepair(partial, [{ objectName: ORPHAN, fileName: 'f.jpg', taskId: TASK_ID, kind: 'image' }], urlFor, () => 'n');
  eq('existing media is kept and the orphan appended', out.stages[0].tasks[0].media?.length, 2);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

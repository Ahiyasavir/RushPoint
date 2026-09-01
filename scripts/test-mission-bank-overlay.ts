// Pure-logic tests — the admin mission-bank overlay (change: admin-editable-mission-bank).
//
// The bank stays a static TypeScript array; an admin's edits and deletions live in
// Firestore as per-key overrides and are merged at read time. These assertions pin
// the merge, and they are deliberately paranoid about two things:
//
//   1. It is TOTAL. A stored override is data an admin typed months ago into a
//      collection no test suite guards. Every malformed shape must be IGNORED, not
//      applied as garbage and not thrown on — the composer downstream is total too,
//      and a bank read that throws would take the whole "compose one for me" path
//      down with it.
//   2. It cannot break the bank's own invariants. scripts/test-task-bank.ts enforces
//      entry.difficulty === entry.build().difficulty; an override that patched only
//      one of the two would be a UI that ships a mission the pure suite would reject.
import { applyBankOverrides, normalizeBankOverride } from '../apps/creator-web/src/lib/missionBankOverlay';
import type { MissionBankOverride } from '../apps/creator-web/src/lib/missionBankOverlay';
import type { TaskBankEntry } from '../apps/creator-web/src/taskBank';
import type { Task } from '../packages/shared/src';

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

let seq = 0;
/** A minimal bank entry. `difficulty` is duplicated on purpose, exactly as the real bank does. */
function entry(over: Partial<TaskBankEntry> & { key: string }): TaskBankEntry {
  const difficulty = over.difficulty ?? 5;
  return {
    sourceTemplateKey: 'test',
    tags: ['youth'],
    ...over,
    difficulty,
    build: () => ({
      id: `id-${(seq += 1)}`,
      title: `title-${over.key}`,
      description: `desc-${over.key}`,
      type: 'photo',
      coordinates: { lat: 0, lng: 0 },
      difficulty,
      estimatedMinutes: 10,
      pointValue: 100,
      maxConcurrentTeams: 1,
    } as Task),
  };
}

/** A bank that can compose: it has a bookend at each end. */
function bank(): TaskBankEntry[] {
  return [
    entry({ key: 'opener', tags: ['start', 'youth'] }),
    entry({ key: 'middle-a', tags: ['youth', 'camera'] }),
    entry({ key: 'middle-b', tags: ['youth', 'action'], difficulty: 7 }),
    entry({ key: 'closer', tags: ['finish', 'youth'] }),
  ];
}
const keys = (list: TaskBankEntry[]) => list.map((e) => e.key);
const find = (list: TaskBankEntry[], key: string) => list.find((e) => e.key === key)!;

console.log('\nadmin-editable-mission-bank — applyBankOverrides');

// ── 1. No overrides is the identity ───────────────────────────────────────────
{
  const r = applyBankOverrides(bank(), []);
  eqJson('empty overrides preserve the bank verbatim', keys(r.entries), keys(bank()));
  eqJson('nothing refused', r.refusedDeletions, []);
}

// ── 2. Deleting a mission removes it, order otherwise preserved ───────────────
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', deleted: true }]);
  eqJson('deleted entry is gone, order kept', keys(r.entries), ['opener', 'middle-b', 'closer']);
  eqJson('an applied deletion is not a refusal', r.refusedDeletions, []);
}

// ── 3. THE SAFETY RULE: a deletion that would strand the composer is refused ──
//
// The composer needs one `start` mission and one `finish` mission. A stored row
// that empties either pool must not be applied — the bank read is the last place
// that can stop "compose one for me" becoming a permanent dead end.
{
  const r = applyBankOverrides(bank(), [{ key: 'opener', deleted: true }]);
  ok('the last start mission survives its own deletion row', keys(r.entries).includes('opener'));
  eqJson('and the refusal is reported, not silent', r.refusedDeletions, ['opener']);
}
{
  const r = applyBankOverrides(bank(), [{ key: 'closer', deleted: true }]);
  ok('the last finish mission survives too', keys(r.entries).includes('closer'));
  eqJson('reported', r.refusedDeletions, ['closer']);
}
{
  // Two openers: deleting ONE is fine, because a start mission remains.
  const b = [...bank(), entry({ key: 'opener-2', tags: ['start', 'youth'] })];
  const r = applyBankOverrides(b, [{ key: 'opener', deleted: true }]);
  eqJson('one of two openers may be deleted', keys(r.entries), ['middle-a', 'middle-b', 'closer', 'opener-2']);
  eqJson('no refusal', r.refusedDeletions, []);
}
{
  // Both openers deleted: the pool would empty, so BOTH rows are refused rather
  // than arbitrarily honouring whichever came first.
  const b = [...bank(), entry({ key: 'opener-2', tags: ['start', 'youth'] })];
  const r = applyBankOverrides(b, [{ key: 'opener', deleted: true }, { key: 'opener-2', deleted: true }]);
  eqJson('emptying the pool refuses every deletion in it', r.refusedDeletions, ['opener', 'opener-2']);
  ok('both openers survive', keys(r.entries).includes('opener') && keys(r.entries).includes('opener-2'));
}

// ── 4. Title and description patch the BUILT mission ──────────────────────────
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', title: 'כותרת חדשה', description: 'תיאור חדש' }]);
  const built = find(r.entries, 'middle-a').build();
  eq('title is overridden', built.title, 'כותרת חדשה');
  eq('description is overridden', built.description, 'תיאור חדש');
  eq('an untouched sibling is unchanged', find(r.entries, 'middle-b').build().title, 'title-middle-b');
}
{
  // build() must stay a fresh-object factory: the recency memory and the composer
  // both assume every use mints its own Task with its own id.
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', title: 'x' }]);
  const e = find(r.entries, 'middle-a');
  const a = e.build(); const b = e.build();
  ok('build() still mints a fresh object', a !== b);
  ok('build() still mints a fresh id', a.id !== b.id);
}

// ── 5. Difficulty patches BOTH copies, or neither ─────────────────────────────
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', difficulty: 9 }]);
  const e = find(r.entries, 'middle-a');
  eq('entry difficulty', e.difficulty, 9);
  eq('built difficulty agrees — the invariant test-task-bank.ts enforces', e.build().difficulty, 9);
}
for (const bad of [0, 11, -3, 4.5, NaN, Infinity, '7' as unknown as number]) {
  const r = applyBankOverrides(bank(), [{ key: 'middle-b', difficulty: bad as number }]);
  const e = find(r.entries, 'middle-b');
  eq(`difficulty ${JSON.stringify(bad)} is ignored, source kept`, e.difficulty, 7);
  eq('  …and the built copy still agrees', e.build().difficulty, 7);
}

// ── 6. Tags — closed vocabulary, invalid members dropped, never emptied ───────
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', tags: ['camera', 'thinking'] }]);
  eqJson('valid tags replace the source set', find(r.entries, 'middle-a').tags, ['camera', 'thinking']);
}
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', tags: ['camera', 'not-a-real-tag', 'camera'] }]);
  eqJson('unknown tags dropped, duplicates collapsed', find(r.entries, 'middle-a').tags, ['camera']);
}
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', tags: [] }]);
  eqJson('an empty tag list is ignored — an untagged mission is unreachable',
    find(r.entries, 'middle-a').tags, ['youth', 'camera']);
}
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', tags: ['nope', 'also-nope'] }]);
  eqJson('all-invalid is the same as empty', find(r.entries, 'middle-a').tags, ['youth', 'camera']);
}

// ── 7. minAge / transitMinutes — number sets, null clears, garbage ignored ────
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', minAge: 12, transitMinutes: 6 }]);
  const e = find(r.entries, 'middle-a');
  eq('minAge set', e.minAge, 12);
  eq('transitMinutes set', e.transitMinutes, 6);
}
{
  const b = bank();
  b[1] = { ...b[1], minAge: 14, transitMinutes: 8 };
  const r = applyBankOverrides(b, [{ key: 'middle-a', minAge: null, transitMinutes: null }]);
  const e = find(r.entries, 'middle-a');
  eq('null clears minAge', e.minAge, undefined);
  eq('null clears transitMinutes', e.transitMinutes, undefined);
}
{
  const b = bank();
  b[1] = { ...b[1], minAge: 14 };
  const r = applyBankOverrides(b, [{ key: 'middle-a', minAge: -1 }]);
  eq('a negative minAge is ignored, source kept', find(r.entries, 'middle-a').minAge, 14);
}

// ── 8. Totality — nothing here may throw, and nothing may be invented ─────────
{
  const r = applyBankOverrides(bank(), [{ key: 'no-such-mission', title: 'ghost' }]);
  eqJson('an override naming an unknown key invents nothing', keys(r.entries), keys(bank()));
}
const junk: unknown[] = [
  null, undefined, 0, '', [], {}, { key: '' }, { key: 42 },
  { key: 'middle-a', title: '   ' }, { key: 'middle-a', title: 123 },
  { key: 'middle-a', tags: 'camera' }, { key: 'middle-a', deleted: 'yes' },
];
{
  let threw: unknown = null;
  let r: ReturnType<typeof applyBankOverrides> | null = null;
  try { r = applyBankOverrides(bank(), junk as MissionBankOverride[]); } catch (e) { threw = e; }
  ok('a pile of malformed rows never throws', threw === null, String(threw));
  eqJson('and changes nothing', keys(r!.entries), keys(bank()));
  eq('a blank title is not applied', find(r!.entries, 'middle-a').build().title, 'title-middle-a');
}
{
  let threw: unknown = null;
  try {
    applyBankOverrides(null as unknown as TaskBankEntry[], null as unknown as MissionBankOverride[]);
  } catch (e) { threw = e; }
  ok('a null bank never throws', threw === null, String(threw));
}

// ── 9. normalizeBankOverride — the shape that reaches Firestore ───────────────
{
  const n = normalizeBankOverride({ key: 'a', title: '  hi  ', difficulty: 3, tags: ['camera', 'bogus'], junk: 1 });
  eqJson('trims, filters and drops unknown fields', n, { key: 'a', title: 'hi', tags: ['camera'], difficulty: 3 });
}
{
  eq('a row with no usable key is rejected', normalizeBankOverride({ title: 'x' }), null);
  eq('a row with no usable field is rejected', normalizeBankOverride({ key: 'a', title: '  ' }), null);
  eq('junk is rejected, not thrown on', normalizeBankOverride(null), null);
}
{
  const n = normalizeBankOverride({ key: 'a', deleted: true });
  eqJson('a pure deletion is a usable row', n, { key: 'a', deleted: true });
}
{
  const n = normalizeBankOverride({ key: 'a', minAge: null, transitMinutes: null });
  eqJson('explicit nulls survive normalization — they mean "clear this"',
    n, { key: 'a', minAge: null, transitMinutes: null });
}

console.log(failures === 0
  ? '\n✅ mission-bank overlay: all assertions passed\n'
  : `\n❌ mission-bank overlay: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);

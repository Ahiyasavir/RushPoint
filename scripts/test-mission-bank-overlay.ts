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
import { applyBankOverrides, normalizeBankOverride, hasContentEdit } from '../apps/creator-web/src/lib/missionBankOverlay';
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

// ── 3b. The QUIET way to empty a bookend pool: untagging, not deleting ───────
//
// A tag override replaces the whole set, so re-tagging the last `start` mission
// for its content strands the composer exactly as completely as deleting it —
// and nothing is marked deleted anywhere. This is not hypothetical: the first
// operator pass moved open-team-motto from `start` to `finish`.
{
  const r = applyBankOverrides(bank(), [{ key: 'opener', tags: ['youth', 'finish'] }]);
  ok('the last opener keeps its `start` tag', find(r.entries, 'opener').tags.includes('start'));
  eqJson('and the rescue is reported', r.restoredBookends, ['opener']);
  ok('the rest of the tag edit still lands',
    find(r.entries, 'opener').tags.includes('finish'));
}
{
  // With a spare opener the re-tag is honoured in full: the guard is a floor,
  // not a veto on ever moving a mission between ends of the game.
  const b = [...bank(), entry({ key: 'opener-2', tags: ['start', 'youth'] })];
  const r = applyBankOverrides(b, [{ key: 'opener', tags: ['youth', 'finish'] }]);
  ok('one of two openers may be re-tagged', !find(r.entries, 'opener').tags.includes('start'));
  eqJson('nothing rescued', r.restoredBookends, []);
}
{
  // Deleting one opener while untagging the other empties the pool by two
  // different routes at once — the guard has to see them together.
  const b = [...bank(), entry({ key: 'opener-2', tags: ['start', 'youth'] })];
  const r = applyBankOverrides(b, [
    { key: 'opener', deleted: true },
    { key: 'opener-2', tags: ['youth', 'action'] },
  ]);
  const openers = r.entries.filter((e) => e.tags.includes('start')).map((e) => e.key);
  ok('an opener survives a mixed deletion + untag', openers.length > 0, JSON.stringify(openers));
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

// ── 5b. The band tag follows the number, whichever of the two was edited ─────
//
// The admin form offers `difficulty` and the tag list as independent controls,
// and the first real editing pass drifted them apart twice in one day. Neither
// drift is visible: the composed game paces off the number while the creator
// filters on the tag, so the mission just lies to one of them.
{
  const b = bank();
  b[1] = { ...b[1], tags: ['youth', 'camera', 'easy'], difficulty: 2 };
  const r = applyBankOverrides(b, [{ key: 'middle-a', difficulty: 9 }]);
  const e = find(r.entries, 'middle-a');
  eqJson('raising the difficulty re-bands the tags', e.tags, ['youth', 'camera', 'hard']);
}
{
  // The reverse: an admin who hand-picks a band tag that contradicts the number
  // does not get to ship it either.
  const b = bank();
  b[1] = { ...b[1], tags: ['youth', 'easy'], difficulty: 2 };
  const r = applyBankOverrides(b, [{ key: 'middle-a', tags: ['youth', 'hard'] }]);
  eqJson('a hand-picked band that contradicts the number is corrected',
    find(r.entries, 'middle-a').tags, ['youth', 'easy']);
}
{
  // An entry with NO override is left untouched — the authored bank is already a
  // fixed point of the repair, so re-banding it would allocate for nothing.
  const b = bank();
  b[2] = { ...b[2], tags: ['youth', 'action', 'medium'] };
  const r = applyBankOverrides(b, [{ key: 'middle-a', title: 'x' }]);
  ok('an untouched entry keeps its exact tag array', find(r.entries, 'middle-b').tags === b[2].tags);
}

// ── 5c. `camera` is pinned to the authored entry, in both directions ─────────
//
// It means "handed in as a photo or a video" — the task type, which no override
// can change. A tag override REPLACES the set, so without this the source fix
// that added `camera` to eleven missions would stay invisible for exactly the
// missions an admin had already re-tagged.
{
  const b = bank();
  b[1] = { ...b[1], tags: ['youth', 'camera'] };
  const r = applyBankOverrides(b, [{ key: 'middle-a', tags: ['youth', 'action'] }]);
  ok('an override cannot drop `camera` from a photo mission',
    find(r.entries, 'middle-a').tags.includes('camera'));
}
{
  const b = bank();
  b[1] = { ...b[1], tags: ['youth'] };          // authored without `camera`
  const r = applyBankOverrides(b, [{ key: 'middle-a', tags: ['youth', 'camera'] }]);
  ok('an override cannot add `camera` to a mission that was not authored with it',
    !find(r.entries, 'middle-a').tags.includes('camera'));
}

// ── 6. Tags — closed vocabulary, invalid members dropped, never emptied ───────
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', tags: ['camera', 'thinking'] }]);
  // …plus the band tag the entry's own difficulty implies (see 5b): an edited
  // entry always leaves the merge carrying exactly one, correct, band.
  eqJson('valid tags replace the source set', find(r.entries, 'middle-a').tags, ['camera', 'thinking', 'medium']);
}
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', tags: ['camera', 'not-a-real-tag', 'camera'] }]);
  eqJson('unknown tags dropped, duplicates collapsed', find(r.entries, 'middle-a').tags, ['camera', 'medium']);
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

// ── 10. Curation flags are BOOKKEEPING, never content ────────────────────────
//
// `reviewedCopy` and `verifiedSetup` record that a person has looked at a
// mission. They must persist (a pass over 103 missions has to be resumable) and
// they must not change one thing a player is offered.
{
  const r = applyBankOverrides(bank(), [{ key: 'middle-a', reviewedCopy: true, verifiedSetup: true }]);
  const e = find(r.entries, 'middle-a');
  eqJson('a flag-only row leaves the bank identical', keys(r.entries), keys(bank()));
  eq('…the title is untouched', e.build().title, 'title-middle-a');
  eqJson('…the tags are untouched', e.tags, ['youth', 'camera']);
  eq('…the difficulty is untouched', e.difficulty, 5);
}
{
  // But it IS a storable row: refusing it would mean the tick could not be saved
  // at all for a mission nobody has edited, which is most of them.
  eqJson('a flag-only row survives normalization',
    normalizeBankOverride({ key: 'a', reviewedCopy: true }), { key: 'a', reviewedCopy: true });
  eqJson('both flags at once', normalizeBankOverride({ key: 'a', reviewedCopy: true, verifiedSetup: true }),
    { key: 'a', reviewedCopy: true, verifiedSetup: true });
  // Only `true` is stored — an untick is the ABSENCE of the field, so `false`
  // must not keep a row alive that says nothing.
  eq('an explicit false is not a reason to keep the row',
    normalizeBankOverride({ key: 'a', reviewedCopy: false }), null);
  eq('a non-boolean flag is ignored', normalizeBankOverride({ key: 'a', verifiedSetup: 'yes' }), null);
}

// ── 11. hasContentEdit — "edited" means the PLAYER sees something different ───
{
  ok('a flag-only row is not an edit', !hasContentEdit({ key: 'a', reviewedCopy: true, verifiedSetup: true }));
  ok('a title change is an edit', hasContentEdit({ key: 'a', title: 'x' }));
  ok('a deletion is an edit', hasContentEdit({ key: 'a', deleted: true }));
  ok('a cleared optional number is an edit', hasContentEdit({ key: 'a', minAge: null }));
  ok('a tag change is an edit', hasContentEdit({ key: 'a', tags: ['camera'] }));
  ok('no row at all is not an edit', !hasContentEdit(undefined) && !hasContentEdit(null));
}

console.log(failures === 0
  ? '\n✅ mission-bank overlay: all assertions passed\n'
  : `\n❌ mission-bank overlay: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);

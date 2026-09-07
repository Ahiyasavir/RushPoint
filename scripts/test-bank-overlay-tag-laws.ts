// Pure-logic tests — the mechanical tag laws survive the ADMIN OVERLAY
// (change: admin-editable-mission-bank, fold-back pass 2026-09-02).
//
// ─── The gap this closes ─────────────────────────────────────────────────────
//
// Two files already exist and neither covers this:
//
//   scripts/test-task-bank-tag-laws.ts  asserts the laws over `TASK_BANK` — the
//     SOURCE file, which no admin can edit. It never calls `applyBankOverrides`.
//   scripts/test-mission-bank-overlay.ts  asserts the merge's repairs, but on
//     hand-built three-entry fixtures, not on the bank players are actually served.
//
// So "the guard exists" was unit-tested and "the laws hold over the real bank for
// any override a person can store" was not. The gap is not theoretical: an
// override row REPLACES the tag set wholesale, and a real curation pass did drop
// `camera` from a real photo mission (`the-hidden-key`). The merge repaired it —
// which is the point: nothing was asserting that it would.
//
// ─── Why adversarial rows and not recorded ones ──────────────────────────────
//
// Testing against the rows that happen to be in Firestore today would pass the
// moment somebody tidies the collection, and it would drift as soon as the next
// curation pass ran. These generators break the laws deliberately, over EVERY
// entry at once, which is the strongest statement the merge can be held to: the
// laws are a fixed point of the overlay, not a property of current data.
//
// Each generator is paired with an ANTI-VACUITY check that applies the same rows
// naively (tags replaced, nothing repaired) and asserts the law really does break
// that way. Without it a generator that silently produced no-ops would pass this
// file while testing nothing — the failure mode the tag-laws file calls out in
// its own header.
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import { applyBankOverrides } from '../apps/creator-web/src/lib/missionBankOverlay';
import { difficultyBandFor, isDifficultyTagId, type BankTagId } from '../apps/creator-web/src/bankTags';
import type { TaskBankEntry } from '../apps/creator-web/src/taskBank';

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

console.log('\nmission bank — the mechanical tag laws survive the overlay');

// ─── The two laws, stated once and applied to whatever bank they are handed ──
//
// Copied in SHAPE from scripts/test-task-bank-tag-laws.ts sections 1 and 2, but
// taking the bank as an argument so the same predicate runs over the source and
// over the merged result. Deliberately not imported from there: that file is a
// top-level program that exits, so importing it would run it.
const bandsOf = (tags: readonly BankTagId[]) => tags.filter(isDifficultyTagId);

function cameraViolations(bank: readonly TaskBankEntry[]): string[] {
  const out: string[] = [];
  for (const e of bank) {
    const isPhoto = e.build().type === 'photo';
    const tagged = e.tags.includes('camera');
    if (isPhoto && !tagged) out.push(`${e.key}: photo without camera`);
    if (!isPhoto && tagged) out.push(`${e.key}: ${e.build().type} with camera`);
  }
  return out;
}

function bandViolations(bank: readonly TaskBankEntry[]): string[] {
  const out: string[] = [];
  for (const e of bank) {
    const bands = bandsOf(e.tags);
    if (bands.length !== 1) { out.push(`${e.key}: ${bands.length} band tags`); continue; }
    if (bands[0] !== difficultyBandFor(e.difficulty)) {
      out.push(`${e.key}: difficulty ${e.difficulty} tagged ${bands[0]}`);
    }
  }
  return out;
}

/** What an override row does if nobody repairs it: the tag set is REPLACED. */
function naive(bank: readonly TaskBankEntry[], rows: Array<Record<string, unknown>>): TaskBankEntry[] {
  const byKey = new Map(rows.map((r) => [r.key as string, r]));
  return bank.map((e) => {
    const r = byKey.get(e.key);
    if (!r) return e;
    return {
      ...e,
      tags: Array.isArray(r.tags) ? (r.tags as BankTagId[]) : e.tags,
      difficulty: typeof r.difficulty === 'number' ? r.difficulty : e.difficulty,
    };
  });
}

// ── 0. The source bank is itself lawful, so a violation below is the overlay ──
console.log('\n── 0. the source bank is the baseline ─────────────────────');
{
  eq('source: camera law holds', cameraViolations(TASK_BANK), []);
  eq('source: band law holds', bandViolations(TASK_BANK), []);
  const photos = TASK_BANK.filter((e) => e.build().type === 'photo').length;
  ok(`the bank really contains photo missions :: ${photos} of ${TASK_BANK.length}`, photos > 20);
  ok(`the bank is large enough to be worth this :: ${TASK_BANK.length}`, TASK_BANK.length > 50);
}

// ── 1. An override that strips `camera` from EVERY mission ───────────────────
console.log('\n── 1. every camera tag dropped ────────────────────────────');
{
  const rows = TASK_BANK.map((e) => ({ key: e.key, tags: e.tags.filter((t) => t !== 'camera') }));
  ok('anti-vacuity: unrepaired, this really breaks the law',
    cameraViolations(naive(TASK_BANK, rows)).length > 20,
    `${cameraViolations(naive(TASK_BANK, rows)).length} violations`);
  eq('overlay: camera law still holds', cameraViolations(applyBankOverrides(TASK_BANK, rows).entries), []);
  eq('overlay: band law still holds', bandViolations(applyBankOverrides(TASK_BANK, rows).entries), []);
}

// ── 2. An override that adds `camera` to EVERY mission ───────────────────────
console.log('\n── 2. camera added everywhere ─────────────────────────────');
{
  const rows = TASK_BANK.map((e) => ({
    key: e.key, tags: e.tags.includes('camera') ? [...e.tags] : [...e.tags, 'camera'],
  }));
  ok('anti-vacuity: unrepaired, this really breaks the law',
    cameraViolations(naive(TASK_BANK, rows)).length > 5,
    `${cameraViolations(naive(TASK_BANK, rows)).length} violations`);
  eq('overlay: camera law still holds', cameraViolations(applyBankOverrides(TASK_BANK, rows).entries), []);
}

// ── 3. Difficulty moved with the band tag left stale ─────────────────────────
//
// The exact drift a real pass produced twice in one day: the admin form offers
// the number and the band as independent controls.
console.log('\n── 3. difficulty moved, band left stale ───────────────────');
for (const n of [1, 5, 10]) {
  const rows = TASK_BANK.map((e) => ({ key: e.key, difficulty: n, tags: [...e.tags] }));
  const broken = bandViolations(naive(TASK_BANK, rows)).length;
  ok(`anti-vacuity at difficulty ${n}: unrepaired, this really drifts`, broken > 20, `${broken} violations`);
  const merged = applyBankOverrides(TASK_BANK, rows).entries;
  eq(`overlay at difficulty ${n}: band law holds`, bandViolations(merged), []);
  eq(`overlay at difficulty ${n}: camera law holds`, cameraViolations(merged), []);
  ok(`overlay at difficulty ${n}: the number was actually applied`,
    merged.every((e) => e.difficulty === n));
}

// ── 4. Two band tags at once, and none at all ────────────────────────────────
console.log('\n── 4. malformed band sets ─────────────────────────────────');
{
  const both = TASK_BANK.map((e) => ({
    key: e.key, difficulty: e.difficulty,
    tags: [...e.tags.filter((t) => !isDifficultyTagId(t)), 'easy', 'hard'],
  }));
  eq('overlay: two band tags collapse to the right one', bandViolations(applyBankOverrides(TASK_BANK, both).entries), []);

  const none = TASK_BANK.map((e) => ({
    key: e.key, difficulty: e.difficulty, tags: e.tags.filter((t) => !isDifficultyTagId(t)),
  }));
  eq('overlay: a missing band tag is supplied', bandViolations(applyBankOverrides(TASK_BANK, none).entries), []);
}

// ── 5. Junk rows are ignored without breaking either law ─────────────────────
//
// The overlay's first stated rule is totality: every value here was typed by a
// person into a collection no test suite guards.
console.log('\n── 5. junk rows stay total ────────────────────────────────');
{
  const junk: Array<Record<string, unknown>> = [];
  for (const e of TASK_BANK) {
    junk.push({ key: e.key, tags: null, difficulty: 'eight' });
    junk.push({ key: e.key, tags: ['not-a-real-tag', 'camera', 42], difficulty: NaN });
  }
  junk.push({ key: 'no-such-mission', tags: ['camera'] }, {}, { key: 42 }, null as never);
  let threw = '';
  let merged: TaskBankEntry[] = [];
  try { merged = applyBankOverrides(TASK_BANK, junk).entries; } catch (err) { threw = String(err); }
  ok('junk never throws', threw === '', threw);
  eq('junk: camera law holds', cameraViolations(merged), []);
  eq('junk: band law holds', bandViolations(merged), []);
  eq('junk: no mission invented or lost', merged.length, TASK_BANK.length);
}

// ── 6. A curation tick alone changes nothing at all ──────────────────────────
//
// 17 rows in production are exactly this shape after the 2026-09-02 fold, so it
// is the single most common row in the collection.
console.log('\n── 6. reviewedCopy-only rows are a true no-op ─────────────');
{
  const ticks = TASK_BANK.map((e) => ({ key: e.key, reviewedCopy: true }));
  const merged = applyBankOverrides(TASK_BANK, ticks).entries;
  const changed = merged.filter((a, i) => {
    const b = TASK_BANK[i];
    return a.key !== b.key || a.difficulty !== b.difficulty
      || [...a.tags].sort().join(',') !== [...b.tags].sort().join(',');
  }).map((e) => e.key);
  eq('ticking every mission as read changes nothing', changed, []);
}

console.log(failures === 0
  ? '\n✅ overlay tag laws: all assertions passed\n'
  : `\n❌ overlay tag laws: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);

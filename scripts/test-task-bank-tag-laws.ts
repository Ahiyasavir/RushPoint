// Pure-logic tests — the mission bank's MECHANICAL tag laws
// (change: admin-editable-mission-bank, curation pass 2026-09-01).
//
// ─── Why these are a test and not a rule in the header ───────────────────────
//
// taskBank.ts already carries forty authoring rules, and rules 41-42 of that
// header say what this file asserts. The difference is that these two are the
// only tag rules a machine can settle with no judgement at all, and both were
// being broken silently:
//
//   • `camera` ⇔ the mission submits a photo or a video. The first operator
//     editing pass added `camera` to four missions by hand (elevator-pitch,
//     local-legend, office-olympics, trade-up) and there were ELEVEN missing it.
//     Fixing four of eleven by eye is exactly the work a test should be doing.
//
//   • The band tag (`easy`/`medium`/`hard`) and the 1-10 `difficulty` are one
//     fact written twice. The authored bank had never disagreed — and then the
//     admin editor, which offers the two as independent controls, produced the
//     drift within a day (a mission at difficulty 8 still tagged `medium`).
//
// The mapping itself is NOT restated here: it is imported from bankTags.ts, so
// this test, the overlay merge and the admin form cannot drift from each other.
import { TASK_BANK } from '../apps/creator-web/src/taskBank';
import {
  DIFFICULTY_TAG_IDS, difficultyBandFor, withDifficultyBand, isDifficultyTagId,
  type BankTagId,
} from '../apps/creator-web/src/bankTags';

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

console.log('\nmission bank — mechanical tag laws');

// ── 1. `camera` ⇔ the mission is submitted as a photo or a video ─────────────
//
// Both directions. The forward one is what was broken; the reverse keeps the tag
// meaning "this is how you hand it in" rather than drifting into a mood word,
// which is what would make the forward rule unenforceable later.
console.log('\n── 1. camera ⇔ photo submission ───────────────────────────');
{
  const missingCamera = TASK_BANK
    .filter((e) => e.build().type === 'photo' && !e.tags.includes('camera'))
    .map((e) => e.key);
  eq('every photo/video mission carries `camera`', missingCamera, []);

  const strayCamera = TASK_BANK
    .filter((e) => e.build().type !== 'photo' && e.tags.includes('camera'))
    .map((e) => `${e.key}(${e.build().type})`);
  eq('no non-photo mission carries `camera`', strayCamera, []);

  // Anti-vacuity: if build() ever stopped producing photo missions this whole
  // section would pass while checking nothing.
  const photoCount = TASK_BANK.filter((e) => e.build().type === 'photo').length;
  ok(`the scan actually saw photo missions :: ${photoCount} of ${TASK_BANK.length}`, photoCount > 20);
}

// ── 2. Exactly one band tag, and it is the one the number implies ────────────
console.log('\n── 2. difficulty band ⇔ difficulty number ─────────────────');
{
  const bandsOf = (tags: readonly BankTagId[]) => tags.filter(isDifficultyTagId);

  const wrongCount = TASK_BANK
    .filter((e) => bandsOf(e.tags).length !== 1)
    .map((e) => `${e.key}[${bandsOf(e.tags).join(',') || 'none'}]`);
  eq('every entry carries exactly one band tag', wrongCount, []);

  const mismatched = TASK_BANK
    .filter((e) => bandsOf(e.tags).length === 1 && bandsOf(e.tags)[0] !== difficultyBandFor(e.difficulty))
    .map((e) => `${e.key}: difficulty ${e.difficulty} but tagged ${bandsOf(e.tags)[0]}`);
  eq('every band tag matches its own difficulty', mismatched, []);

  ok(`the scan actually saw band tags :: ${TASK_BANK.length} entries`, TASK_BANK.length > 20);
}

// ── 3. The mapping itself — boundaries, and totality ─────────────────────────
//
// The boundaries are the whole content of the rule, so they are pinned rather
// than left to be re-derived from the bank (which would make the test agree with
// whatever the bank happened to contain).
console.log('\n── 3. difficultyBandFor ───────────────────────────────────');
{
  const expected: Array<[number, string]> = [
    [1, 'easy'], [2, 'easy'], [3, 'easy'],
    [4, 'medium'], [5, 'medium'], [6, 'medium'],
    [7, 'hard'], [8, 'hard'], [9, 'hard'], [10, 'hard'],
  ];
  for (const [n, want] of expected) eq(`difficulty ${n}`, difficultyBandFor(n), want);

  // Total — a form and a merge both call this and neither may throw.
  for (const junk of [undefined, null, NaN, Infinity, '5', {}, []]) {
    ok(`junk ${JSON.stringify(junk)} yields a real band`,
      (DIFFICULTY_TAG_IDS as readonly string[]).includes(difficultyBandFor(junk)));
  }
}

// ── 4. withDifficultyBand — the repair the admin form applies on every save ──
console.log('\n── 4. withDifficultyBand ──────────────────────────────────');
{
  eq('replaces a stale band IN PLACE, order preserved',
    withDifficultyBand(['camera', 'medium', 'teamwork'] as BankTagId[], 8),
    ['camera', 'hard', 'teamwork']);
  eq('adds the band when none is present',
    withDifficultyBand(['camera', 'teamwork'] as BankTagId[], 2),
    ['camera', 'teamwork', 'easy']);
  eq('collapses two band tags to one',
    withDifficultyBand(['easy', 'camera', 'hard'] as BankTagId[], 5),
    ['medium', 'camera']);
  eq('a band that is already right is left alone',
    withDifficultyBand(['hard', 'thinking'] as BankTagId[], 9),
    ['hard', 'thinking']);
  eq('an empty tag list still gains a band',
    withDifficultyBand([], 4), ['medium']);
  // Idempotent: the form runs it on every keystroke, so a second pass must be a
  // no-op or the tag list would churn while the admin types.
  const once = withDifficultyBand(['camera', 'medium'] as BankTagId[], 7);
  eq('idempotent', withDifficultyBand(once, 7), once);
}

// ── 5. Every entry the bank ships already satisfies the repair ───────────────
//
// i.e. running the repair over the authored bank changes nothing. This is the
// assertion that will fail the day someone adds a mission by hand and gets the
// pair wrong, which is the whole point.
console.log('\n── 5. the authored bank is already a fixed point ──────────');
{
  const churned = TASK_BANK
    .filter((e) => JSON.stringify(withDifficultyBand(e.tags, e.difficulty)) !== JSON.stringify(e.tags))
    .map((e) => `${e.key}: ${e.tags.filter(isDifficultyTagId).join(',') || 'none'} vs difficulty ${e.difficulty}`);
  eq('re-banding the whole bank is a no-op', churned, []);
}

// ── 6. No mission promises a reward the platform cannot pay (rule 60) ────────
//
// Two missions told players that something would earn BONUS POINTS — "an
// original performance earns bonus points", "bonus if real strangers take part"
// — while being auto-approved photo uploads, which award the same flat score to
// every submission alike. There is no bonus and there has never been one: the
// platform scores a photo mission by its `pointValue`, and the only differential
// scoring that exists anywhere is a staff member manually calling
// adjustTeamScore. A player who works harder for the promised bonus gets exactly
// what a player who ignored it gets.
//
// This one IS mechanically checkable, unlike most of the authoring rules,
// because it compares two encodings of a single fact: prose promising
// differential scoring against a configuration that cannot deliver it. Same
// class as rules 41-42, and the reason section 6 of this suite can assert while
// section 7 can only report.
console.log('\n── 6. no unpayable reward is promised (rule 60) ───────────');
{
  // Deliberately broad. A near-miss phrasing that this misses is a bug in the
  // pattern; a false positive is a mission that should be reworded anyway.
  const BONUS_PROMISE = /בונוס|ניקוד נוסף|נקודות נוספות|תקבלו יותר|יותר נקודות|ניקוד גבוה|נקודות בונוס/;
  const promising = TASK_BANK
    .filter((e) => BONUS_PROMISE.test(e.build().description ?? ''))
    .map((e) => `${e.key}: ${(e.build().description ?? '').match(/[^.]*(בונוס|ניקוד|נקודות)[^.]*/)?.[0]?.trim()}`);
  eq('no mission promises bonus points the scoring cannot award', promising, []);

  // Anti-vacuity in both directions: prove the pattern still matches something,
  // or a silent edit to it would turn this assertion into a no-op forever.
  ok('the bonus pattern still matches text that contains a promise',
    BONUS_PROMISE.test('ביצוע מקורי מקבל ניקוד בונוס'));
  ok('…and does not match ordinary mission prose',
    !BONUS_PROMISE.test('צלמו את הקבוצה ליד השלט'));
}

// ── 7. Composition mix — REPORTED, never asserted (rule 54) ──────────────────
//
// Distinctiveness is relational: the peak of a composed game is whatever differs
// from its neighbours, so a pool where three missions in five are the same kind
// has a self-similar middle and no peak in it. The right ratio is a judgement
// call and this suite does not pretend otherwise — but drifting further without
// anyone noticing should not be possible, and a count with its denominator
// printed is the cheapest way to make it visible.
console.log('\n── 7. composition mix (informational, rule 54) ────────────');
{
  const byType = new Map<string, number>();
  for (const e of TASK_BANK) {
    const t = e.build().type;
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  const ranked = [...byType.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, n] of ranked) {
    console.log(`  ${type.padEnd(14)} ${String(n).padStart(3)}  ${(100 * n / TASK_BANK.length).toFixed(0)}%`);
  }
  const [topType, topN] = ranked[0];
  console.log(`  → most common kind: ${topType} at ${topN} of ${TASK_BANK.length}`);
}

console.log(failures === 0
  ? '\n✅ mission bank tag laws: all assertions passed\n'
  : `\n❌ mission bank tag laws: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);

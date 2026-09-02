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
//
// ─── BEFORE YOU ADD A SECTION: gate, or report? ──────────────────────────────
//
// This file has both, and after a fortnight of adding them the rule for deciding
// turned out to be exact. NAME THE TWO THINGS THE CHECK COMPARES.
//
//   BOTH SIDES ALREADY ENCODED IN THE ARTEFACT → it is a CONSISTENCY check, it
//   cannot be wrong about what it measures, and it should ASSERT. Every gate here
//   is one: a tag against a task type (1), a band tag against a number (2), prose
//   promising a bonus against a config that pays none (6), a `crowded` photo
//   mission against whether its text asks (7), an authored answer against whether
//   the entry offers any route to it (8). Between them they caught eleven missing
//   `camera` tags, two band drifts, two unpayable promises, four missing
//   permission clauses and one unsolvable step. FALSE POSITIVES: NONE, EVER.
//
//   ONE SIDE IS A JUDGEMENT → the prose is a PROXY for it, and the check has a
//   construct-validity problem however careful the regex. It should REPORT. Three
//   were attempted as gates first and all three over-fired: rule 52's three-needs
//   screen flagged roughly thirty of 103 including two of the best missions in the
//   bank, a rule 51 exposure scan flagged seventeen of which about one was real,
//   and rule 78's cover scan flagged eleven of which one was. The pattern is
//   consistent enough to be a law of this repository: A PROSE SCAN OVER THIS BANK
//   PRODUCES CANDIDATES, NEVER VERDICTS.
//
// AND NEVER TUNE A REPORT UNTIL IT IS EMPTY. Goodhart: when a measure becomes a
// target it stops being a measure, and "if you cannot define the construct you are
// measuring theatre". Section 10's patterns were extended once, legitimately —
// they had missed a real cover form in a fix made ten minutes earlier — and its
// empty-case line says "none that THIS SCAN CAN SEE" precisely so the zero is
// never read as an all-clear. Fix the mission first; widen the pattern only when
// the pattern genuinely missed something real, and say so in the output.
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

// ── 7. A mission that photographs a member of the public asks first (rule 71) ─
//
// The one rule in this file with a consequence outside the game. Our players are
// frequently minors and so, sometimes, are the strangers; "you are legally
// allowed to photograph people in public" is the floor, not the standard. The
// bank was inconsistent with itself here for as long as it has existed — some
// missions asked permission, some filmed a stranger performing without a word,
// and nothing recorded which was intended.
//
// Checkable for the same reason rule 60's is: it compares two encodings of one
// fact. `crowded` is the bank's own declaration that a mission needs members of
// the public, `type: photo` is its declaration that something gets captured, and
// prose naming a person as the subject is the third. When all three hold, the
// text must ask.
console.log('\n── 7. public photography asks permission (rule 71) ────────');
{
  // Prose that makes a PERSON the subject of the capture, as opposed to an
  // object, a sign or a page.
  const SHOOTS_A_PERSON = /צלמו אותו|צלמו אותה|הצטלמו איתו|הצטלמו איתה|סלפי|את שניהם|צלמו את התשובה|צלמו אותם/;
  const ASKS_PERMISSION = /בקשו רשות|רשות לצלם|רשות לתמונה|בקשו ממנו רשות|רשות להצטלם/;

  /**
   * Declared exceptions, never inferred. A mission lands here only with a reason
   * that survives being read aloud, and a stale entry fails below.
   */
  const NO_ASK_NEEDED: Record<string, string> = {
    'honest-compliment':
      'the capture IS the request — "if they smiled, ask them for a selfie together" is '
      + 'itself the asking, so a second permission clause would be the same sentence twice.',
  };

  const offenders = TASK_BANK.filter((e) => {
    const t = e.build();
    if (t.type !== 'photo' || !e.tags.includes('crowded')) return false;
    const d = t.description ?? '';
    return SHOOTS_A_PERSON.test(d) && !ASKS_PERMISSION.test(d);
  }).map((e) => e.key);

  eq('every public-photography mission asks permission in its text',
    offenders.filter((k) => !(k in NO_ASK_NEEDED)), []);

  // A declared exception that no longer applies is itself a defect: it would
  // silently excuse a future mission that had drifted into needing the clause.
  const stale = Object.keys(NO_ASK_NEEDED).filter((k) => !offenders.includes(k));
  eq('no stale entries in the no-ask allowlist', stale, []);

  // Anti-vacuity: the patterns must still recognise the shapes they are for.
  ok('the subject pattern matches prose that photographs a person',
    SHOOTS_A_PERSON.test('וצלמו אותו עושה אותה'));
  ok('the permission pattern matches an actual ask',
    ASKS_PERMISSION.test('בקשו ממנו רשות לצלם אותו למשחק'));
}

// ── 8. No sequence step is a wall (rule 77) ──────────────────────────────────
//
// A `sequence` is the only task type where a player cannot go round an obstacle:
// the steps are ordered and the mission does not complete until the last one
// does. So a step whose answer nobody can learn does not merely fail — it blocks
// every step after it, and by rule 77 the residue taxes whatever the composer
// routes the team to next.
//
// Both of this bank's two sequence missions shipped that way. disarm-the-device
// asked for "the secret code word" against an answer that appeared nowhere in
// the entry, in a `noPrep` mission whose own comment called every step "fully
// self-contained content".
//
// Checkable for the same reason rules 41-42, 60 and 71 are: it compares two
// encodings of one fact — an authored answer, against whether the entry gives the
// player any route to it.
console.log('\n── 8. no sequence step is a wall (rule 77) ────────────────');
{
  interface Step { prompt: string; answer?: string }

  /**
   * Steps whose answer is legitimately NOT written down anywhere, with the reason.
   * Declared, never inferred — a step that is a riddle to be deduced rather than a
   * token to be relayed belongs here, and a stale entry fails below.
   */
  const DEDUCED_NOT_RELAYED: Record<string, string> = {};

  /**
   * The decision, isolated from the bank so it can be proven against fixtures.
   *
   * A gate nobody has watched catch anything is not a gate — that is this repo's
   * own lesson about checks whose regex has quietly stopped matching, and the
   * shape `scripts/lib/callableHardening.mjs` already uses (decision logic tested
   * on synthetic inputs, THEN run over the real tree).
   */
  function wallsIn(entry: {
    key: string;
    setup?: { field: string; required?: boolean }[];
    description?: string;
    hint?: string;
    steps: Step[];
  }): string[] {
    // A required Quick Setup step targeting `steps` means the creator authors the
    // question AND the answer before launch, so a placeholder is correct here.
    const creatorAuthorsSteps = (entry.setup ?? []).some((sp) => sp.field === 'steps' && sp.required);
    const haystack = [
      entry.description ?? '',
      entry.hint ?? '',
      ...entry.steps.map((sp) => sp.prompt),
    ].join(' ');
    const out: string[] = [];
    entry.steps.forEach((sp, i) => {
      const answer = (sp.answer ?? '').trim();
      if (!answer) return;               // confirm-only, or a creator placeholder
      if (creatorAuthorsSteps) return;   // the creator supplies both halves
      if (haystack.includes(answer)) return;
      out.push(`${entry.key} step ${i + 1}: answer "${answer}" appears nowhere in the entry`);
    });
    return out;
  }

  // ── Layer 1: the decision logic, against the shape that actually shipped ──
  {
    // disarm-the-device exactly as it was before 2026-09-02, which is the bug this
    // section exists for. If this stops being caught, the gate has rotted.
    const asShipped = {
      key: 'fixture-wall',
      description: 'שלושה סוכנים לפניכם נכשלו כאן. בצעו את שלושת השלבים בדיוק לפי הסדר.',
      steps: [
        { prompt: 'שלב 1: חברו את החוט הכחול. אשרו כשסיימתם.' },
        { prompt: 'שלב 2: הקלידו את מילת הקוד הסודית.', answer: 'פרוטוקול' },
        { prompt: 'שלב 3: לחצו לנטרול סופי.' },
      ],
    };
    ok('the shipped bug IS caught by this check', wallsIn(asShipped).length === 1,
      JSON.stringify(wallsIn(asShipped)));

    // The fix: the same entry with the word in the briefing.
    const fixed = { ...asShipped, description: `${asShipped.description} מילת הקוד היא "פרוטוקול".` };
    eq('…and the repair clears it', wallsIn(fixed), []);

    // A required steps setup makes a placeholder legitimate.
    eq('a creator-authored steps setup is not a wall',
      wallsIn({
        key: 'fixture-setup', description: 'x',
        setup: [{ field: 'steps', required: true }],
        steps: [{ prompt: 'type the word', answer: '' }, { prompt: 'and this one', answer: 'anything' }],
      }), []);
    // …but an OPTIONAL one does not excuse it: the mission can launch unconfigured.
    ok('an optional steps setup does not excuse an unknowable answer', wallsIn({
      key: 'fixture-optional', description: 'x',
      setup: [{ field: 'steps' }],
      steps: [{ prompt: 'type the word', answer: 'unknowable' }],
    }).length === 1);

    eq('a hint counts as a route to the answer',
      wallsIn({
        key: 'fixture-hint', description: 'x', hint: 'the word is banana',
        steps: [{ prompt: 'type it', answer: 'banana' }],
      }), []);
    eq('confirm-only steps are never walls',
      wallsIn({ key: 'fixture-confirm', description: 'x', steps: [{ prompt: 'do the thing' }] }), []);
  }

  // ── Layer 2: the real bank ────────────────────────────────────────────────
  const walls: string[] = [];
  const seen: string[] = [];
  for (const e of TASK_BANK) {
    const t = e.build();
    const steps = (t as unknown as { steps?: Step[] }).steps;
    if (!steps?.length) continue;
    seen.push(e.key);
    walls.push(...wallsIn({
      key: e.key, setup: e.setup, description: t.description, hint: t.hint, steps,
    }));
  }

  eq('every answered sequence step tells the player where to learn the answer',
    walls.filter((w) => !(w.split(' ')[0] in DEDUCED_NOT_RELAYED)), []);
  eq('no stale entries in the deduced-answer allowlist',
    Object.keys(DEDUCED_NOT_RELAYED).filter((k) => !walls.some((w) => w.startsWith(k))), []);

  // The denominator, and the anti-vacuity guard: this section is worthless if the
  // bank ever stops containing sequence missions and nobody notices.
  console.log(`  → checked ${seen.length} sequence mission(s): ${seen.join(', ')}`);
  ok('the scan actually saw a sequence mission', seen.length > 0);
}

// ── 9. Within-family minute spread — REPORTED, never asserted (rule 75) ──────
//
// `estimatedMinutes` feeds taskScoreSmart and computeSkillRatio, so it decides
// whether a team reads as fast or slow, and it feeds the composer's budget, so it
// decides how many missions fit the duration a creator asked for. A wrong one is
// a scoring bug and a pacing bug at once, and looks exactly like a right one.
//
// Two were found by sorting this column: both harvested from the same source
// template, both carrying its number unexamined, both off by a factor of three or
// four. A `family` is the bank's own statement that two missions are near
// duplicates, so a wide spread inside one is the cheapest available signal that
// somebody's estimate was never re-read. Reported rather than asserted — the
// right value is a judgement, and rule 52's failed screen is the standing warning
// about gating on those.
console.log('\n── 9. minutes spread within each family (informational, rule 75) ──');
{
  const families = new Map<string, { key: string; est: number; diff: number }[]>();
  for (const e of TASK_BANK) {
    if (!e.family) continue;
    const t = e.build();
    families.set(e.family, [
      ...(families.get(e.family) ?? []),
      { key: e.key, est: t.estimatedMinutes ?? 0, diff: e.difficulty },
    ]);
  }
  const flagged: string[] = [];
  for (const [family, members] of [...families.entries()].sort()) {
    const ests = members.map((m) => m.est);
    const lo = Math.min(...ests), hi = Math.max(...ests);
    const ratio = lo > 0 ? hi / lo : Infinity;
    const line = members.map((m) => `${m.key}:${m.est}m/d${m.diff}`).join('  ');
    console.log(`  ${family.padEnd(22)} ${lo}-${hi}m  x${ratio.toFixed(1)}  ${line}`);
    if (ratio >= 3) flagged.push(`${family} (x${ratio.toFixed(1)})`);
  }
  console.log(flagged.length
    ? `  → worth a look, spread of 3x or more: ${flagged.join(', ')}`
    : '  → no family spans 3x or more');

  // The denominator, because a check that reports "nothing found" without saying
  // how much it looked at is indistinguishable from one that looked at nothing.
  // This is also the blind spot: challenge-shampoo-pitch was one of the two
  // mis-priced missions and has no family, so this report would never have seen
  // it. Families are the cheap signal, not a complete one.
  const inFamily = TASK_BANK.filter((e) => e.family).length;
  console.log(`  → covers ${inFamily} of ${TASK_BANK.length} missions`
    + ` (${families.size} families); the rest have no sibling to compare against`);
}

// ── 9. Composition mix — REPORTED, never asserted (rule 54) ──────────────────
//
// Distinctiveness is relational: the peak of a composed game is whatever differs
// from its neighbours, so a pool where three missions in five are the same kind
// has a self-similar middle and no peak in it. The right ratio is a judgement
// call and this suite does not pretend otherwise — but drifting further without
// anyone noticing should not be possible, and a count with its denominator
// printed is the cheapest way to make it visible.
// ── 10. `noPrep` never carries a required Quick Setup step (rule 30) ─────────
//
// Written by applying this file's own gate-or-report test to the bank and looking
// for another pair of encodings. This is one: the prep TAG says what the creator
// must do before the game, and the `setup` array says it again in a form the
// composer actually reads. Rule 30 settled which wins — "if a REQUIRED Quick
// Setup step asks them to author content, it is `needsSetup`, whatever props are
// involved" — and named dropping a pin as the exact case that made a level-1
// game unlaunchable.
//
// Two missions still had it: youth-start-point and youth-finish-point, both
// tagged `noPrep` while requiring PLACE_IT. The composer was already safe (rule
// 30 made `fitScore` read the `setup` array rather than the tag, so it cannot
// drift again) — but the tag was still telling creators something untrue, which
// is what a filter runs on.
console.log('\n── 10. noPrep never requires setup (rule 30) ──────────────');
{
  const required = (e: typeof TASK_BANK[number]) => (e.setup ?? []).filter((sp) => sp.required).length;
  const lying = TASK_BANK
    .filter((e) => e.tags.includes('noPrep') && required(e) > 0)
    .map((e) => `${e.key} (${required(e)} required step(s))`);
  eq('no `noPrep` mission carries a required Quick Setup step', lying, []);

  const contradicting = TASK_BANK
    .filter((e) => e.tags.includes('noPrep') && e.tags.includes('needsSetup'))
    .map((e) => e.key);
  eq('no mission claims both `noPrep` and `needsSetup`', contradicting, []);

  const withRequired = TASK_BANK.filter((e) => required(e) > 0).length;
  ok(`the scan actually saw required setup steps :: ${withRequired} of ${TASK_BANK.length}`,
    withRequired > 5);
}

// ── 11. The kids+youth double claim — REPORTED (rule 78) ────────────────────
//
// Carrying both tags says a ten-year-old and a fifteen-year-old will each find
// this good, and rules 51 and 56 say those two want opposite things. A mission
// making the claim needs a COVER, and the cover has three possible sources: the
// prose (a target, a fail-and-retry, a character), the TYPE (a verifying task
// tells you whether you were right, and being right is competence — rule 76), or
// the STRUCTURE (accept-all distributes exposure so nobody stands alone in it).
//
// Reported, never asserted. The first version of this scan read prose only and
// over-fired on eleven of forty-two, ten of which were fine — which is exactly
// rule 52's standing warning about screens that look decisive and are not.
console.log('\n── 11. kids+youth double claim (informational, rule 78) ───');
{
  const VERIFYING = new Set(['quiz', 'numeric', 'geofence', 'sequence', 'smart_station']);
  const PROSE_COVER = /לפחות|עד ש|חייב|כך ש|נפל\?|טעיתם\?|מישהו פספס|בדיוק|בסנכרון|באותו זמן|בו זמנית|באותו רגע|המטרה|יציב|רצף אחד|בלי הפסקה|בלי חיתוך|בלי לעצור|בלי ל|הכי קרוב|ככל ש|צלמו שוב|נסו שוב|חוזרים ל|התחילו מ|אתם ה|אתם משלחת|אתם בסצנ|אתם נכנסים|כאילו|סצנ|הסרט שלכם|הכרוז|כתב טלוויזיה|הפסל|סוכנים|איש הקשר|אצטדיון|שמאי/;
  // "every one of you contributes and all of them stay in" — rule 68.
  const ACCEPT_ALL = /כל אחד מכם|כל אחד בתורו|כולן נשארות|כל השורות|על כל אחד נאמר|כל אחד מדבר/;

  const both = TASK_BANK.filter((e) => e.tags.includes('kids') && e.tags.includes('youth'));
  const bare: string[] = [];
  for (const e of both) {
    const t = e.build();
    const d = `${t.title} ${t.description ?? ''}`;
    if (VERIFYING.has(t.type) || PROSE_COVER.test(d) || ACCEPT_ALL.test(d)) continue;
    bare.push(e.key);
  }
  console.log(`  → ${both.length} of ${TASK_BANK.length} missions claim both kids and youth`);
  console.log(`  → ${both.length - bare.length} carry a cover (prose, verifying type, or accept-all structure)`);
  console.log(bare.length
    ? `  → no cover found, worth a human read: ${bare.join(', ')}`
    : '  → none without a cover THAT THIS SCAN CAN SEE — which is not the same'
      + ' as none without a cover, and is why this section reports (rule 52)');
}

console.log('\n── 12. composition mix (informational, rule 54) ───────────');
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

  // Rule 76: the split that actually matters is not variety for its own sake, it
  // is whether the player is told anything. Everything with a checkable answer
  // gives immediate feedback (flow's second condition); an auto-approved upload
  // tells a team only that it arrived, which is why rule 60 has to ask authors to
  // write the criterion into the prose by hand.
  const VERIFIES = new Set(['quiz', 'numeric', 'geofence', 'sequence', 'smart_station']);
  const verified = TASK_BANK.filter((e) => VERIFIES.has(e.build().type)).length;
  console.log(`  → the platform tells the team whether they got it right in`
    + ` ${verified} of ${TASK_BANK.length} missions`
    + ` (${(100 * verified / TASK_BANK.length).toFixed(0)}%); in the rest the mission`
    + ` text has to carry its own criterion (rule 60)`);
}

console.log(failures === 0
  ? '\n✅ mission bank tag laws: all assertions passed\n'
  : `\n❌ mission bank tag laws: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);

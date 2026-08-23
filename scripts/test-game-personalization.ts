// Pure-logic test for template personalization (change: guided-new-game-wizard).
//
// The new-game wizard asks four questions and turns the answers into a game the
// creator can actually run. Everything STRUCTURAL that follows from those answers
// lives in packages/shared/src/gamePersonalization.ts, because the SERVER applies
// it inside createGameFromTemplate and reports its outcome back to the client.
//
// Three of these rules can quietly ruin a game, which is why they are pinned here:
//
//  1. CAPACITY. `maxConcurrentTeams` is real station contention, not decoration.
//     A template authored for five teams handed to forty players queues everyone
//     at one stop; handed to four players it is meaningless. It must scale, and it
//     must never fall below 1 (a 0-capacity task can never be handed out at all).
//  2. SHORTENING. Trimming an over-long game by lowering Stage.requiredTaskCount
//     is safe ONLY on a stage whose author already declared it partial. A stage
//     that leaves the count unset means "do all of these" — and in the story
//     template that stage holds the climax, so trimming it would silently delete
//     the payoff of the plot with nothing on screen to reveal it.
//  3. CONSENT. requiresGuardianConsent gates PLAY, so switching it on for an age
//     band that does not need it strands a group mid-event.
//
// Every function here is total: a malformed answer skips its own rule and never
// throws, because the alternative is a creator who answered a question wrong and
// got no game at all.
//
//   npx tsx scripts/test-game-personalization.ts
import type { Task } from '../packages/shared/src/types';
import { requiredTaskCountProblem } from '../packages/shared/src/mutualExclusion';
import { normalizeTags, MAX_TAGS } from '../packages/shared/src/tags';
import {
  SMALL_GROUP_MAX_PEOPLE,
  UNLIMITED_CAPACITY_THRESHOLD,
  GUARDIAN_CONSENT_AGE_THRESHOLD,
  TYPICAL_TEAM_SIZE,
  PERSONALIZATION_BASELINE_TEAMS,
  estimatedTeamCount,
  scaleTaskCapacity,
  defaultModeForGroupSize,
  consentSettingsForAge,
  estimateStageMinutes,
  estimateGameMinutes,
  planDurationFit,
  mergePersonalizedTags,
  type PersonalizationStage,
} from '../packages/shared/src/gamePersonalization';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Minimal but REAL Task objects: effectiveExpectedDurationMinutes reads the
// authored field first, so an explicit expectedDurationMinutes pins the estimate
// without depending on the per-type default table.
function task(id: string, minutes: number, capacity = 5): Task {
  return {
    id,
    title: id,
    type: 'field',
    coordinates: { lat: 0, lng: 0 },
    difficulty: 5,
    estimatedMinutes: minutes,
    expectedDurationMinutes: minutes,
    pointValue: 100,
    maxConcurrentTeams: capacity,
  } as Task;
}

function stage(
  id: string,
  tasks: Task[],
  over: Partial<PersonalizationStage> = {},
): PersonalizationStage {
  return { id, order: 0, tasks, ...over };
}

// ── estimatedTeamCount ───────────────────────────────────────────────────────
console.log('\n── estimatedTeamCount ──');

check('a typical team size divides the group', estimatedTeamCount(20) === Math.ceil(20 / TYPICAL_TEAM_SIZE),
  String(estimatedTeamCount(20)));
check('a partial team still counts as a team', estimatedTeamCount(21) === Math.ceil(21 / TYPICAL_TEAM_SIZE),
  String(estimatedTeamCount(21)));
check('never returns 0 teams', estimatedTeamCount(1) >= 1, String(estimatedTeamCount(1)));
for (const junk of [0, -5, NaN, Infinity, undefined as unknown as number, null as unknown as number]) {
  const n = estimatedTeamCount(junk);
  check(`total on ${JSON.stringify(junk)}`, Number.isFinite(n) && n >= 1, String(n));
}

// ── scaleTaskCapacity ────────────────────────────────────────────────────────
console.log('\n── scaleTaskCapacity ──');

// Invariant sweep: the three bounds the spec states, over a wide grid.
{
  let boundsHeld = true;
  const detail: string[] = [];
  for (const authored of [1, 2, 3, 5, 8, 20, 99]) {
    for (const teams of [1, 2, 3, 5, 12, 40]) {
      const out = scaleTaskCapacity(authored, teams);
      if (!(Number.isFinite(out) && out >= 1 && out <= teams)) {
        boundsHeld = false;
        detail.push(`authored=${authored} teams=${teams} -> ${out}`);
      }
    }
  }
  check('capacity is always finite, >= 1 and <= the team count', boundsHeld, detail.join('; '));
}

check('a small group does not inherit oversized capacity',
  scaleTaskCapacity(20, 3) <= 3 && scaleTaskCapacity(20, 3) >= 1,
  String(scaleTaskCapacity(20, 3)));

check('a big group gets more room than the template authored',
  scaleTaskCapacity(3, 40) > 3, String(scaleTaskCapacity(3, 40)));

check('growth is bounded by the team count, so contention survives',
  scaleTaskCapacity(3, 40) <= 40, String(scaleTaskCapacity(3, 40)));

// An "effectively unlimited" task (every survey in both real templates uses 100)
// means the author said "no queue here" — that intent is not ours to rescale.
check('an unlimited task is left exactly as authored',
  scaleTaskCapacity(UNLIMITED_CAPACITY_THRESHOLD, 3) === UNLIMITED_CAPACITY_THRESHOLD,
  String(scaleTaskCapacity(UNLIMITED_CAPACITY_THRESHOLD, 3)));
check('above the unlimited threshold is also left alone',
  scaleTaskCapacity(500, 3) === 500, String(scaleTaskCapacity(500, 3)));

check('scaling is monotonic in the team count',
  scaleTaskCapacity(3, 5) <= scaleTaskCapacity(3, 12)
  && scaleTaskCapacity(3, 12) <= scaleTaskCapacity(3, 40));

check('the authored value is preserved at the baseline team count',
  scaleTaskCapacity(3, PERSONALIZATION_BASELINE_TEAMS) === 3,
  String(scaleTaskCapacity(3, PERSONALIZATION_BASELINE_TEAMS)));

for (const junk of [NaN, -1, 0, undefined as unknown as number]) {
  check(`a malformed authored capacity (${JSON.stringify(junk)}) never yields a non-positive result`,
    scaleTaskCapacity(junk, 10) >= 1, String(scaleTaskCapacity(junk, 10)));
  check(`a malformed team count (${JSON.stringify(junk)}) leaves the authored value usable`,
    scaleTaskCapacity(5, junk) >= 1, String(scaleTaskCapacity(5, junk)));
}

// ── defaultModeForGroupSize ──────────────────────────────────────────────────
console.log('\n── defaultModeForGroupSize ──');

check('a tiny group plays individually',
  defaultModeForGroupSize(SMALL_GROUP_MAX_PEOPLE, 'team') === 'individual');
check('one person plays individually', defaultModeForGroupSize(1, 'team') === 'individual');
check('a normal group keeps the template mode',
  defaultModeForGroupSize(SMALL_GROUP_MAX_PEOPLE + 1, 'team') === 'team');
check('a big group keeps the template mode', defaultModeForGroupSize(40, 'team') === 'team');
check('an individual template stays individual for a big group',
  defaultModeForGroupSize(40, 'individual') === 'individual');
for (const junk of [NaN, -3, 0, undefined as unknown as number]) {
  check(`a malformed group size (${JSON.stringify(junk)}) keeps the template mode`,
    defaultModeForGroupSize(junk, 'team') === 'team');
}

// ── consentSettingsForAge ────────────────────────────────────────────────────
console.log('\n── consentSettingsForAge ──');

{
  const young = consentSettingsForAge(GUARDIAN_CONSENT_AGE_THRESHOLD - 1);
  check('below the threshold turns guardian consent on',
    young.requiresGuardianConsent === true, JSON.stringify(young));
  check('below the threshold also records minAge',
    young.minAge === GUARDIAN_CONSENT_AGE_THRESHOLD - 1, JSON.stringify(young));
}
{
  const teen = consentSettingsForAge(GUARDIAN_CONSENT_AGE_THRESHOLD);
  check('at the threshold minAge is recorded', teen.minAge === GUARDIAN_CONSENT_AGE_THRESHOLD,
    JSON.stringify(teen));
  // Never written as `false`: the template may legitimately require consent, and
  // an answered age must not silently switch a template's own safety setting OFF.
  check('at the threshold consent is left untouched, not switched off',
    teen.requiresGuardianConsent === undefined, JSON.stringify(teen));
}
{
  const adult = consentSettingsForAge(18);
  check('an adult group sets no minAge', adult.minAge === undefined, JSON.stringify(adult));
  check('an adult group does not enable consent',
    adult.requiresGuardianConsent === undefined, JSON.stringify(adult));
}
for (const junk of [NaN, -1, 1000, undefined as unknown as number, null as unknown as number, '12' as unknown as number]) {
  const out = consentSettingsForAge(junk);
  check(`an unusable age (${JSON.stringify(junk)}) sets nothing and does not throw`,
    out.minAge === undefined && out.requiresGuardianConsent === undefined, JSON.stringify(out));
}

// ── estimateStageMinutes ─────────────────────────────────────────────────────
console.log('\n── estimateStageMinutes ──');

// Conservative on purpose: overrunning an event with a hard end time is worse
// than finishing early, so the LONGEST completable tasks are the ones counted.
{
  const s = stage('s', [task('a', 5), task('b', 10), task('c', 2)], { requiredTaskCount: 2 });
  check('counts the requiredTaskCount LONGEST tasks', estimateStageMinutes(s) === 15,
    String(estimateStageMinutes(s)));
}
{
  const s = stage('s', [task('a', 5), task('b', 10), task('c', 2)]);
  check('an unset required count means every task', estimateStageMinutes(s) === 17,
    String(estimateStageMinutes(s)));
}
{
  // An exclusive pair yields ONE completion, so only its longest member counts.
  const s = stage('s', [task('a', 5), task('b', 10), task('c', 3)], {
    exclusiveGroups: [{ id: 'g', taskIds: ['a', 'b'] }],
  });
  check('an exclusive group contributes only its longest member',
    estimateStageMinutes(s) === 13, String(estimateStageMinutes(s)));
}
{
  const s = stage('s', [task('a', 5), task('b', 10)], { requiredTaskCount: 99 });
  check('a required count above what exists is capped at what exists',
    estimateStageMinutes(s) === 15, String(estimateStageMinutes(s)));
}
{
  const s = stage('s', [task('a', 5), task('b', 10), task('c', 2)], { requiredTaskCount: 2 });
  check('an explicit override wins over the authored count',
    estimateStageMinutes(s, 1) === 10, String(estimateStageMinutes(s, 1)));
}
for (const junk of [null, undefined, {}, { tasks: 'nope' }, { tasks: [] }]) {
  const n = estimateStageMinutes(junk as unknown as PersonalizationStage);
  check(`total on ${JSON.stringify(junk)}`, Number.isFinite(n) && n >= 0, String(n));
}

// ── estimateGameMinutes ──────────────────────────────────────────────────────
console.log('\n── estimateGameMinutes ──');
{
  const stages = [
    stage('s1', [task('a', 5)], { order: 0 }),
    stage('s2', [task('b', 10), task('c', 4)], { order: 1, requiredTaskCount: 1 }),
  ];
  check('sums every stage', estimateGameMinutes(stages) === 15, String(estimateGameMinutes(stages)));
  check('applies overrides when given',
    estimateGameMinutes(stages, { s1: 1, s2: 2 }) === 19,
    String(estimateGameMinutes(stages, { s1: 1, s2: 2 })));
}
check('an empty game estimates 0', estimateGameMinutes([]) === 0);
check('total on garbage', estimateGameMinutes(null as unknown as PersonalizationStage[]) === 0);

// ── planDurationFit ──────────────────────────────────────────────────────────
console.log('\n── planDurationFit ──');

/** first stage (protected) · two trimmable middles · final (protected) */
function realisticGame(): PersonalizationStage[] {
  return [
    stage('intro', [task('i1', 5)], { order: 0, requiredTaskCount: 1 }),
    stage('mid1', [task('m1', 10), task('m2', 10), task('m3', 10)], { order: 1, requiredTaskCount: 3 }),
    stage('mid2', [task('n1', 8), task('n2', 8)], { order: 2, requiredTaskCount: 2 }),
    stage('final', [task('f1', 6)], { order: 3, requiredTaskCount: 1, isFinal: true }),
  ];
}

{
  const plan = planDurationFit(realisticGame(), 1000);
  check('a game already inside the budget is never padded',
    Object.keys(plan.overrides).length === 0, JSON.stringify(plan.overrides));
  check('a fitting game reports fits: true', plan.fits === true);
  check('a fitting game reports its own estimate', plan.estimatedMinutes === 57,
    String(plan.estimatedMinutes));
}
{
  const plan = planDurationFit(realisticGame(), 40);
  check('an over-long game is trimmed', Object.keys(plan.overrides).length > 0,
    JSON.stringify(plan.overrides));
  check('trimming actually brings the estimate down', plan.estimatedMinutes <= 57,
    String(plan.estimatedMinutes));
  check('the first stage is never trimmed', plan.overrides.intro === undefined,
    JSON.stringify(plan.overrides));
  check('the final stage is never trimmed', plan.overrides.final === undefined,
    JSON.stringify(plan.overrides));
  const values = Object.values(plan.overrides);
  check('no override drops below 1', values.every((v) => v >= 1), JSON.stringify(plan.overrides));
}
{
  // The rule that protects the story template's climax: its gold stage carries no
  // requiredTaskCount ("do all three"), one of which is the final code puzzle.
  const stages: PersonalizationStage[] = [
    stage('intro', [task('i1', 5)], { order: 0, requiredTaskCount: 1 }),
    stage('doAll', [task('a', 20), task('b', 20), task('c', 20)], { order: 1 }),
    stage('final', [task('f1', 5)], { order: 2, requiredTaskCount: 1, isFinal: true }),
  ];
  const plan = planDurationFit(stages, 20);
  check('a stage with no authored requiredTaskCount is never trimmed',
    plan.overrides.doAll === undefined, JSON.stringify(plan.overrides));
  check('an unfittable game reports fits: false rather than throwing', plan.fits === false);
}
{
  const a = planDurationFit(realisticGame(), 40);
  const b = planDurationFit(realisticGame(), 40);
  check('planning is deterministic', JSON.stringify(a) === JSON.stringify(b),
    `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}
{
  // Ties break by highest order, so a later stage is cut before the opening act.
  const stages: PersonalizationStage[] = [
    stage('first', [task('f0', 5)], { order: 0, requiredTaskCount: 1 }),
    stage('early', [task('e1', 10), task('e2', 10)], { order: 1, requiredTaskCount: 2 }),
    stage('late', [task('l1', 10), task('l2', 10)], { order: 2, requiredTaskCount: 2 }),
    stage('fin', [task('z', 5)], { order: 3, requiredTaskCount: 1, isFinal: true }),
  ];
  const plan = planDurationFit(stages, 40);
  check('an equal-weight tie trims the LATER stage first',
    plan.overrides.late !== undefined && plan.overrides.early === undefined,
    JSON.stringify(plan.overrides));
}
{
  // Whatever the plan does, every stage must still be winnable afterwards.
  const stages = realisticGame();
  const plan = planDurationFit(stages, 15);
  let allWinnable = true;
  const detail: string[] = [];
  for (const s of stages) {
    const required = plan.overrides[s.id] ?? s.requiredTaskCount;
    const problem = requiredTaskCountProblem({ ...s, requiredTaskCount: required }, s.id);
    if (problem) { allWinnable = false; detail.push(problem); }
  }
  check('every stage stays winnable after trimming', allWinnable, detail.join('; '));
}
for (const junk of [null, undefined, [], 'nope']) {
  const plan = planDurationFit(junk as unknown as PersonalizationStage[], 60);
  check(`total on ${JSON.stringify(junk)}`,
    !!plan && typeof plan.estimatedMinutes === 'number' && typeof plan.fits === 'boolean',
    JSON.stringify(plan));
}
for (const target of [0, -10, NaN, undefined as unknown as number]) {
  const plan = planDurationFit(realisticGame(), target);
  check(`an unusable target (${JSON.stringify(target)}) trims nothing`,
    Object.keys(plan.overrides).length === 0, JSON.stringify(plan.overrides));
}

// ── mergePersonalizedTags ────────────────────────────────────────────────────
console.log('\n── mergePersonalizedTags ──');
{
  const merged = mergePersonalizedTags(['עלילה', 'ריגול'], ['נוער', '90 דקות']);
  check('template tags are kept', merged.includes('עלילה') && merged.includes('ריגול'),
    JSON.stringify(merged));
  check('derived tags are added', merged.includes('נוער') && merged.includes('90 דקות'),
    JSON.stringify(merged));
}
{
  const merged = mergePersonalizedTags(['נוער'], ['נוער']);
  check('a duplicate collapses to one', merged.filter((t) => t === 'נוער').length === 1,
    JSON.stringify(merged));
}
{
  const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `t${i}`);
  const merged = mergePersonalizedTags(many, ['extra']);
  check('the tag ceiling is respected', merged.length <= MAX_TAGS, String(merged.length));
}
check('the merge runs through the shared normalizer',
  JSON.stringify(mergePersonalizedTags([' A ', 'a'], [])) === JSON.stringify(normalizeTags(' A , a')),
  JSON.stringify(mergePersonalizedTags([' A ', 'a'], [])));
for (const junk of [null, undefined, 'nope', 42]) {
  const merged = mergePersonalizedTags(junk as unknown as string[], junk as unknown as string[]);
  check(`total on ${JSON.stringify(junk)}`, Array.isArray(merged), JSON.stringify(merged));
}

console.log(`\n${failures === 0 ? 'ALL GAME-PERSONALIZATION TESTS PASSED' : failures + ' FAILED'}`);
process.exit(failures === 0 ? 0 : 1);

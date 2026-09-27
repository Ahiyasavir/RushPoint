// Pure-logic tests — the site's ready-made templates
// (change: site-templates, 2026-09-02).
//
// These templates are the "guided" path's entire content: what a creator gets
// when they tap a ready game instead of composing one. Production served two of
// them, both for youth, while the marketing site sold seven occasions — so the
// failure this file guards is not a crash, it is a template that looks fine in
// Firestore and cannot be launched, or that quietly still contains a mission the
// bank rejected months ago.
//
// The gate that matters most is §3: every template goes through the SAME
// `gameStructureProblems` battery `updateGame` runs at go-live. A template that
// fails it is one a creator cannot launch, and they would find out at the end of
// setup rather than here.
import {
  gameStructureProblems, resolveWizardTarget,
} from '@rushpoint/shared';
import { SITE_TEMPLATES, buildSiteTemplate, missingKeys, stageId, taskId } from './lib/siteTemplates';
import { TASK_BANK } from '../apps/creator-web/src/taskBank';

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

const byKey = new Map(TASK_BANK.map((e) => [e.key, e]));
console.log('\nsite templates');

// ── 1. The declarations are coherent ────────────────────────────────────────
console.log('\n── 1. declarations ────────────────────────────────────────');
{
  ok(`there are templates :: ${SITE_TEMPLATES.length}`, SITE_TEMPLATES.length >= 5);
  const keys = SITE_TEMPLATES.map((t) => t.key);
  eq('template keys are unique', keys.length - new Set(keys).size, 0);
  const orders = SITE_TEMPLATES.map((t) => t.order);
  eq('menu orders are unique', orders.length - new Set(orders).size, 0);
  eq('every key is kebab-case', keys.filter((k) => !/^[a-z][a-z0-9-]*$/.test(k)), []);
  eq('every template has stages', SITE_TEMPLATES.filter((t) => t.stages.length === 0).map((t) => t.key), []);
  eq('every stage has missions',
    SITE_TEMPLATES.flatMap((t) => t.stages.filter((s) => s.keys.length === 0).map(() => t.key)), []);
  eq('every stage has a title',
    SITE_TEMPLATES.flatMap((t) => t.stages.filter((s) => !s.title.trim()).map(() => t.key)), []);
}

// ── 2. Every mission named still exists ─────────────────────────────────────
//
// THE point of composing templates from bank keys. `קולה` shipped in a live
// template for months after the bank dropped it, because nothing connected the
// two. This is that connection.
console.log('\n── 2. every named mission is still in the bank ────────────');
{
  for (const t of SITE_TEMPLATES) eq(`${t.key}: no missing missions`, missingKeys(t), []);
  const used = new Set(SITE_TEMPLATES.flatMap((t) => t.stages.flatMap((s) => s.keys)));
  ok(`the templates draw on a real spread of the bank :: ${used.size} of ${TASK_BANK.length}`, used.size >= 30);
}

// ── 3. Every template would survive go-live ─────────────────────────────────
console.log('\n── 3. the save-guard battery, exactly as updateGame runs it ');
{
  for (const t of SITE_TEMPLATES) {
    const built = buildSiteTemplate(t);
    eq(`${t.key}: no structural problems`, gameStructureProblems(built.stages, { phase: 'golive' }), []);
    ok(`${t.key}: exactly one final stage`,
      built.stages.filter((s) => s.isFinal).length === 1);
    ok(`${t.key}: the final stage is the last one`, built.stages[built.stages.length - 1].isFinal === true);
  }
}

// ── 4. Ids are deterministic and unique ─────────────────────────────────────
//
// Re-seeding must UPDATE a template, not mint a parallel copy, and a wizard step
// has to keep pointing at the mission it was written for.
console.log('\n── 4. ids are stable across builds ────────────────────────');
{
  for (const t of SITE_TEMPLATES) {
    const a = buildSiteTemplate(t), b = buildSiteTemplate(t);
    eq(`${t.key}: two builds produce the same stage ids`,
      a.stages.map((s) => s.id), b.stages.map((s) => s.id));
    eq(`${t.key}: two builds produce the same task ids`,
      a.stages.flatMap((s) => s.tasks.map((x) => x.id)), b.stages.flatMap((s) => s.tasks.map((x) => x.id)));
    const ids = a.stages.flatMap((s) => s.tasks.map((x) => x.id));
    eq(`${t.key}: task ids are unique`, ids.length - new Set(ids).size, 0);
    eq(`${t.key}: ids match the documented shape`,
      [a.stages[0].id, a.stages[0].tasks[0].id], [stageId(t, 0), taskId(t, 0, 0)]);
  }
  // …but the CONTENT is a fresh object each time, because build() is a factory.
  const one = SITE_TEMPLATES[0];
  const x = buildSiteTemplate(one).stages[0].tasks[0];
  const y = buildSiteTemplate(one).stages[0].tasks[0];
  ok('two builds share no task object', x !== y);
}

// ── 5. Quick Setup is derived, resolvable, and complete ─────────────────────
//
// A step that cannot be resolved is inert by design (templateWizard's fail-open
// rule), which is exactly why an unresolvable one has to fail HERE: silently
// inert means a creator is never asked for the pin their mission needs.
console.log('\n── 5. Quick Setup steps resolve to real fields ────────────');
{
  for (const t of SITE_TEMPLATES) {
    const built = buildSiteTemplate(t);
    const game = { stages: built.stages, wizardSteps: built.wizardSteps } as never;
    const unresolved = built.wizardSteps.filter((s) => resolveWizardTarget(game, s) === null).map((s) => s.id);
    eq(`${t.key}: every step resolves`, unresolved, []);

    // Every REQUIRED setup step the bank declares for a used mission must appear.
    const wantRequired = t.stages.flatMap((s, i) => s.keys.flatMap((k, j) =>
      (byKey.get(k)?.setup ?? []).filter((st) => st.required).map((st) => `${taskId(t, i, j)}:${st.field}`)));
    const haveRequired = built.wizardSteps.filter((s) => s.isRequired).map((s) => `${s.taskId}:${s.targetFieldPath}`);
    eq(`${t.key}: no required setup step is lost`, wantRequired.filter((w) => !haveRequired.includes(w)), []);

    const ids = built.wizardSteps.map((s) => s.id);
    eq(`${t.key}: step ids are unique`, ids.length - new Set(ids).size, 0);
    eq(`${t.key}: every step carries a prompt`, built.wizardSteps.filter((s) => !s.instructionPrompt.trim()).length, 0);
  }
}

// ── 6. Each template is actually FOR the audience it claims ─────────────────
//
// The defect that started this: production served a youth street race to every
// occasion the site sells. A template whose missions do not carry its audience
// is that failure wearing a new title.
console.log('\n── 6. audience and venue coherence ────────────────────────');
{
  const audienceOf = (k: string) => byKey.get(k)?.tags ?? [];
  const check = (key: string, label: string, pred: (tags: readonly string[]) => boolean) => {
    const t = SITE_TEMPLATES.find((x) => x.key === key);
    if (!t) { ok(`${key} exists`, false); return; }
    const bad = t.stages.flatMap((s) => s.keys).filter((k) => !pred(audienceOf(k)));
    eq(`${key}: ${label}`, bad, []);
  };

  // The home templates promise "inside the house, no equipment": no pin, no prep.
  for (const key of ['site-family-home', 'site-help-at-home']) {
    check(key, 'every mission plays at home', (tg) => tg.includes('home'));
    check(key, 'no mission needs a map pin', (tg) => tg.includes('fromAnywhere'));
    check(key, 'no mission needs an outside partner', (tg) => !tg.includes('needsPartner'));
  }
  check('site-family-home', 'nothing to prepare in advance', (tg) => tg.includes('noPrep'));
  check('site-help-at-home', 'every mission is real housework', (tg) => tg.includes('chores') || tg.includes('start') || tg.includes('finish'));

  // A classroom does not leave the building.
  check('site-education', 'every mission works indoors or at school',
    (tg) => tg.includes('indoor') || tg.includes('school') || tg.includes('fromAnywhere'));

  // A corporate day must not be built from missions written for children.
  check('site-team-building', 'every mission suits adults or a work team',
    (tg) => tg.includes('corporate') || tg.includes('adults') || tg.includes('mixed'));

  // A bar mitzvah is teenagers, parents and grandparents in one room, so nothing
  // here may be single-band, and nothing may need running or the floor.
  check('site-bar-mitzvah', 'every mission suits a mixed-age room',
    (tg) => tg.includes('mixed'));
  check('site-bar-mitzvah', 'nothing needs a venue or a pin', (tg) => tg.includes('fromAnywhere'));

  // A wedding is played standing, in good clothes, during the cocktail hour.
  check('site-wedding', 'every mission suits adults or a mixed room',
    (tg) => tg.includes('adults') || tg.includes('mixed'));
  check('site-wedding', 'nothing needs a venue or a pin', (tg) => tg.includes('fromAnywhere'));
  check('site-wedding', 'nothing to prepare in advance', (tg) => tg.includes('noPrep'));

  // A peula is a youth-movement meeting: teenagers, a madrich, no budget.
  check('site-youth-movement', 'every mission suits youth', (tg) => tg.includes('youth') || tg.includes('mixed'));
  check('site-youth-movement', 'nothing to prepare in advance', (tg) => tg.includes('noPrep'));

  check('site-birthday', 'every mission suits kids or a mixed party',
    (tg) => tg.includes('kids') || tg.includes('youth') || tg.includes('mixed'));
}

// ── 7. Bookends, shape and length ───────────────────────────────────────────
console.log('\n── 7. every template opens and closes deliberately ────────');
{
  for (const t of SITE_TEMPLATES) {
    const first = t.stages[0].keys[0];
    const lastStage = t.stages[t.stages.length - 1];
    const last = lastStage.keys[lastStage.keys.length - 1];
    ok(`${t.key}: opens on an opener (${first})`, (byKey.get(first)?.tags ?? []).includes('start'));
    ok(`${t.key}: closes on a finale (${last})`, (byKey.get(last)?.tags ?? []).includes('finish'));

    // Against the session the template DECLARES, not a global range: a lesson
    // and a corporate offsite are not the same event and must not share a bound.
    // `estimatedMinutes` is the right field — measured from assignment, so it
    // includes the walking. `expectedDurationMinutes` is interaction only and
    // reports a 45 minute lesson as 17 minutes of game.
    const built = buildSiteTemplate(t);
    const minutes = built.stages.flatMap((s) => s.tasks)
      .reduce((n, task) => n + (task.estimatedMinutes ?? 0), 0);
    const [lo, hi] = t.sessionMinutes;
    ok(`${t.key}: fits its declared session :: ${minutes} min, wants ${lo}-${hi}`,
      minutes >= lo && minutes <= hi, `${minutes}`);

    const count = built.stages.flatMap((s) => s.tasks).length;
    ok(`${t.key}: enough to be worth opening :: ${count} missions`, count >= 6 && count <= 20);
  }
}

// ── 8. No mission appears twice in one template ─────────────────────────────
//
// The composer's own rule (`usedKeys`), which a hand-written declaration has no
// automatic protection against.
console.log('\n── 8. no repeats inside one template ──────────────────────');
{
  for (const t of SITE_TEMPLATES) {
    const keys = t.stages.flatMap((s) => s.keys);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    eq(`${t.key}: every mission appears once`, [...new Set(dupes)], []);

    // …and no two missions from one `family`, for the same reason the composer
    // refuses it: a template that shows both is repeating itself.
    const fams = keys.map((k) => byKey.get(k)?.family).filter(Boolean) as string[];
    const famDupes = fams.filter((f, i) => fams.indexOf(f) !== i);
    eq(`${t.key}: no two near-duplicates`, [...new Set(famDupes)], []);
  }
}

// ── 9. "Pick N of these" is emitted correctly, or not at all ────────────────
//
// `requiredTaskCount` is the only field here that changes what a team is asked
// to DO rather than what it is offered, and it has a documented footgun: a count
// that exceeds what the stage can actually yield makes the stage uncompletable.
// `gameStructureProblems` in §3 already refuses that; this section holds the
// narrower claims that a count is present only where a template asked for one
// and only where it genuinely narrows the stage.
console.log('\n── 9. pick-N stages ───────────────────────────────────────');
{
  let declared = 0;
  for (const t of SITE_TEMPLATES) {
    const built = buildSiteTemplate(t);
    built.stages.forEach((stage, i) => {
      const want = t.stages[i].requiredCount;
      const got = stage.requiredTaskCount;
      if (typeof want === 'number' && want < stage.tasks.length) {
        declared++;
        eq(`${t.key} stage ${i + 1}: the declared count is emitted`, got, want);
        ok(`${t.key} stage ${i + 1}: the count is attainable`, want >= 1 && want <= stage.tasks.length);
      } else {
        eq(`${t.key} stage ${i + 1}: no redundant count`, got, undefined);
      }
    });
  }
  ok(`the mechanic is actually exercised :: ${declared} stage(s)`, declared >= 1);
}

// ── 10. Every template ends on a deliberate last beat ───────────────────────
//
// Peak-end, plus the experiential-learning finding that reflection is where a
// session's meaning gets made. Not every event wants a debrief — a wedding does
// not — but the ones sold as learning or team development do, and shipping one
// that ends on a scoreboard would be skipping the part it exists for.
console.log('\n── 10. the learning templates end on reflection ────────────');
{
  const REFLECTIVE = new Set(['finish-what-we-didnt-know', 'finish-one-word-each', 'best-moment-so-far']);
  for (const key of ['site-education', 'site-team-building', 'site-youth-movement', 'site-help-at-home']) {
    const t = SITE_TEMPLATES.find((x) => x.key === key);
    if (!t) { ok(`${key} exists`, false); continue; }
    const last = t.stages[t.stages.length - 1];
    ok(`${key}: ends on reflection (${last.keys[last.keys.length - 1]})`,
      REFLECTIVE.has(last.keys[last.keys.length - 1]));
  }
}

console.log(failures === 0
  ? '\n✅ site templates: all assertions passed\n'
  : `\n❌ site templates: ${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);

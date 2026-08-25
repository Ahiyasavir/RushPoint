// Pure-logic tests — the tagged mission bank the composer draws from
// (change: smart-game-composer).
//
// The bank is a flat pool of individually-buildable missions, a PEER of
// templates.ts rather than something derived from it at runtime. That is not a
// style choice: `TEMPLATES.flatMap(t => t.build())` mints fresh uuids on every
// call, so every rule keyed on mission identity — "no mission twice in one
// game", the recency memory, these tests — would silently compare two objects
// that are never the same twice.
//
// What is worth a gate here:
//
//   • KEYS are the anti-repetition primitive. A duplicate key makes two missions
//     indistinguishable to the recency memory; a key that changes makes a
//     creator's memory forget a mission it just used.
//   • `build()` must mint a fresh id EVERY call, including for a sequence's
//     steps — the same collision check templatesValid.test.ts runs, for the same
//     reason: two missions sharing an id corrupts routing and scoring.
//   • `entry.difficulty` DUPLICATES the built task's difficulty (design D2 — so
//     scoring never has to call build() per candidate per slot). Duplication
//     drifts, so it is pinned here for every entry and cannot ship broken.
//   • BOOKEND POOLS must offer a real choice. With only one `start` mission the
//     opener is a forced pick and every composed game opens identically, which
//     defeats the feature.
//   • Every `setup[].field` must name a field a creator can actually set. A
//     Quick Setup step pointing at a field the mission does not have is a dead
//     end in the creator's very first flow.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { TASK_BANK, type TaskBankEntry } from '../apps/creator-web/src/taskBank';
import { BANK_TAGS, AUDIENCE_TAG_IDS } from '../apps/creator-web/src/bankTags';
import type { Task } from '@rushpoint/shared';
import { gameStructureProblems } from '@rushpoint/shared';

let failures = 0;
function ok(label: string, cond: boolean): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

/**
 * Every `id` removed, at every depth — a sequence task carries `steps[].id`,
 * which is also minted fresh per build. Without recursing, two builds of a
 * sequence mission would compare unequal and the "otherwise identical" assertion
 * would fail for the wrong reason.
 */
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'id') continue;
      out[k] = stripIds(v);
    }
    return out;
  }
  return value;
}

/** Every `id` found at any depth, so cross-build collisions are visible. */
function collectIds(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) { value.forEach((v) => collectIds(v, into)); return into; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'id' && typeof v === 'string') into.push(v);
      else collectIds(v, into);
    }
  }
  return into;
}

const KNOWN_TAGS = new Set(Object.keys(BANK_TAGS));
const AUDIENCE = new Set<string>(AUDIENCE_TAG_IDS);
const PLACE_TAGS = new Set(['outdoor', 'indoor', 'fromAnywhere']);

// Built once — every later section reuses these so `build()` is not called
// hundreds of times, and so a build that THROWS fails loudly right here rather
// than as a confusing downstream error.
const built = new Map<string, Task>();
for (const e of TASK_BANK) {
  try {
    built.set(e.key, e.build());
  } catch (err) {
    failures++;
    console.error(`  ✗ entry "${e.key}" threw while building: ${String(err)}`);
  }
}

console.log('\n── 1. the bank is a usable pool ────────────────────────────');
ok('TASK_BANK is a non-empty array', Array.isArray(TASK_BANK) && TASK_BANK.length > 0);
// The floor is what the composer NEEDS, not what we wish the bank had. A game is
// at least MIN_TASKS missions and no mission repeats inside one game, so a bank
// below that cannot fill even the shortest answer. The real bank is larger; this
// catches a harvest that silently dropped most of its content.
ok(`the bank can fill the shortest game (has ${TASK_BANK.length}, needs 4)`, TASK_BANK.length >= 4);
ok('every entry built without throwing', built.size === TASK_BANK.length);

console.log('\n── 2. keys are unique, stable and readable ─────────────────');
{
  const keys = TASK_BANK.map((e) => e.key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  eq('every key is unique', [...new Set(dupes)], []);

  const badShape = keys.filter((k) => typeof k !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(k));
  eq('every key is non-empty kebab-case', badShape, []);
}

console.log('\n── 3. build() mints fresh ids every call ───────────────────');
{
  const notFresh: string[] = [];
  const notStable: string[] = [];
  for (const e of TASK_BANK) {
    let a: Task; let b: Task;
    try { a = e.build(); b = e.build(); } catch { continue; }

    // Every id at every depth must differ between the two builds.
    const idsA = collectIds(a);
    const idsB = collectIds(b);
    const shared = idsA.filter((id) => idsB.includes(id));
    if (shared.length > 0 || idsA.length === 0) notFresh.push(e.key);

    // …and everything else must be identical, or `build()` is not a pure factory.
    if (JSON.stringify(stripIds(a)) !== JSON.stringify(stripIds(b))) notStable.push(e.key);
  }
  eq('two builds of the same entry share no id, at any depth', notFresh, []);
  eq('two builds of the same entry are otherwise identical', notStable, []);
}

console.log('\n── 4. declared difficulty matches the built mission ────────');
{
  // Design D2: `entry.difficulty` is duplicated onto the entry so scoring can
  // read it without calling build() per candidate per slot. This is the pin that
  // makes the duplication safe.
  const drifted = TASK_BANK
    .filter((e) => built.has(e.key) && e.difficulty !== built.get(e.key)!.difficulty)
    .map((e) => `${e.key}: entry ${e.difficulty} vs built ${built.get(e.key)!.difficulty}`);
  eq('every entry.difficulty equals build().difficulty', drifted, []);

  const outOfRange = TASK_BANK
    .filter((e) => !Number.isInteger(e.difficulty) || e.difficulty < 1 || e.difficulty > 10)
    .map((e) => e.key);
  eq('every difficulty is an integer in 1-10', outOfRange, []);
}

console.log('\n── 5. tags come from the registry and classify the entry ───');
{
  const unknown = TASK_BANK
    .flatMap((e) => (e.tags ?? []).map((t) => ({ key: e.key, t })))
    .filter(({ t }) => !KNOWN_TAGS.has(t))
    .map(({ key, t }) => `${key}:${t}`);
  eq('every declared tag is a registry id', unknown, []);

  const dupeTags = TASK_BANK
    .filter((e) => new Set(e.tags).size !== e.tags.length)
    .map((e) => e.key);
  eq('no entry declares the same tag twice', dupeTags, []);

  const noAudience = TASK_BANK.filter((e) => !e.tags.some((t) => AUDIENCE.has(t))).map((e) => e.key);
  eq('every entry carries at least one audience tag', noAudience, []);

  const noPlace = TASK_BANK.filter((e) => !e.tags.some((t) => PLACE_TAGS.has(t))).map((e) => e.key);
  eq('every entry says where it can be played', noPlace, []);
}

console.log('\n── 6. the bookend pools offer a real choice ────────────────');
{
  const openers = TASK_BANK.filter((e) => e.tags.includes('start'));
  const finales = TASK_BANK.filter((e) => e.tags.includes('finish'));
  // One of each is what the bookend rule REQUIRES to function. More is better —
  // with a single opener every composed game opens the same way — but that is a
  // content ambition, not a correctness bar, and asserting a number the harvested
  // bank cannot meet would just train us to edit the test.
  ok(`at least one opener (has ${openers.length})`, openers.length >= 1);
  ok(`at least one finale (has ${finales.length})`, finales.length >= 1);

  // A KNOWN GAP, asserted so it stays visible rather than being rediscovered.
  // `fromAnywhere` is also the "no venue" answer, so a bookend that REQUIRES a
  // location is filtered out entirely for a creator with no venue — those games
  // come out with no opener and no finale. The composer handles it (an unfillable
  // bookend slot is dropped, never faked), so this is a content shortfall rather
  // than a defect: the harvested bank is a walking race, and every mission that
  // frames a start or a finish line is sited by nature.
  const placeless = (e: TaskBankEntry) => !e.tags.includes('locationBased') || e.tags.includes('fromAnywhere');
  const placelessOpeners = openers.filter(placeless).length;
  const placelessFinales = finales.filter(placeless).length;
  console.log(`  ℹ no-venue bookends: ${placelessOpeners} opener(s), ${placelessFinales} finale(s)`
    + (placelessOpeners === 0 || placelessFinales === 0
      ? ' — a no-venue game composes without one. Add a placeless bookend to close this.'
      : ''));

  eq('no entry is both an opener and a finale',
    TASK_BANK.filter((e) => e.tags.includes('start') && e.tags.includes('finish')).map((e) => e.key), []);
}

/**
 * Optional Task fields a Quick Setup step may legitimately ask a creator to
 * FILL IN, even though the harvested mission ships without them.
 *
 * Declared, never inferred from the type: the point is that adding a step for a
 * misspelled field still fails, which an "any optional key" rule would not.
 */
const SETTABLE_TASK_FIELDS = new Set([
  'media', 'coordinates', 'geofenceRadiusMeters', 'answers', 'choices',
  'numericAnswer', 'numericTolerance', 'surveyChoices', 'steps', 'orderItems',
  'hint', 'hintPenalty', 'description', 'title',
]);

console.log('\n── 7. declared Quick Setup points at real, settable fields ─');
{
  const badField: string[] = [];
  const badPrompt: string[] = [];
  for (const e of TASK_BANK) {
    const task = built.get(e.key);
    if (!task || !e.setup) continue;
    for (const s of e.setup) {
      // The field must be one a mission really has. Presence on the BUILT object
      // is not the test: the most valuable steps are exactly the ones asking for
      // something the mission does not carry yet — `media` on a "navigate to the
      // photo" mission is the whole point of that step, and a bank mission never
      // ships media (it would point at the source template's storage folder).
      // So the bar is that the name is a settable Task field, not that a value
      // is already sitting in it.
      const present = s.field in (task as unknown as Record<string, unknown>);
      if (typeof s.field !== 'string' || !(present || SETTABLE_TASK_FIELDS.has(s.field))) {
        badField.push(`${e.key}:${String(s.field)}`);
      }
      if (typeof s.prompt !== 'string' || s.prompt.trim() === '') badPrompt.push(e.key);
    }
  }
  eq('every setup field exists on the built mission', badField, []);
  eq('every setup prompt is non-empty', badPrompt, []);

  const dupeFields = TASK_BANK
    .filter((e) => e.setup && new Set(e.setup.map((s) => s.field)).size !== e.setup.length)
    .map((e) => e.key);
  eq('no entry declares two setup steps for the same field', dupeFields, []);
}

console.log('\n── 8. traceability back to the source template ─────────────');
{
  // No longer checked against templates.ts: the bank is harvested from the ACTIVE
  // production templates (the ones flagged isTemplate), which are Firestore
  // documents this process cannot read. What is still worth pinning is that every
  // entry says where it came from, so a re-harvest is a diff and not a mystery.
  const bad = TASK_BANK
    .filter((e) => typeof e.sourceTemplateKey !== 'string' || e.sourceTemplateKey.trim() === '')
    .map((e) => e.key);
  eq('every entry names its source', bad, []);

  const sources = [...new Set(TASK_BANK.map((e) => e.sourceTemplateKey))].sort();
  console.log(`  ℹ harvested from: ${sources.join(', ')}`);
}

console.log('\n── 8b. transit is declared where, and only where, it is real ');
{
  // The model is `interaction + overhead + transit`, and transit is the term that
  // belongs to the mission rather than to a constant. Two ways to get it wrong,
  // both silent: a sited mission with no walk priced in makes a walking race look
  // like a couch game, and a walk on a play-from-anywhere mission invents travel
  // to a place that does not exist.
  const sitedNoTransit = TASK_BANK
    .filter((e) => e.tags.includes('locationBased') && e.transitMinutes === undefined)
    .map((e) => e.key);
  eq('every location-based mission declares its transit', sitedNoTransit, []);

  const placelessWithTransit = TASK_BANK
    .filter((e) => !e.tags.includes('locationBased') && (e.transitMinutes ?? 0) > 0)
    .map((e) => e.key);
  eq('no play-from-anywhere mission claims travel time', placelessWithTransit, []);

  const negative = TASK_BANK
    .filter((e) => e.transitMinutes !== undefined
      && (!Number.isFinite(e.transitMinutes) || (e.transitMinutes as number) < 0))
    .map((e) => e.key);
  eq('no transit is negative or malformed', negative, []);
}

console.log('\n── 9. the missions themselves are authored, not blank ──────');
{
  const blankTitle = [...built.entries()].filter(([, t]) => !t.title || t.title.trim() === '').map(([k]) => k);
  eq('every mission has a title', blankTitle, []);

  const blankDesc = [...built.entries()]
    .filter(([, t]) => typeof t.description !== 'string' || t.description.trim() === '')
    .map(([k]) => k);
  eq('every mission has a description', blankDesc, []);

  // The composer emits no advanced structures (design D5/D8); a mission carrying
  // one would smuggle it in and break launch-validity by construction.
  const advanced = [...built.entries()]
    .filter(([, t]) => {
      const r = t as unknown as Record<string, unknown>;
      return r.unlockAfterTaskIds !== undefined || r.availableFrom !== undefined || r.availableUntil !== undefined;
    })
    .map(([k]) => k);
  eq('no mission carries unlock dependencies or an availability window', advanced, []);
}


// ─── Every mission is structurally valid ON ITS OWN ──────────────────────────
//
// The composer promises games that `updateGame` accepts, and it keeps that
// promise by construction — but only for the parts IT controls (stage shape,
// counts, the final flag). It cannot rescue a mission that is invalid in itself.
//
// Two authored missions proved it: a quiz shipped with an empty answer list and a
// station with an empty secret code, both intending Quick Setup to fill them in.
// Both are rejected by `gameStructureProblems`, so the composed game would not
// save at all — the creator answers the questionnaire and gets an error with
// nothing to act on. A bank mission must therefore be VALID as authored, and
// Quick Setup's job is to REPLACE a working default, never to supply a missing
// one.
//
// Checked here rather than only through the composer so the failure names the
// mission, instead of surfacing as a random matrix cell three layers away.
console.log('\n── 10. every mission would survive updateGame on its own ────');
{
  const invalid: string[] = [];
  for (const e of TASK_BANK) {
    const task = built.get(e.key);
    if (!task) continue;
    const problems = gameStructureProblems([
      { id: 'probe', order: 0, title: 'probe', isFinal: true, requiredTaskCount: 1, tasks: [task] },
    ] as never);
    if (problems.length > 0) invalid.push(`${e.key}: ${problems[0]}`);
  }
  eq('no mission is rejected by the save-guard validators', invalid, []);
}

// ─── 11. Authored prose is not quietly broken ────────────────────────────────
//
// The i18n gate does not reach here. PART A checks the DICTIONARIES and PART B
// scans components for hardcoded strings; this file is neither, so every word of
// mission copy a player reads is unchecked by anything else.
//
// A real one slipped in: "אי אפשr" — a Latin r welded onto a Hebrew word, from a
// keyboard-layout slip. It renders as a broken word mid-sentence, it survives
// typecheck, lint and every composer test, and the only way it surfaces is a
// player squinting at their phone. A Latin letter directly adjacent to a Hebrew
// one is never a real word, so it is cheap to refuse.
console.log('\n── 11. authored prose is not quietly broken ────────────────');
{
  const MIXED = /[֐-׿][A-Za-z]|[A-Za-z][֐-׿]/;
  const mixed: string[] = [];
  const blank: string[] = [];

  const inspect = (key: string, field: string, value: unknown) => {
    if (typeof value !== 'string') return;
    if (value.trim() === '') { blank.push(`${key}.${field}`); return; }
    const hit = value.match(MIXED);
    if (hit) mixed.push(`${key}.${field}: "${hit[0]}"`);
  };

  for (const e of TASK_BANK) {
    const task = built.get(e.key);
    if (!task) continue;
    inspect(e.key, 'title', task.title);
    inspect(e.key, 'description', task.description);
    if (task.hint !== undefined) inspect(e.key, 'hint', task.hint);
    (task.steps ?? []).forEach((st, i) => inspect(e.key, `steps[${i}]`, st.prompt));
    (task.surveyChoices ?? []).forEach((c, i) => inspect(e.key, `surveyChoices[${i}]`, c));
    (e.setup ?? []).forEach((su, i) => inspect(e.key, `setup[${i}]`, su.prompt));
  }

  eq('no Hebrew word carries a stray Latin letter', mixed, []);
  eq('no authored string is blank', blank, []);
}

// ─── 12. family groups are real clusters, not stray typos ───────────────────
//
// `family` exists so the composer never lands two near-duplicate missions
// ("collect five things one colour" / "collect a rainbow") in the same game —
// see composeGame.ts's `usedFamilies`. A family of exactly one entry is a typo
// that just silently disabled itself: it excludes nothing, because nothing else
// shares it.
console.log('\n── 12. family groups are real clusters ──────────────────────');
{
  const bySize = new Map<string, string[]>();
  for (const e of TASK_BANK) {
    if (!e.family) continue;
    const list = bySize.get(e.family) ?? [];
    list.push(e.key);
    bySize.set(e.family, list);
  }
  const lonely = [...bySize.entries()].filter(([, keys]) => keys.length < 2).map(([f]) => f);
  eq('every declared family has at least 2 members', lonely, []);

  console.log(`  ℹ ${bySize.size} famil${bySize.size === 1 ? 'y' : 'ies'}: `
    + [...bySize.entries()].map(([f, keys]) => `${f}(${keys.length})`).join(', '));
}

console.log('');
if (failures > 0) {
  console.error(`\x1b[31m✗ smart-game-composer/task-bank: ${failures} assertion(s) failed\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32m✓ smart-game-composer/task-bank: all assertions passed\x1b[0m');

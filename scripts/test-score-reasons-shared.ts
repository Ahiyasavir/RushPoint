// The reason vocabulary has exactly ONE definition (change: live-ops-feedback-loop).
//
// `adjustTeamScore` writes `reason` into an immutable `auditLogs` record. In run
// ijI9JMITSf8C9heN1Cwp the organizer's manual awards fully reversed the standings —
// team 💕 finished fastest and placed 4th — and every one of those rows says the
// literal 'manual', because RunConsolePage hardcoded it while the staff console had a
// full picker sitting in apps/play-web/src/lib/scoreReasons.ts.
//
// The ids are a WIRE VOCABULARY, not display strings: an audit row written from a
// Hebrew-configured phone has to be readable by an organizer reviewing it in English,
// so the id is language-neutral and the wording is resolved per app. Two copies of the
// list would produce rows nobody can group — which is why this guard exists in the
// same shape as scripts/test-upload-origin-parity.ts: it asserts that ONE module
// defines the ids, and that every app which offers the picker can render all of them
// in BOTH languages.
//
// A missing label is not cosmetic. A picker option whose label does not resolve
// renders as `undefined` on a live console, in the flow that decides who won.
import fs from 'node:fs';
import path from 'node:path';
import {
  BONUS_REASONS, PENALTY_REASONS, OTHER_REASON, reasonsForDelta, resolveReason, parseAdjustAmount,
} from '../packages/shared/src/scoreReasons';

let failures = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? ` :: ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

const ROOT = path.resolve(__dirname, '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Every id the shared module defines, which is the whole vocabulary. */
const ALL_IDS = [...BONUS_REASONS, ...PENALTY_REASONS, OTHER_REASON];

console.log('\nlive-ops — the reason vocabulary has one definition');

// ── 1. The vocabulary is coherent ────────────────────────────────────────────
{
  ok(`the vocabulary is non-empty :: ${ALL_IDS.length} ids`, ALL_IDS.length > 0);
  ok('no id appears in both the bonus and the penalty list',
    !BONUS_REASONS.some((b) => (PENALTY_REASONS as readonly string[]).includes(b)),
    BONUS_REASONS.filter((b) => (PENALTY_REASONS as readonly string[]).includes(b)).join(','));
  ok('no id is duplicated', new Set(ALL_IDS).size === ALL_IDS.length);
  ok('the free-text id is in neither preset list',
    !(BONUS_REASONS as readonly string[]).includes(OTHER_REASON)
    && !(PENALTY_REASONS as readonly string[]).includes(OTHER_REASON));
}

// ── 2. Every app that offers the picker can render every id, in BOTH languages ─
// The apps are DECLARED, not discovered. A new console that offers the picker must be
// added here deliberately — the same posture callableHardening.mjs takes — so a
// surface cannot quietly ship with half a vocabulary.
{
  const APPS_WITH_PICKER = [
    { name: 'play-web (staff console)', file: 'apps/play-web/src/i18n.ts' },
    { name: 'creator-web (run console)', file: 'apps/creator-web/src/i18n.ts' },
  ];
  for (const app of APPS_WITH_PICKER) {
    const src = read(app.file);
    for (const id of ALL_IDS) {
      // Two occurrences: one per language map. A key defined once means one language
      // renders `undefined`, which is exactly the bug PART A of the i18n gate exists
      // for — asserted here too because a MISSING key is not a leaked-language key.
      const occurrences = src.split(new RegExp(`(^|[^A-Za-z0-9_])${id}\\s*:`, 'gm')).length - 1;
      ok(`${app.name} defines "${id}" in both language maps :: ${occurrences} occurrence(s)`,
        occurrences >= 2, String(occurrences));
    }
    // The free-text option needs a placeholder as well as a label.
    ok(`${app.name} defines a placeholder for the free-text reason`,
      /reasonOtherPlaceholder\s*:/.test(src));
  }
}

// ── 3. No app's dictionary declares a reason shared does not offer ───────────
// The apps reference the ids through the shared constants, never as literals, so
// the place a phantom reason CAN appear is a dictionary key: a `reasonSomething`
// label with no id behind it reads as a vocabulary entry to the next person editing
// the picker, and can never be selected. These three are labels ABOUT the picker
// rather than reasons, and are declared here so that list cannot quietly grow.
{
  const NON_ID_LABELS = new Set(['reasonLabel', 'reasonOther' + 'Placeholder']);
  const APPS = ['apps/play-web/src/i18n.ts', 'apps/creator-web/src/i18n.ts'];
  let scanned = 0;
  for (const file of APPS) {
    const src = read(file);
    const declared = new Set<string>();
    for (const m of src.matchAll(/^\s{2,}(reason[A-Z][A-Za-z0-9]*)\s*:/gm)) declared.add(m[1]);
    scanned += declared.size;
    const phantom = [...declared]
      .filter((d) => !NON_ID_LABELS.has(d) && !(ALL_IDS as readonly string[]).includes(d));
    ok(`${file} declares no reason label without an id :: ${declared.size} key(s)`,
      phantom.length === 0, phantom.join(','));
    // And the reverse: a declared non-id label that nothing uses is dead weight,
    // but a MISSING one breaks the picker — section 2 already covers the labels,
    // this covers the placeholder naming convention holding.
    ok(`${file} declares the picker's own labels`,
      [...NON_ID_LABELS].every((n) => declared.has(n)),
      [...NON_ID_LABELS].filter((n) => !declared.has(n)).join(','));
  }
  ok(`the scan actually read dictionaries :: ${scanned} reason key(s) across ${APPS.length} apps`,
    scanned >= ALL_IDS.length * APPS.length);
}

// ── 4. The old play-web copy is really gone, not merely unused ───────────────
// A move that leaves both files behind is a copy, and a copy drifts. This is the
// assertion that makes "one definition" a fact rather than an intention.
{
  const legacy = path.join(ROOT, 'apps/play-web/src/lib/scoreReasons.ts');
  ok('apps/play-web/src/lib/scoreReasons.ts no longer exists', !fs.existsSync(legacy));
  const staff = read('apps/play-web/src/screens/StaffConsole.tsx');
  ok('the staff console imports the vocabulary from shared',
    /from\s+'@rushpoint\/shared'/.test(staff)
    && !/lib\/scoreReasons/.test(staff),
    staff.split('\n').filter((l) => l.includes('scoreReasons')).join(' | '));
}

// ── 5. The behaviour survived the move ───────────────────────────────────────
{
  ok('a negative delta offers penalty reasons',
    reasonsForDelta(-5) === PENALTY_REASONS);
  ok('a positive delta offers bonus reasons', reasonsForDelta(5) === BONUS_REASONS);
  ok('a zero delta offers bonus reasons rather than throwing',
    reasonsForDelta(0) === BONUS_REASONS);
  ok('a NaN delta offers bonus reasons rather than throwing',
    reasonsForDelta(Number.NaN) === BONUS_REASONS);

  eq('a preset resolves to its stable id', resolveReason(BONUS_REASONS[0], 'ignored'), BONUS_REASONS[0]);
  eq('free text is trimmed', resolveReason(OTHER_REASON, '  late  '), 'late');
  eq('free text is bounded', resolveReason(OTHER_REASON, 'x'.repeat(500)).length, 200);
  eq('no selection resolves to empty, never a placeholder', resolveReason(null, 'typed'), '');

  eq('an empty amount is not submittable', parseAdjustAmount(''), null);
  eq('a bare minus mid-typing is not submittable', parseAdjustAmount('-'), null);
  eq('a decimal is not submittable', parseAdjustAmount('1.5'), null);
  eq('zero is not submittable', parseAdjustAmount('0'), null);
  eq('a five-figure swing is not submittable', parseAdjustAmount('10001'), null);
  eq('a normal award is submittable', parseAdjustAmount(' 40 '), 40);
  eq('a normal deduction is submittable', parseAdjustAmount('-25'), -25);
}

console.log('');
if (failures > 0) {
  console.error(`✗ score-reasons-shared: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ score-reasons-shared: all assertions passed');

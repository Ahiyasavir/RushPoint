// A stage must not show its name twice (change: stage-name-shown-twice).
//
// Observed in the running Builder on a phone. The stage pill draws
//
//     [⠿]  שלב 1        שלב 1        1
//          ↑ position    ↑ title      ↑ tasks
//
// because the two i18n keys are character-for-character identical:
//
//     stageLabel:        (n) => `שלב ${n}`
//     stageDefaultTitle: (n) => `שלב ${n}`
//
// so until a creator renames it, every stage repeats itself. The compact pill is
// capped at `max-w-[60vw]` and truncates, so on a phone half of a scarce line
// went to a string already on screen — and a real title, once written, was
// squeezed out sooner for it.
//
// Fixed as a DISPLAY rule rather than a data change: rewriting the stored default
// would leave every existing game still duplicating, and `stage.title` is read by
// several other surfaces that read better with a real value in it.
import { stageRailTitle, stageTitleIsRedundant } from '../apps/creator-web/src/lib/stageRailTitle';

let failures = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); return; }
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n[stage rail title] a title that restates the label is dropped');
ok(stageRailTitle('שלב 1', 'שלב 1') === '',
  'the Hebrew default collapses — this is the case that shipped');
ok(stageRailTitle('Stage 1', 'Stage 1') === '', 'and the English default');
ok(stageRailTitle(' Stage 1 ', 'Stage 1') === '', 'surrounding whitespace does not defeat it');
ok(stageRailTitle('stage 1', 'Stage 1') === '', 'nor does case');
ok(stageTitleIsRedundant('שלב 2', 'שלב 2'), 'the boolean agrees');

console.log('\n[stage rail title] a real name is always kept');
for (const [title, label] of [
  ['חימום', 'שלב 1'],
  ['Warm up', 'Stage 1'],
  ['שלב 1: חימום', 'שלב 1'],      // starts with the label but says more
  ['שלב 10', 'שלב 1'],            // a different number is a different string
  ['Stage 12', 'Stage 1'],
] as const) {
  ok(stageRailTitle(title, label) === title.trim(),
    `"${title}" survives beside "${label}"`,
    'dropping a title the creator actually wrote would be far worse than the duplication this fixes');
}

console.log('\n[stage rail title] the final-stage suffix does not break the comparison');
// The label the rail renders can carry a suffix the title never would.
ok(stageRailTitle('שלב 3', 'שלב 3 · אחרון') === '',
  'a default title still collapses when the label is decorated with the finale tag');
ok(stageRailTitle('הקרב האחרון', 'שלב 3 · אחרון') === 'הקרב האחרון',
  'and a real title still survives one');

console.log('\n[stage rail title] the rule is total');
ok(stageRailTitle('', 'שלב 1') === '', 'an empty title yields empty');
ok(stageRailTitle('   ', 'שלב 1') === '', 'a whitespace-only title yields empty');
ok(stageRailTitle(undefined, 'שלב 1') === '', 'undefined yields empty');
ok(stageRailTitle(null, 'שלב 1') === '', 'null yields empty');
ok(stageRailTitle('חימום', '') === 'חימום', 'an empty label keeps the title');
ok(stageRailTitle('חימום', undefined as unknown as string) === 'חימום',
  'a missing label keeps the title rather than throwing');
ok(stageRailTitle(undefined, undefined as unknown as string) === '',
  'both missing still yields a string');

console.log(failures === 0 ? '\n✅ stage rail title: ALL PASS\n' : `\n❌ stage rail title: ${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

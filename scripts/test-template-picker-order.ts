// Pure-logic tests — the creator's game-creation template picker order
// (change: template-picker-blank-first).
//
// The picker renders `TEMPLATES` with a bare `.map()` (DashboardPage.tsx) — there is
// no `.sort()` anywhere — so the array's literal order IS the order a brand-new
// creator sees on the very first screen they ever open. Real-user testing found the
// blank template buried second-to-last, behind eight themed templates, so a creator
// who wants to build their own thing had to scroll past every wedding/bar-mitzvah
// card to find "start from nothing".
//
// This file pins the fix so a future contributor pasting a new template at the top
// of the array can't silently re-bury it.
//
// Runs via `npm test` (scripts/run-unit-tests.mjs auto-discovers scripts/test-*.ts).
import { TEMPLATES } from '../apps/creator-web/src/templates';

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

console.log('\n── 1. picker order ─────────────────────────────────────────');
ok('TEMPLATES is a non-empty array', Array.isArray(TEMPLATES) && TEMPLATES.length > 0);
eq('the FIRST template a creator sees is the blank one', TEMPLATES[0]?.key, 'blank');

console.log('\n── 2. integrity (the reorder must not lose or duplicate a template) ──');
const keys = TEMPLATES.map((t) => t.key);
ok('every template key is unique', new Set(keys).size === keys.length);
ok('exactly one blank template exists', keys.filter((k) => k === 'blank').length === 1);
ok('every template still declares emoji/mode/scoringPreset/build',
  TEMPLATES.every((t) => typeof t.emoji === 'string' && t.emoji.length > 0
    && typeof t.mode === 'string' && t.mode.length > 0
    && typeof t.scoringPreset === 'string' && t.scoringPreset.length > 0
    && typeof t.build === 'function'));

// The eight launch-wedge niche templates must all survive the move — the fix is a
// reorder, not a cull.
const NICHE = ['bar_mitzvah', 'youth_group', 'corporate', 'birthday', 'school_race', 'wedding', 'conference', 'city_tour'];
ok('all eight niche templates are still present', NICHE.every((k) => keys.includes(k)));
const GENERIC = ['riddle', 'photo', 'trivia'];
ok('all three generic starters are still present', GENERIC.every((k) => keys.includes(k)));

console.log('\n── 3. blank stays genuinely blank ──────────────────────────');
const blank = TEMPLATES.find((t) => t.key === 'blank');
const blankStages = blank ? blank.build() : [];
ok('blank builds exactly one stage', blankStages.length === 1);
ok('blank seeds exactly one empty-titled task',
  blankStages[0]?.tasks?.length === 1 && blankStages[0]?.tasks?.[0]?.title === '');

if (failures > 0) {
  console.error(`\n✗ ${failures} assertion(s) failed\n`);
  process.exit(1);
}
console.log('\n✓ template picker order OK\n');

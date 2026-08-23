// Pure-logic tests for the STAGE STORY disclosure count.
//
// This file used to cover the task editor's five-collapsible-section model too
// (SECTION_KEYS / sectionApplies / defaultOpenSections / sectionSummary). That
// model was replaced by the modular opt-in chips (change:
// task-editor-progressive-disclosure) and its functions were deleted, so those
// assertions moved with it — the chip model is covered by
// scripts/test-task-opt-in-groups.ts, and the old assertions are NOT silently
// kept alive here against deleted code.
//
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  storyFieldCount,
  storyHasContent,
} from '../apps/creator-web/src/lib/wizardSections';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

// ── stage story (narrative) ──────────────────────────────────────────────────
ok(storyFieldCount(undefined) === 0, 'no narrative means no filled fields');
ok(storyHasContent(undefined) === false, 'no narrative means no content');
ok(storyFieldCount({ intro: { title: 'Chapter 1' } }) === 1, 'an intro title counts as one filled field');
ok(storyFieldCount({ intro: { title: 'a', body: 'b', bodyHe: 'c' }, outro: { body: 'd', bodyHe: 'e' } }) === 5,
  'all five story fields count');
ok(storyFieldCount({ intro: { title: '  ' }, outro: { body: '' } }) === 0, 'blank story fields do not count');
ok(storyHasContent({ outro: { bodyHe: 'סוף' } }) === true, 'any filled story field means content');

console.log(failed === 0
  ? `\n✅ ALL STAGE STORY TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

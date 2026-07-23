// Pure-logic tests for the Task Builder disclosure model (change: task-builder-ui).
//
// The task editor is now a set of COLLAPSIBLE sections instead of one long flat
// form. Which sections are offered, which start expanded, and the "n set" badge
// each collapsed header shows are pure functions of the task — extracted so the
// progressive-disclosure rules are testable without rendering a single pixel.
//
// Run by scripts/run-unit-tests.mjs via `npm test`.
import {
  SECTION_KEYS,
  sectionApplies,
  defaultOpenSections,
  sectionSummary,
  storyFieldCount,
  storyHasContent,
} from '../apps/creator-web/src/lib/wizardSections';
import { blankTask } from '../apps/creator-web/src/lib/wizardLogic';
import type { Task } from '@rushpoint/shared';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); }
}

const fresh = blankTask('t1');
const sibling = blankTask('t2');

// ── SECTION_KEYS ─────────────────────────────────────────────────────────────
ok(SECTION_KEYS.length === 5, `five optional sections (got ${SECTION_KEYS.length})`);
ok(new Set(SECTION_KEYS).size === SECTION_KEYS.length, 'section keys are unique');

// ── defaultOpenSections: a fresh task shows NOTHING expanded ─────────────────
const freshOpen = defaultOpenSections(fresh);
ok(SECTION_KEYS.every((k) => freshOpen[k] === false), 'a blank task opens with every optional section collapsed');

// ── hint ─────────────────────────────────────────────────────────────────────
ok(sectionApplies('hint', fresh, 1) === true, 'hint applies to every task');
ok(defaultOpenSections({ ...fresh, hint: 'look up' }).hint === true, 'hint section auto expands when a hint exists');
ok(defaultOpenSections({ ...fresh, hint: '   ' }).hint === false, 'a whitespace only hint does not expand the section');
ok(sectionSummary('hint', { ...fresh, hint: 'x' }) === 1, 'hint summary counts one');
ok(sectionSummary('hint', fresh) === 0, 'no hint means no badge');

// ── unlock (prerequisites) ───────────────────────────────────────────────────
ok(sectionApplies('unlock', fresh, 1) === false, 'unlock is hidden when the stage has a single task');
ok(sectionApplies('unlock', fresh, 2) === true, 'unlock is offered once the stage has siblings');
const withPrereq: Task = { ...fresh, unlockAfterTaskIds: [sibling.id] };
ok(defaultOpenSections(withPrereq).unlock === true, 'unlock auto expands when a prerequisite is set');
ok(sectionSummary('unlock', withPrereq) === 1, 'unlock summary counts the prerequisites');
ok(sectionSummary('unlock', { ...fresh, unlockAfterTaskIds: [] }) === 0, 'an empty prerequisite list shows no badge');

// ── media ────────────────────────────────────────────────────────────────────
ok(sectionApplies('media', fresh, 1) === true, 'media applies to every task');
const withMedia: Task = { ...fresh, media: [{ id: 'm1', kind: 'image', url: 'https://x/y.png' }] };
ok(defaultOpenSections(withMedia).media === true, 'media auto expands when the task carries media');
ok(sectionSummary('media', withMedia) === 1, 'media summary counts the attachments');

// ── rules (presence gate + hidden location) ──────────────────────────────────
ok(sectionApplies('rules', { ...fresh, type: 'quiz' }, 1) === true, 'answer tasks can gate on presence, so rules apply');
ok(sectionApplies('rules', { ...fresh, type: 'numeric' }, 1) === true, 'numeric tasks offer the rules section');
ok(sectionApplies('rules', { ...fresh, type: 'survey' }, 1) === true, 'survey tasks offer the rules section');
const locatedField: Task = { ...fresh, type: 'field', triggerMode: 'radius', coordinates: { lat: 31.7, lng: 35.2 } };
ok(sectionApplies('rules', locatedField, 1) === true, 'a located task offers rules (hidden location)');
const anywhere: Task = { ...fresh, type: 'field', triggerMode: 'locationless', locationless: true };
// pause-clock-tasks: the rules section is now offered on EVERY task, because the
// pause-clock toggle lives there and applies to any type. The presence gate and
// the hidden-location clue inside it still render only where they apply.
ok(sectionApplies('rules', anywhere, 1) === true, 'a locationless task still offers rules (the pause-clock toggle)');
ok(defaultOpenSections({ ...locatedField, hideLocation: true }).rules === true, 'rules auto expand when the location is hidden');
ok(defaultOpenSections({ ...fresh, type: 'quiz', requirePresence: true }).rules === true, 'rules auto expand when presence is required');
ok(defaultOpenSections({ ...fresh, type: 'survey', pausesTimer: true }).rules === true, 'rules auto expand when the clock is paused');
ok(defaultOpenSections(fresh).rules === false, 'rules stay collapsed on a fresh task');
ok(sectionSummary('rules', { ...locatedField, hideLocation: true }) === 1, 'rules summary counts hidden location');
ok(sectionSummary('rules', { ...locatedField, hideLocation: true, requirePresence: true }) === 2, 'rules summary counts both toggles');
ok(sectionSummary('rules', { ...fresh, type: 'survey', pausesTimer: true }) === 1, 'rules summary counts the paused clock');
ok(sectionSummary('rules', fresh) === 0, 'a task with no rules configured shows no badge');

// ── advanced ─────────────────────────────────────────────────────────────────
ok(sectionApplies('advanced', fresh, 1) === true, 'advanced always applies');
ok(defaultOpenSections({ ...fresh, expiresAfterMinutes: 30 }).advanced === true, 'advanced auto expands when a setting is configured');
ok(sectionSummary('advanced', fresh) === 0, 'advanced carries no badge');

// ── stage story (narrative) ──────────────────────────────────────────────────
ok(storyFieldCount(undefined) === 0, 'no narrative means no filled fields');
ok(storyHasContent(undefined) === false, 'no narrative means no content');
ok(storyFieldCount({ intro: { title: 'Chapter 1' } }) === 1, 'an intro title counts as one filled field');
ok(storyFieldCount({ intro: { title: 'a', body: 'b', bodyHe: 'c' }, outro: { body: 'd', bodyHe: 'e' } }) === 5,
  'all five story fields count');
ok(storyFieldCount({ intro: { title: '  ' }, outro: { body: '' } }) === 0, 'blank story fields do not count');
ok(storyHasContent({ outro: { bodyHe: 'סוף' } }) === true, 'any filled story field means content');

console.log(failed === 0
  ? `\n✅ ALL WIZARD SECTION TESTS PASSED (${passed})`
  : `\n❌ ${failed} failed, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);

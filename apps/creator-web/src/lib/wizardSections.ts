// Stage-story disclosure helpers.
//
// This file used to also hold the TASK editor's five-collapsible-section model
// (sectionApplies / defaultOpenSections / sectionSummary). That model was
// replaced by the modular opt-in chips in lib/taskOptInGroups (change:
// task-editor-progressive-disclosure), and the section functions were deleted
// rather than left behind: a dead export with a passing test suite reads as a
// live design, which is exactly the rot the unit-test aggregator exists to
// prevent.
//
// What remains is the stage story's own disclosure count, still used by
// lib/stageSettings and BuilderPage.
import type { Stage } from '@rushpoint/shared';

const filled = (s: string | undefined | null): boolean => typeof s === 'string' && s.trim() !== '';

// ── Stage story (narrative chapters) ─────────────────────────────────────────
// The story editor is a compact inline disclosure too. Five authored fields:
// intro title / intro body EN / intro body HE / outro body EN / outro body HE.
type Narrative = Stage['narrative'];

export function storyFieldCount(n: Narrative): number {
  if (!n) return 0;
  return [n.intro?.title, n.intro?.body, n.intro?.bodyHe, n.outro?.body, n.outro?.bodyHe]
    .filter(filled).length;
}

export function storyHasContent(n: Narrative): boolean {
  return storyFieldCount(n) > 0;
}

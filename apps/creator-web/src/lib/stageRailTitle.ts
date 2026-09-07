// Does a stage's title add anything to its positional label?
// (change: stage-name-shown-twice)
//
// The stage rail draws two strings side by side:
//
//     [⠿]  שלב 1        שלב 1        1
//          ↑ position    ↑ title      ↑ task count
//
// and the default title for every stage is
//
//     stageDefaultTitle: (n) => `שלב ${n}`      // i18n.ts
//
// which is character-for-character what the positional label already says
//
//     stageLabel:        (n) => `שלב ${n}`      // i18n.ts
//
// So until a creator renames it, EVERY stage shows its own name twice. It is not
// only noise: the compact phone pill is capped at `max-w-[60vw]` and truncates,
// so half of a scarce line is spent repeating a string already on screen, and a
// real title the creator did write gets squeezed out sooner.
//
// The fix is a display rule, not a data change. Rewriting the stored default
// would leave every EXISTING game still showing the duplicate, and `stage.title`
// is read by half a dozen other surfaces (readiness sentences, the delete
// confirm, the run console, narrative beats) that all read better with a real
// value in it. So the rail simply declines to print a title that says nothing
// the label did not.
//
// Pure and total: any input shape yields a string, nothing throws.

/**
 * What the rail should print for the stage's name, given the positional label it
 * is already showing beside it.
 *
 * Returns '' when the title is absent, blank, or merely restates the label —
 * the caller then renders the label alone. Comparison ignores surrounding
 * whitespace and case so "Stage 1", "stage 1 " and "Stage 1" all collapse.
 */
export function stageRailTitle(title: string | undefined | null, positionLabel: string): string {
  const t = typeof title === 'string' ? title.trim() : '';
  if (t === '') return '';
  const label = typeof positionLabel === 'string' ? positionLabel.trim() : '';
  // The label may carry a suffix the title never would (" · Final"), so compare
  // against its leading segment too rather than only the whole string.
  const head = label.split('·')[0]?.trim() ?? label;
  if (t.toLowerCase() === label.toLowerCase()) return '';
  if (head !== '' && t.toLowerCase() === head.toLowerCase()) return '';
  return t;
}

/**
 * True when the rail is showing the label ALONE, so the caller can drop the
 * title element entirely instead of rendering an empty node that still costs
 * flex gap.
 */
export function stageTitleIsRedundant(title: string | undefined | null, positionLabel: string): boolean {
  return stageRailTitle(title, positionLabel) === '';
}

// Is a template offered to creators? (change: template-visibility)
//
// ─── Why this is a function and not four `=== true` checks ───────────────────
//
// Four call sites decide this: the creator-facing listing, the admin listing, the
// instantiation callable, and the admin page's badge. Two of them read documents
// that arrived through a Firestore `.select()` field mask, and a field missing
// from that mask arrives `undefined` on EVERY document — so an inline check would
// pass every row and the feature would look implemented while doing nothing.
// Nothing throws, nothing logs, and the same omission has already shipped once in
// this repo with `templateGenre` (see CLAUDE.md).
//
// Naming it once means the mask requirement can be asserted once
// (scripts/test-template-visibility.ts §2), against the same constant the query
// uses.
//
// ─── ABSENT MEANS VISIBLE ────────────────────────────────────────────────────
//
// Every template that exists today carries no such field. If absence read as
// hidden, the entire catalogue would vanish on deploy. That is also why the field
// is named for the NON-default state: `templateHidden` absent reads as "not
// hidden", whereas a `templatePublished` would have needed `undefined` to mean
// `true`, which is the inversion people get wrong.
//
// Only the boolean `true` hides. Not `'true'`, not `1`, not `null` — the callable
// transport collapses `undefined` to `null` (CLAUDE.md), so a cleared client
// field arrives as null and must not hide anything. Anything else reaching here
// means validation failed upstream, and guessing would hide a template nobody
// asked to hide.

/** Just enough of a template document to answer the question. */
export interface TemplateVisibilityFields {
  templateHidden?: unknown;
}

/**
 * True only when this template has been explicitly hidden from creators.
 *
 * TOTAL: any input at all, including `undefined`, a string, or a malformed row,
 * yields `false`. This runs over rows a query returned, and one bad document must
 * not take down a listing every creator depends on.
 */
export function isTemplateHidden(game: TemplateVisibilityFields | null | undefined): boolean {
  if (typeof game !== 'object' || game === null) return false;
  return (game as { templateHidden?: unknown }).templateHidden === true;
}
